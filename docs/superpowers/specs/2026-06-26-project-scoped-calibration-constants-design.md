# Project-Scoped Calibration Constants Design

## Purpose

Calibration constants currently apply globally because the UI writes one shared
`src/pipeline/system-constants.json`, and the pipeline reloads that file for
every imported or refreshed session. This is wrong when different projects use
different Claude Code routing, proxy, model, or tool environments.

Calibration constants should instead be scoped by project `cwd`. Sessions whose
transcripts resolve to the same project directory share one calibrated constants
file. Sessions from different project directories use their own constants.

## Goals

- Scope calibrated constants by project `cwd`.
- Reuse constants across sessions from the same project directory.
- Show "current effective constants" for the currently selected session's
  project, not for the whole app.
- Keep automatic capture logs and applied constants inside the project
  `.claude-trace/` directory.
- Keep the pipeline deterministic when importing or refreshing historical
  sessions by reading constants from the transcript's `cwd`.
- Fail clearly when the project `.claude-trace/` directory is not writable.

## Non-Goals

- Do not create per-session-id constants.
- Do not keep writing new calibrated constants to `src/pipeline/`.
- Do not migrate old global constants automatically into every project.
- Do not change the extracted constants shape.

## Storage

Applied constants are written to:

```text
<cwd>/.claude-trace/system-constants.json
```

The file stores the existing metadata and summary fields:

```json
{
  "appliedAt": "2026-06-26T00:00:00.000Z",
  "ccVersion": "2.1.170",
  "model": "deepseek-v4-pro",
  "cwd": "/absolute/project",
  "SYS_PROMPT_FALLBACK_CHARS": 6347,
  "TOOL_DEFS_FALLBACK_CHARS": 77058,
  "SYSTEM_REMINDER_CHROME_CHARS": 623
}
```

The backend validates that `cwd` is an existing absolute directory and derives
the constants path from it. The client never supplies an arbitrary output path.

## Backend API

### `GET /api/calibrate/current?cwd=<absolute project cwd>`

Returns the constants for that project `cwd`.

If the project constants file exists, return its JSON plus source metadata:

```json
{
  "source": "project",
  "path": "/project/.claude-trace/system-constants.json",
  "cwd": "/project",
  "appliedAt": "..."
}
```

If it does not exist, return built-in defaults with:

```json
{
  "source": "defaults",
  "note": "当前项目尚未应用校准常量。"
}
```

If `cwd` is missing or invalid, return `400` with a clear message.

### `PUT /api/calibrate/apply`

Request body includes the current session project `cwd`:

```json
{
  "cwd": "/absolute/project",
  "summary": {
    "SYS_PROMPT_FALLBACK_CHARS": 6347,
    "TOOL_DEFS_FALLBACK_CHARS": 77058,
    "SYSTEM_REMINDER_CHROME_CHARS": 623
  },
  "ccVersion": "2.1.170",
  "model": "deepseek-v4-pro"
}
```

The route writes `<cwd>/.claude-trace/system-constants.json` and returns the
written path. If `.claude-trace/` cannot be created or written, the route returns
an actionable permission error.

## Pipeline Data Flow

When importing or refreshing a Claude session:

1. Parse the transcript enough to discover its `cwd`.
2. Load project constants from `<cwd>/.claude-trace/system-constants.json`.
3. If the file is absent or invalid, reset to built-in defaults.
4. Run the existing pipeline with those active constants.

This prevents constants from one project from leaking into another project. It
also prevents a previous pipeline run from leaving module-level constants in a
dirty state for the next run.

Codex JSONL import remains unchanged unless it later uses the same constants.

## Frontend UX

`CalibratePage` uses `currentSession.cwd` for all constants endpoints.

- On mount and whenever the selected session `cwd` changes, call
  `GET /api/calibrate/current?cwd=<session cwd>`.
- The section title becomes `当前项目生效的常量`.
- Show the project `cwd` and constants source path when present.
- If no project constants exist, show that the current project has not applied
  calibration constants yet.
- `应用常量` sends the current session `cwd` in the request body.

Automatic capture already runs with the session `cwd`, so the extracted result
naturally belongs to that project.

## Error Handling

- Missing selected session: the page disables auto capture and apply actions.
- Invalid `cwd`: backend returns `400`; UI displays the error.
- Unwritable `.claude-trace/`: backend returns an error that includes the
  affected path and a suggested `chown` command.
- Missing project constants during import: use built-in defaults, not global
  calibrated constants from another project.

## Testing

Add focused tests for:

- Resolving project constants path from `cwd`.
- Loading project constants when present.
- Falling back to built-in defaults when project constants are missing.
- Resetting constants between pipeline runs so one project's values do not leak
  into the next.
- `GET /api/calibrate/current?cwd=...` returns project/default source metadata.
- `PUT /api/calibrate/apply` writes to `<cwd>/.claude-trace/system-constants.json`.
