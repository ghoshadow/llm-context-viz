"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");

function parseConnectAuthority(authority) {
  const raw = String(authority || "").trim();
  if (!raw) return { host: "", port: 443 };
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    const host = end >= 0 ? raw.slice(1, end) : raw;
    const rest = end >= 0 ? raw.slice(end + 1) : "";
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : 443;
    return { host, port: Number.isFinite(port) && port > 0 ? port : 443 };
  }
  const idx = raw.lastIndexOf(":");
  if (idx > 0 && raw.indexOf(":") === idx) {
    const host = raw.slice(0, idx);
    const port = Number(raw.slice(idx + 1));
    return { host, port: Number.isFinite(port) && port > 0 ? port : 443 };
  }
  return { host: raw, port: 443 };
}

function isSensitiveHeader(name) {
  const key = String(name || "").toLowerCase();
  return key === "cookie"
    || key.includes("authorization")
    || key.includes("auth")
    || key.includes("key")
    || key.includes("token")
    || key.includes("secret");
}

function redactHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    out[key] = isSensitiveHeader(key) ? "[REDACTED]" : value;
  }
  return out;
}

function cleanForwardHeaders(headers, targetHost) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (
      lower === "transfer-encoding"
      || lower === "proxy-connection"
      || lower === "proxy-authorization"
    ) {
      continue;
    }
    out[key] = value;
  }
  out.host = targetHost;
  return out;
}

function tryParse(contentType, body) {
  if (!body) return null;
  if (String(contentType || "").includes("json")) {
    try { return JSON.parse(body); } catch { return body; }
  }
  return body;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
}

function makeLogFilePath(cwd, date = new Date()) {
  return path.join(path.resolve(cwd), ".claude-trace", `api-log-${timestampForFile(date)}.jsonl`);
}

function getProjectLogFilePath(cwd, date = new Date()) {
  const logFile = makeLogFilePath(cwd, date);
  const traceDir = path.dirname(logFile);
  try {
    ensureDir(traceDir);
    if (!fs.statSync(traceDir).isDirectory()) {
      throw new Error("trace path exists but is not a directory");
    }
    fs.accessSync(traceDir, fs.constants.W_OK);
  } catch (err) {
    const reason = err?.message ? ` (${err.message})` : "";
    throw new Error(`Project trace directory is not writable: ${traceDir}${reason}`);
  }
  return logFile;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function resolveCaptureTarget(value) {
  const raw = String(value || "").trim();
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    return {
      mode: "base-url",
      upstreamBaseUrl: normalizeBaseUrl(raw),
      targetHost: url.hostname,
    };
  }
  return {
    mode: "connect",
    upstreamBaseUrl: null,
    targetHost: raw || "api.deepseek.com",
  };
}

function pickPort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

module.exports = {
  parseConnectAuthority,
  isSensitiveHeader,
  redactHeaders,
  cleanForwardHeaders,
  tryParse,
  ensureDir,
  makeLogFilePath,
  getProjectLogFilePath,
  resolveCaptureTarget,
  pickPort,
};
