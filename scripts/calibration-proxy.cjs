#!/usr/bin/env node
"use strict";

const tls = require("tls");
const https = require("https");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawn } = require("child_process");
const {
  parseConnectAuthority,
  redactHeaders,
  cleanForwardHeaders,
  tryParse,
  ensureDir,
  chooseWritableLogFilePath,
} = require("./calibration-proxy-utils.cjs");

const DEFAULT_TARGET_HOST = "api.deepseek.com";
const DEFAULT_PORT = 18443;
const CERT_DIR = path.join(os.homedir(), ".claude-trace", "certs");

function log(msg) {
  console.log(`[calibration-proxy] ${msg}`);
}

function parseArgs(argv) {
  const args = [...argv];
  const dashDashIdx = args.indexOf("--");
  const preArgs = dashDashIdx >= 0 ? args.slice(0, dashDashIdx) : args;
  const claudeArgs = dashDashIdx >= 0 ? args.slice(dashDashIdx + 1) : ["-p", "say hi"];
  const opts = {
    cwd: process.cwd(),
    targetHost: DEFAULT_TARGET_HOST,
    port: DEFAULT_PORT,
    timeoutMs: 45000,
    claudeArgs,
  };
  for (let i = 0; i < preArgs.length; i += 1) {
    const key = preArgs[i];
    const value = preArgs[i + 1];
    if (key === "--cwd" && value) { opts.cwd = path.resolve(value); i += 1; }
    else if (key === "--target-host" && value) { opts.targetHost = value; i += 1; }
    else if (key === "--port" && value) { opts.port = Number(value); i += 1; }
    else if (key === "--timeout-ms" && value) { opts.timeoutMs = Number(value); i += 1; }
  }
  return opts;
}

function getCACert() {
  ensureDir(CERT_DIR);
  const keyPath = path.join(CERT_DIR, "ca-key.pem");
  const certPath = path.join(CERT_DIR, "ca-cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath, "utf-8"),
      cert: fs.readFileSync(certPath, "utf-8"),
      keyPath,
      certPath,
    };
  }
  execSync(`openssl genrsa -out "${keyPath}" 2048 2>/dev/null`, { stdio: "ignore", timeout: 5000 });
  execSync(
    `openssl req -x509 -new -nodes -key "${keyPath}" -sha256 -days 3650 -out "${certPath}" -subj "/CN=Claude Trace CA" -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign"`,
    { stdio: "ignore", timeout: 5000 },
  );
  fs.chmodSync(keyPath, 0o600);
  log("CA certificate generated");
  return {
    key: fs.readFileSync(keyPath, "utf-8"),
    cert: fs.readFileSync(certPath, "utf-8"),
    keyPath,
    certPath,
  };
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

function writePair(logFile, reqData, resData) {
  fs.appendFileSync(
    logFile,
    JSON.stringify({ request: reqData, response: resData, logged_at: new Date().toISOString() }) + "\n",
  );
}

function tunnelRaw(clientSocket, authority) {
  const { host, port } = parseConnectAuthority(authority);
  const upstream = net.connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => {
    try { clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch {}
  });
}

function createMitmHandler({ targetHost, logFile, onCapture }) {
  const hostCert = getHostCert(targetHost);
  const secureContext = tls.createSecureContext({
    key: hostCert.key,
    cert: hostCert.cert,
  });
  return (clientSocket) => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext,
      ALPNProtocols: ["http/1.1"],
    });
    tlsSocket.on("error", (err) => {
      log(`TLS socket error: ${err.message}`);
    });

    const localHttp = http.createServer((req, res) => {
      const reqTs = Date.now();
      let body = "";
      req.on("data", (chunk) => { body += chunk.toString("utf-8"); });
      req.on("end", () => {
        const url = `https://${targetHost}${req.url}`;
        const proxyReq = https.request({
          hostname: targetHost,
          port: 443,
          path: req.url,
          method: req.method,
          servername: targetHost,
          headers: cleanForwardHeaders(req.headers, targetHost),
        }, (proxyRes) => {
          const resTs = Date.now();
          let resBody = "";
          proxyRes.on("data", (chunk) => { resBody += chunk.toString("utf-8"); });
          proxyRes.on("end", () => {
            writePair(logFile, {
              timestamp: reqTs / 1000,
              method: req.method,
              url,
              headers: redactHeaders(req.headers),
              body: tryParse(req.headers["content-type"], body),
            }, {
              timestamp: resTs / 1000,
              status_code: proxyRes.statusCode,
              headers: redactHeaders(proxyRes.headers),
              body: tryParse(proxyRes.headers["content-type"], resBody),
            });
            onCapture();
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            res.end(resBody);
          });
        });
        proxyReq.on("error", (err) => {
          log(`Upstream error: ${err.message}`);
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        if (body) proxyReq.write(body);
        proxyReq.end();
      });
    });
    localHttp.emit("connection", tlsSocket);
    tlsSocket.once("close", () => { try { localHttp.close(); } catch {} });
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(opts.port) || opts.port <= 0) throw new Error("Invalid --port");
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) throw new Error("Invalid --timeout-ms");
  if (!fs.existsSync(opts.cwd) || !fs.statSync(opts.cwd).isDirectory()) throw new Error(`Invalid cwd: ${opts.cwd}`);

  const ca = getCACert();
  getHostCert(opts.targetHost);
  const logFile = chooseWritableLogFilePath(opts.cwd);
  ensureDir(path.dirname(logFile));

  let captured = false;
  let timedOut = false;
  const seenConnectHosts = new Set();
  const server = http.createServer();
  const handleMitm = createMitmHandler({
    targetHost: opts.targetHost,
    logFile,
    onCapture: () => { captured = true; },
  });

  server.on("connect", (req, clientSocket) => {
    const { host, port } = parseConnectAuthority(req.url);
    if (host) {
      seenConnectHosts.add(`${host}:${port}`);
      log(`CONNECT ${host}:${port}`);
    }
    if (host === opts.targetHost && port === 443) handleMitm(clientSocket);
    else tunnelRaw(clientSocket, req.url);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });

  const proxyUrl = `http://127.0.0.1:${opts.port}`;
  const claudePath = execSync("which claude", { encoding: "utf8" }).trim();
  log(`READY port=${opts.port} target=${opts.targetHost} log=${logFile}`);
  log(`Launching: ${claudePath} ${opts.claudeArgs.join(" ")}`);

  const child = spawn(claudePath, opts.claudeArgs, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      HTTPS_PROXY: proxyUrl,
      HTTP_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      http_proxy: proxyUrl,
      NODE_EXTRA_CA_CERTS: ca.certPath,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const timeout = setTimeout(() => {
    if (!captured) {
      timedOut = true;
      const seen = Array.from(seenConnectHosts).join(", ") || "none";
      log(`ERROR no target request captured before timeout (${opts.timeoutMs}ms); seen CONNECT hosts: ${seen}; Claude Code may not honor HTTPS_PROXY or target host may be wrong`);
      try { child.kill("SIGTERM"); } catch {}
    }
  }, opts.timeoutMs);

  const code = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode || 0));
    child.on("error", () => resolve(1));
  });
  clearTimeout(timeout);
  server.close();

  if (!captured) process.exit(timedOut ? 2 : 1);
  log(`CAPTURED log=${logFile}`);
  process.exit(code);
}

main().catch((err) => {
  console.error(`[calibration-proxy] ERROR ${err.message}`);
  process.exit(1);
});
