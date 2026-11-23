# Goland Web IDE

A self-hosted web IDE focused on **Go** and **TypeScript**. It combines a React + CodeMirror 6 frontend, a Go API, MongoDB metadata storage, per-workspace Linux user isolation, LSP, PTY terminals, task running, Git and DAP debugging.

## Status

Implemented and manually exercised:

- Multi-user admin-created accounts, HttpOnly sessions, CSRF, RBAC.
- Local-directory workspaces and Git HTTPS clones.
- Per-workspace unprivileged Unix UID; terminal, LSP, task and debug processes run as that UID.
- File tree, CodeMirror tabs, editing/saving, conflict detection, search.
- gopls and typescript-language-server: diagnostics, completion, hover, definition, references, formatting.
- xterm.js PTY terminal, Go/pnpm tasks with streamed output.
- Delve DAP for Go and js-debug DAP for Node/TypeScript: breakpoints, call stack, variables.
- Git status/diff/stage/commit/branches/checkout/fast-forward pull/push.
- AES-256-GCM encrypted Git tokens.
- Docker Compose production stack definitions.

Known gaps:

- Browser CDP attach, source-mapped pause, call stack, variables and browser-session cleanup are implemented; the automated browser E2E is still timing-flaky under the current low-memory host and is not yet a release gate.
- Automated test suites (Go integration, Vitest, Playwright) and ESLint are not yet complete.
- Compose was rebuilt and verified with the Go backend serving the SPA; repeat the cold-start test after infrastructure changes.
- Git push and two-user isolation are covered by Go integration tests; full Playwright suite still needs a stable browser-debug run.

## Toolchain

Tool versions are pinned in `.mise.toml`:

```bash
mise install
mise run install
```

Install local language/debug tools:

```bash
mise run tools
```

## Development

```bash
mise run db:start
mise run dev
```

- UI: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:8788>
- MongoDB: `127.0.0.1:27019`

Default development administrator:

```text
admin@goland.local / admin123456
```

Change it in production.

## Production (Docker Compose)

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env
GOLAND_PORT=8080 GOLAND_PORT=8080 docker compose -f deploy/compose.yml up -d --build
```

Open <http://localhost:8080>. The Go backend hosts both `/api` and the SPA. If 8080 is occupied, set another port, e.g. `GOLAND_PORT=18080`.

The Compose stack runs MongoDB and the Go backend. The Go backend serves the compiled SPA itself (no separate frontend container). The backend runs as root **only** to provision workspace users and drop privileges for all workspace processes. Source files live in the `goland-data` volume; MongoDB holds metadata only.

## Security model

- Every workspace gets an independent unprivileged Linux user and a `0700` workspace directory.
- Workspace processes (terminal, LSP, tasks, debug adapters) run under that user.
- API access is scoped by `ownerId`; cross-tenant requests return 404.
- File paths are canonicalized and checked against the workspace root, including symlink escapes; `.git` is protected.
- Git tokens are encrypted at rest; secrets and tokens are redacted from logs.
- Authentication uses HttpOnly SameSite cookies plus a double-submit CSRF token.

For production, use HTTPS, set `GOLAND_SECURE_COOKIES=true`, use a long administrator password, and expose only the frontend port.

## Configuration

See `.env.example`. Important variables:

| Variable | Meaning |
| --- | --- |
| `GOLAND_MONGO_URI` | MongoDB connection string |
| `GOLAND_WORKSPACE_ROOTS` | Colon-separated allowed workspace roots |
| `GOLAND_ADMIN_EMAIL` / `GOLAND_ADMIN_PASSWORD` | Bootstrap administrator |
| `GOLAND_MASTER_KEY` | Base64 32-byte key for Git-token encryption |
| `GOLAND_ISOLATION` | `auto`, `user`, or `none` |
| `GOLAND_DEV_PERMISSIONS` | Development-only traversal permissions for `/root` toolchains |
| `GOLAND_GOPLS` / `GOLAND_TSSERVER` / `GOLAND_DLV` | Language/debug binaries |
| `GOLAND_JS_DEBUG` / `GOLAND_CHROME` | js-debug adapter and Chromium path |

## Documentation

- [Architecture](docs/architecture.md)
- [Security model](docs/security.md)
- [Operations](docs/operations.md)

## Layout

```text
backend/                 Go API, auth, files, LSP, PTY, tasks, Git, DAP
frontend/                React IDE
deploy/                  Compose, Dockerfiles, vendored js-debug
.data/                   local Mongo, caches and workspace data (ignored)
```

## Verification commands

```bash
cd backend && go test ./...
cd frontend && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
docker compose -f deploy/compose.yml config
```
