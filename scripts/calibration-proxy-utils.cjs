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

function normalizeTraceOptions(options = {}) {
  return {
    traceDirName: options.traceDirName || ".claude-trace",
    logPrefix: options.logPrefix || "api-log",
  };
}

function makeLogFilePath(cwd, date = new Date(), options = {}) {
  const opts = normalizeTraceOptions(options);
  return path.join(path.resolve(cwd), opts.traceDirName, `${opts.logPrefix}-${timestampForFile(date)}.jsonl`);
}

function getProjectLogFilePath(cwd, date = new Date(), options = {}) {
  const logFile = makeLogFilePath(cwd, date, options);
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

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveCliPath(cliName, options = {}) {
  const env = options.env || process.env;
  const upper = String(cliName || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const override = env[`${upper}_CLI_PATH`];
  const defaultCandidates = options.defaultCandidates || builtinCliCandidates(cliName);
  const candidates = [];

  if (override) candidates.push(override);
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, cliName));
  }
  candidates.push(...(options.extraCandidates || []));
  candidates.push(...defaultCandidates);

  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (isExecutableFile(resolved)) return resolved;
  }

  const envName = `${upper}_CLI_PATH`;
  throw new Error(
    `Unable to find ${cliName} CLI. Set ${envName} to the executable path, or add ${cliName} to PATH.`,
  );
}

function builtinCliCandidates(cliName) {
  if (cliName === "codex") return ["/Applications/Codex.app/Contents/Resources/codex"];
  if (cliName === "claude") return ["/Applications/Claude.app/Contents/Resources/app/bin/claude"];
  return [];
}

function promptFromArgs(args, fallback) {
  if (!Array.isArray(args) || args.length === 0) return fallback;
  if (args.length === 2 && args[0] === "-p") return args[1];
  return args.join(" ");
}

function buildSourceChildArgs(source, options) {
  const promptArgs = options.promptArgs || [];
  const prompt = promptFromArgs(promptArgs, source === "claude" ? "say hi" : 'Calibration probe: reply with "ok".');
  if (source === "codex") {
    const base = [
      "exec", "--json", "--skip-git-repo-check",
      "-c", `model_providers.OpenAI.base_url="${options.proxyUrl}"`,
      "-s", "read-only", "-C", options.cwd,
    ];
    if (options.captureMode === "base-url") base.splice(1, 0, "--ephemeral");
    return [...base, ...(promptArgs.length ? promptArgs : [prompt])];
  }
  if (source === "opencode") return ["run", "--format", "json", prompt];
  if (source === "pi") return ["--no-session", "--mode", "json", "-p", prompt];
  if (source === "openclaw") {
    const profile = inferOpenClawProfileFromCwd(options.cwd);
    return [...(profile ? ["--profile", profile] : []), "agent", "--local", "--json", "--agent", "main", "--message", prompt];
  }
  return promptArgs.length ? promptArgs : ["-p", prompt];
}

function inferOpenClawProfileFromCwd(cwd, env = process.env) {
  const home = env.HOME || env.USERPROFILE;
  if (!home || !cwd) return "";
  const rel = path.relative(path.resolve(home), path.resolve(cwd));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "";
  const root = rel.split(path.sep)[0] || "";
  const match = root.match(/^\.openclaw-(.+)$/);
  return match?.[1] || "";
}

function resolveOpenClawCliCommand(env = process.env) {
  if (env.OPENCLAW_CLI_PATH) return { cliPath: path.resolve(env.OPENCLAW_CLI_PATH), prefixArgs: [] };
  const appNode = "/Applications/AutoClaw.app/Contents/Resources/node/node";
  const appCli = "/Applications/AutoClaw.app/Contents/Resources/gateway/openclaw/openclaw.mjs";
  if (isExecutableFile(appNode) && fs.existsSync(appCli)) {
    return { cliPath: appNode, prefixArgs: ["--loader", path.join(__dirname, "openclaw-plugin-sdk-loader.mjs"), appCli] };
  }
  return { cliPath: resolveCliPath("openclaw", { env }), prefixArgs: [] };
}

function resolveSourceCliCommand(source, env = process.env) {
  if (source === "openclaw") return resolveOpenClawCliCommand(env);
  const cliName = source === "codex" ? "codex" : source === "opencode" ? "opencode" : source === "pi" ? "pi" : "claude";
  return { cliPath: resolveCliPath(cliName, { env }), prefixArgs: [] };
}

module.exports = {
  parseConnectAuthority,
  isSensitiveHeader,
  redactHeaders,
  cleanForwardHeaders,
  tryParse,
  ensureDir,
  normalizeTraceOptions,
  makeLogFilePath,
  getProjectLogFilePath,
  resolveCaptureTarget,
  resolveCliPath,
  buildSourceChildArgs,
  resolveSourceCliCommand,
  inferOpenClawProfileFromCwd,
  pickPort,
};
