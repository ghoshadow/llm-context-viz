# Sudo-Free Claude Calibration Proxy Design

## Purpose

The current Claude Code calibration flow depends on `scripts/transparent-proxy.cjs`. That script captures the real API request by binding to local port `443` and temporarily modifying `/etc/hosts`, so it must run with `sudo`. The calibration UX still requires manual terminal work and manual log upload.

This feature replaces that path with an explicit local HTTP proxy that runs on an unprivileged port. The app can then launch Claude Code with proxy environment variables, capture one calibration request, extract constants, and show the same result cards without asking the web UI to collect administrator credentials.

## Goals

- Run automatic Claude Code calibration without `sudo`.
- Avoid modifying `/etc/hosts`.
- Avoid binding privileged ports.
- Reuse the existing `extractConstants()` output shape and apply flow.
- Keep the existing manual upload path as a fallback.
- Return clear failure states if Claude Code does not honor proxy environment variables.
- Keep sensitive request headers redacted in any generated capture log.

## Non-Goals

- Do not silently install a system-wide certificate authority.
- Do not collect or prompt for the user's sudo password inside the web app.
- Do not replace the existing transparent proxy immediately; keep it available for debugging and fallback.
- Do not attempt exact token accounting beyond the existing character-count based constants.
- Do not broaden capture beyond the calibration target host.

## Recommended Approach

Add a new script:

`scripts/calibration-proxy.cjs`

The script starts a local HTTP proxy on `127.0.0.1` using a high port, defaulting to `18443`. It launches `claude -p "say hi"` with:

```sh
HTTPS_PROXY=http://127.0.0.1:18443
HTTP_PROXY=http://127.0.0.1:18443
NODE_EXTRA_CA_CERTS=~/.claude-trace/certs/ca-cert.pem
NODE_TLS_REJECT_UNAUTHORIZED=0
```

The proxy handles `CONNECT` requests. For the target host, initially `api.deepseek.com:443`, it performs a MITM capture using the generated local CA and host certificate. For all other hosts, it should tunnel bytes directly to the requested destination so Claude Code startup dependencies are not accidentally broken.

If no matching target request is captured before the timeout, the script exits with a structured failure that says Claude Code may not be honoring `HTTPS_PROXY` in this environment.

## Proxy Behavior

### Startup

1. Create `~/.claude-trace/certs` if missing.
2. Reuse or generate a local CA certificate.
3. Reuse or generate a host certificate for the target host.
4. Listen on `127.0.0.1:<port>`.
5. Spawn `claude` in the requested `cwd` with proxy-related environment variables.
6. Write capture lines to `<cwd>/.claude-trace/api-log-<timestamp>.jsonl`.

### Target CONNECT

For `CONNECT api.deepseek.com:443`:

1. Reply `HTTP/1.1 200 Connection Established`.
2. Wrap the client socket with a server-side TLS socket using the generated host certificate.
3. Feed the decrypted TLS socket into a local HTTP server.
4. For each decrypted request, forward it upstream with `https.request()`.
5. Log the request and response pair with the same high-level JSONL shape used by `transparent-proxy.cjs`.
6. Redact sensitive headers before writing logs.

### Non-Target CONNECT

For other destinations:

1. Open a raw TCP connection to the requested host and port.
2. Reply `HTTP/1.1 200 Connection Established`.
3. Pipe client and upstream sockets together without inspection.

This keeps the proxy focused on calibration while preserving normal network behavior.

## Backend API

Extend `server/routes/calibrate.ts` with automatic calibration endpoints.

### `POST /api/calibrate/auto/start`

Request body:

```json
{
  "cwd": "/absolute/session/project",
  "prompt": "say hi",
  "targetHost": "api.deepseek.com",
  "timeoutMs": 45000,
  "autoApply": false
}
```

Behavior:

1. Validate `cwd` as an absolute existing directory.
2. Pick an available local port.
3. Create an in-memory job record.
4. Spawn `node scripts/calibration-proxy.cjs ...`.
5. Return `{ "jobId": "..." }`.

The route should not accept arbitrary output paths. The capture location is derived from `cwd`.

### `GET /api/calibrate/auto/:jobId`

Returns:

```json
{
  "jobId": "...",
  "status": "running",
  "startedAt": "2026-06-26T00:00:00.000Z",
  "logFile": "/project/.claude-trace/api-log-...",
  "message": "waiting for Claude Code request",
  "result": null,
  "error": null
}
```

Statuses:

- `starting`
- `running`
- `captured`
- `extracting`
- `ready`
- `failed`
- `cancelled`

When the job is `ready`, `result` is the existing `ExtractedConstants` object returned by `extractConstants()`.

### `POST /api/calibrate/auto/:jobId/cancel`

Terminates the proxy script and Claude child process if still running. It should leave any already-written capture log in place for inspection.

## Job Management

Keep jobs in memory for the first version. A job stores:

- `jobId`
- `status`
- `cwd`
- `targetHost`
- `port`
- `startedAt`
- `completedAt`
- `logFile`
- recent output lines from the script
- `result`
- `error`
- child process handle

Expire completed jobs after a short retention window such as 15 minutes.

## Frontend UX

Update `CalibratePage` to make automatic calibration the primary path and keep manual upload below it.

Automatic section:

- Show current session `cwd`.
- Button: `自动截获并提取`.
- Optional prompt input defaulting to `say hi`.
- Progress text driven by job status.
- Capture failure message with a fallback hint.
- On `ready`, populate the existing `result` state and reuse the existing result cards.

Apply behavior remains explicit. The user still clicks `应用常量`; `autoApply` stays off by default.

Manual section:

- Keep drag-and-drop upload.
- Reword it as fallback: use this if automatic proxy capture cannot see Claude Code traffic.

## Error Handling

Important failures should be actionable:

- `claude` executable not found: tell the user to install or add Claude Code to `PATH`.
- Port unavailable: retry with another port before failing.
- Proxy starts but captures nothing: report that Claude Code may not honor `HTTPS_PROXY`.
- Certificate generation fails: show the `openssl` error summary.
- Claude exits non-zero: show recent proxy output and the exit code.
- Extractor fails: keep the log path and show the existing parse error.

## Security

The proxy only logs matching target requests. Headers must be redacted when keys contain:

- `authorization`
- `cookie`
- `key`
- `token`
- `secret`
- `auth`

The generated constants file stores only counts and metadata. The app should not expose raw request bodies in the UI.

The route validates `cwd` and derives log paths from it. It must not read arbitrary paths from client-provided input.

## Feasibility Probe

Before relying on the full automatic flow, implementation should include a minimal probe path:

1. Start the explicit proxy.
2. Launch `claude -p "say hi"` with `HTTPS_PROXY`.
3. Wait for a target `CONNECT` or request.
4. Mark the job failed if nothing arrives within the timeout.

This makes the uncertain part explicit: Claude Code must honor proxy environment variables in the user's environment.

## Testing

Add unit tests or focused integration tests for:

- Redacting sensitive headers.
- Parsing target and non-target CONNECT authority values.
- Extracting constants from a capture generated by the new proxy shape.
- Rejecting invalid `cwd` in the auto-start route.
- Job lifecycle transitions from `starting` to `ready`.
- Failure transition when no capture appears before timeout.

Manual verification:

1. Start the server.
2. Open an imported Claude Code session with a valid `cwd`.
3. Run automatic calibration.
4. Confirm no sudo prompt appears.
5. Confirm `<cwd>/.claude-trace/api-log-*.jsonl` is created.
6. Confirm result cards show `SYS_PROMPT_FALLBACK_CHARS`, `TOOL_DEFS_FALLBACK_CHARS`, and `SYSTEM_REMINDER_CHROME_CHARS`.
7. Apply constants and refresh a session to confirm new values are loaded.

## Migration

No database migration is needed. Existing manual upload and `PUT /api/calibrate/apply` behavior remain unchanged.

Existing `src/pipeline/system-constants.json` remains the destination for applied Claude Code constants.
