# Goland Web IDE

A self-hosted web IDE focused on **Go** and **TypeScript**. It combines a React + CodeMirror 6 frontend, a Go API, MongoDB metadata storage, per-workspace Linux user isolation, LSP, PTY terminals, task running, Git and DAP debugging.

## Status

Implemented:

- Multi-user admin-created accounts, HttpOnly sessions, CSRF, RBAC.
- Local-directory workspaces and Git HTTPS clones.
- Per-workspace unprivileged Unix UID; terminal, LSP, task and debug processes run as that UID.
- File tree, CodeMirror tabs, editing/saving, conflict detection, search.
- Window management: draggable sidebar/bottom-panel splitters, collapsible and maximizable panels, up to four editor groups with tabs dragged between groups, and per-user/workspace layout persistence.
- gopls and typescript-language-server: diagnostics, completion, hover, definition, references, formatting.
- xterm.js PTY terminal, Go/pnpm tasks with streamed output.
- Delve DAP for Go and js-debug DAP for Node/TypeScript: breakpoints, call stack, variables.
- Browser CDP attach, source maps, breakpoints, call stack, variables and session cleanup.
- Git status/diff/stage/commit/branches/checkout/fast-forward pull/push.
- AES-256-GCM encrypted Git tokens.
- Docker Compose production stack definitions.
- Ten languages (including RTL), light/dark themes and a focused settings dialog.
- Go and Vitest coverage gates, ESLint/typecheck, source file limit and GitHub Actions CI.

Verification status:

- Go tests: 74.6% statement coverage, `go vet` and `gofmt` clean.
- Frontend: ESLint, typecheck, 133 Vitest tests at 98% line coverage.
- Playwright is configured to run the full suite in the GitHub Actions `E2E` workflow and upload reports, traces, screenshots and logs. Local Playwright runs are optional because the browser debug suite is resource-heavy.
- Repeat the Compose cold-start check after infrastructure changes.

## Layout and shortcuts

The IDE layout is stored in `localStorage` under `goland.layout.<userId>.<workspaceId>`,
so two users or two workspaces never share panel sizes or editor groups. Corrupt or
out-of-range data falls back to the default layout.

| Action | Shortcut |
| --- | --- |
| Toggle sidebar | `⌘/Ctrl+B` or click the active activity-bar icon |
| Toggle terminal dock | `⌘/Ctrl+Backtick` |
| Split editor right | `⌘/Ctrl+\` |
| Split editor down | `⌘/Ctrl+Shift+\` |
| Close active editor group | `⌘/Ctrl+Alt+\` |
| Reset layout | `⌘/Ctrl+Alt+0` or the command palette |

Splitters support pointer dragging, arrow keys, and double-click to reset. Drag a tab
onto another editor group to move it; a file never appears in two groups at once.
Below 900px viewport width the IDE renders only the active group and disables splitting.

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

- UI and API: <http://127.0.0.1:8788>
- MongoDB: `127.0.0.1:27019`

`mise run dev` builds `frontend/dist` and lets the Go backend serve both the SPA and `/api`.

Default development administrator:

```text
admin@goland.local / admin123456
```

Change it in production.

## Production (Docker Compose)

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env
GOLAND_PORT=8080 docker compose -f deploy/compose.yml up -d --build
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

## Continuous integration

- `CI` runs backend formatting/vet/tests/coverage, frontend lint/typecheck/tests/build, Compose validation and the 800-line source file limit.
- `E2E` runs the Playwright suite on `main` and on manual dispatch. It starts a root backend with Unix UID isolation, installs Chromium, gopls, Delve and the TypeScript language server, and uploads artifacts.

## Documentation

- [Architecture](docs/architecture.md)
- [Security model](docs/security.md)
- [Operations](docs/operations.md)
- [Quality gates](docs/quality-gates.md)

## Layout

```text
backend/                 Go API, auth, files, LSP, PTY, tasks, Git, DAP
frontend/                React IDE
deploy/                  Compose, Dockerfiles, vendored js-debug
.data/                   local Mongo, caches and workspace data (ignored)
```

## Verification commands

```bash
./scripts/check-file-length.sh
cd backend && go test ./... -coverprofile=/tmp/goland-cover.out
./scripts/check-go-coverage.sh /tmp/goland-cover.out 70
cd frontend && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
docker compose -f deploy/compose.yml config
```

Playwright runs in the `E2E` GitHub Actions workflow rather than the local iteration loop.
