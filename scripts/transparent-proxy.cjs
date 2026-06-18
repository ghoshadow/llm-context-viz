#!/usr/bin/env node
"use strict";
/**
 * Transparent MITM proxy for intercepting Claude Code → DeepSeek API traffic.
 *
 * Temporarily adds api.deepseek.com → 127.0.0.1 in /etc/hosts, runs an MITM
 * proxy on port 443 (requires sudo), and restores /etc/hosts on exit.
 *
 * The proxy connects upstream via the pre-resolved real IP, avoiding the
 * /etc/hosts redirect.
 *
 * Usage: sudo node transparent-proxy.js [-- claude args...]
 */

const tls = require("tls");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROXY_PORT = 443; // must be 443 to intercept without pfctl
const TARGET_HOST = "api.deepseek.com";
const CERT_DIR = path.join(os.homedir(), ".claude-trace", "certs");
const LOG_DIR = path.join(process.cwd(), ".claude-trace");
const HOSTS_FILE = "/etc/hosts";
const HOSTS_MARKER = "# claude-trace-transparent-proxy";

// Pre-resolve the real IP before we modify /etc/hosts
const REAL_IP = (() => {
  try {
    const out = execSync(
      `dig +short ${TARGET_HOST} A 2>/dev/null || host ${TARGET_HOST} 2>/dev/null | grep 'has address' | awk '{print $NF}' | head -1`,
      { encoding: "utf8", timeout: 5000 }
    );
    const ip = out.trim().split("\n")[0].trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {}
  return "58.49.197.113"; // fallback
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  console.log(`[tp] ${msg}`);
}

// ---------------------------------------------------------------------------
// /etc/hosts helpers
// ---------------------------------------------------------------------------

function addHostsEntry() {
  let content = fs.readFileSync(HOSTS_FILE, "utf-8");
  if (content.includes(HOSTS_MARKER)) {
    log("/etc/hosts entry already exists");
    return;
  }
  const entry = `\n127.0.0.1 ${TARGET_HOST} ${HOSTS_MARKER}\n`;
  fs.writeFileSync(HOSTS_FILE, content + entry);
  log(`Added /etc/hosts: 127.0.0.1 ${TARGET_HOST}`);
  // Flush DNS cache
  try { execSync("dscacheutil -flushcache 2>/dev/null; killall -HUP mDNSResponder 2>/dev/null", { stdio: "ignore", timeout: 3000 }); } catch {}
}

function removeHostsEntry() {
  try {
    let content = fs.readFileSync(HOSTS_FILE, "utf-8");
    if (!content.includes(HOSTS_MARKER)) return;
    content = content
      .split("\n")
      .filter((line) => !line.includes(HOSTS_MARKER))
      .join("\n");
    // Remove trailing empty lines
    content = content.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    fs.writeFileSync(HOSTS_FILE, content);
    log(`Removed /etc/hosts entry for ${TARGET_HOST}`);
    try { execSync("dscacheutil -flushcache 2>/dev/null; killall -HUP mDNSResponder 2>/dev/null", { stdio: "ignore", timeout: 3000 }); } catch {}
  } catch (e) {
    log(`Failed to clean /etc/hosts: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Certificate helpers
// ---------------------------------------------------------------------------

function getCACert() {
  ensureDir(CERT_DIR);
  const keyPath = path.join(CERT_DIR, "ca-key.pem");
  const certPath = path.join(CERT_DIR, "ca-cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8"), certPath, keyPath };
  }
  execSync(`openssl genrsa -out "${keyPath}" 2048 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  execSync(
    `openssl req -x509 -new -nodes -key "${keyPath}" -sha256 -days 3650 -out "${certPath}" -subj "/CN=Claude Trace CA" -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign"`,
    { stdio: "ignore", timeout: 5000 }
  );
  fs.chmodSync(keyPath, 0o600);
  log("CA certificate generated");
  return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8"), certPath, keyPath };
}

function getHostCert(hostname) {
  ensureDir(CERT_DIR);
  const safe = hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  const keyPath = path.join(CERT_DIR, `${safe}-key.pem`);
  const certPath = path.join(CERT_DIR, `${safe}-cert.pem`);
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8") };
  }
  const ca = getCACert();
  execSync(`openssl genrsa -out "${keyPath}" 2048 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  const cnf = path.join(CERT_DIR, `${safe}.cnf`);
  fs.writeFileSync(cnf, `[req]\ndistinguished_name=req\nreq_extensions=ext\n[req]\n[ext]\nsubjectAltName=DNS:${hostname}\n`);
  const csr = path.join(CERT_DIR, `${safe}.csr`);
  execSync(`openssl req -new -key "${keyPath}" -out "${csr}" -subj "/CN=${hostname}" -config "${cnf}" 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  execSync(`openssl x509 -req -in "${csr}" -CA "${ca.certPath}" -CAkey "${ca.keyPath}" -CAcreateserial -out "${certPath}" -days 365 -sha256 -extfile "${cnf}" -extensions ext 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  try { fs.unlinkSync(csr); fs.unlinkSync(cnf); } catch {}
  fs.chmodSync(keyPath, 0o600);
  return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(certPath, "utf-8") };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function writePair(logFile, reqData, resData) {
  const pair = {
    request: reqData,
    response: resData,
    logged_at: new Date().toISOString(),
  };
  fs.appendFileSync(logFile, JSON.stringify(pair) + "\n");
}

// ---------------------------------------------------------------------------
// Transparent MITM Server
// ---------------------------------------------------------------------------

function startMITMServer(logFile) {
  const hostCert = getHostCert(TARGET_HOST);

  const tlsServer = tls.createServer(
    { key: hostCert.key, cert: hostCert.cert, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] },
    (tlsSocket) => {
      const httpServer = http.createServer((req, res) => {
        const reqTs = Date.now();
        let body = "";
        req.on("data", (c) => { body += c.toString("utf-8"); });
        req.on("end", () => {
          const url = `https://${TARGET_HOST}${req.url}`;

          // Connect upstream via REAL IP (bypasses /etc/hosts redirect)
          const proxyReq = https.request(
            {
              hostname: REAL_IP,
              port: 443,
              path: req.url,
              method: req.method,
              servername: TARGET_HOST,
              headers: cleanHeaders(req.headers),
              rejectUnauthorized: false,
            },
            (proxyRes) => {
              const resTs = Date.now();
              let resBody = "";
              proxyRes.on("data", (c) => { resBody += c.toString("utf-8"); });
              proxyRes.on("end", () => {
                writePair(logFile,
                  {
                    timestamp: reqTs / 1000,
                    method: req.method,
                    url,
                    headers: redactAuth(req.headers),
                    body: tryParse(req.headers["content-type"], body),
                  },
                  {
                    timestamp: resTs / 1000,
                    status_code: proxyRes.statusCode,
                    headers: proxyRes.headers,
                    body: tryParse(proxyRes.headers["content-type"], resBody),
                  }
                );
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                res.end(resBody);
              });
            }
          );
          proxyReq.on("error", (err) => { log(`Upstream error: ${err.message}`); if (!res.headersSent) { res.writeHead(502); } res.end(); });
          if (body) proxyReq.write(body);
          proxyReq.end();
        });
      });
      httpServer.emit("connection", tlsSocket);
      tlsSocket.once("close", () => { try { httpServer.close(); } catch {} });
    }
  );

  tlsServer.on("error", (err) => { log(`TLS server error: ${err.message}`); });

  return new Promise((resolve, reject) => {
    tlsServer.listen(PROXY_PORT, "0.0.0.0", () => {
      log(`MITM server on 0.0.0.0:${PROXY_PORT}, upstream IP=${REAL_IP}`);
      resolve(tlsServer);
    });
    tlsServer.once("error", reject);
  });
}

function cleanHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k === "transfer-encoding" || k === "proxy-connection" || k === "proxy-authorization") continue;
    out[k] = v;
  }
  out.host = TARGET_HOST;
  return out;
}

function redactAuth(headers) {
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    const lk = key.toLowerCase();
    if (lk.includes("auth") || lk.includes("key") || lk === "cookie" || lk === "x-api-key") {
      out[key] = "[REDACTED]";
    }
  }
  return out;
}

function tryParse(contentType, body) {
  if (!body) return null;
  if ((contentType || "").includes("json")) {
    try { return JSON.parse(body); } catch { return body; }
  }
  return body;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (process.getuid && process.getuid() !== 0) {
    console.error("This script must be run with sudo (needs port 443 and /etc/hosts access).");
    console.error("Usage: sudo node transparent-proxy.js [-- claude args...]");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dashDashIdx = args.indexOf("--");
  const claudeArgs = dashDashIdx >= 0 ? args.slice(dashDashIdx + 1) : [];
  if (claudeArgs.length === 0) claudeArgs.push("-p", "say hi"); // default: one-shot

  // Setup log file
  ensureDir(LOG_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, -5);
  const logFile = path.join(LOG_DIR, `api-log-${ts}.jsonl`);

  log(`Target: ${TARGET_HOST} (real IP: ${REAL_IP})`);
  log(`Log: ${logFile}`);

  // Generate certs
  getCACert();
  getHostCert(TARGET_HOST);

  // Modify /etc/hosts
  addHostsEntry();

  // Start MITM server
  const tlsServer = await startMITMServer(logFile);

  // Launch Claude
  const ca = getCACert();
  const claudePath = execSync("which claude", { encoding: "utf8" }).trim();
  log(`Launching: ${claudePath} ${claudeArgs.join(" ")}`);
  log(`NODE_EXTRA_CA_CERTS=${ca.certPath}`);
  console.log("");

  const child = spawn(claudePath, claudeArgs, {
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: ca.certPath,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
    stdio: "inherit",
    cwd: process.cwd(),
  });

  const cleanup = () => {
    removeHostsEntry();
    tlsServer.close();
    log(`Log: ${logFile}`);
    try {
      if (fs.existsSync(logFile)) {
        const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
        log(`Captured ${lines.length} API request(s)`);
      }
    } catch {}
  };

  child.on("exit", (code) => { log(`Claude exited (${code || 0})`); cleanup(); process.exit(code || 0); });
  child.on("error", (err) => { log(`Error: ${err.message}`); cleanup(); process.exit(1); });
  ["SIGINT", "SIGTERM"].forEach((s) => process.on(s, () => { child.kill(s); cleanup(); process.exit(0); }));
}

main().catch((e) => { console.error(e); process.exit(1); });
