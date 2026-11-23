# Architecture

```text
Browser
  │  HTTPS
  ▼
Go backend :8788
  ├── /api/*        REST + CSRF + HttpOnly session
  ├── /api/ws/*     PTY, LSP, task, DAP, browser-session proxies
  └── /*            React SPA served from frontend/dist
        │
        ├── MongoDB   users/sessions/workspaces/tasks/audit
        └── filesystem
             ├── workspaces/<id>   source, owned by workspace Unix UID
             └── homes/<id>        caches, chrome profiles, temp
```

Workspace processes (terminal, gopls, tsserver, Go/pnpm tasks, Delve, js-debug, Chromium) run under a dedicated non-root Unix UID. The API is the only process that runs as the backend service user.

Browser sessions are started by the backend (`--remote-debugging-port=0`), then js-debug attaches over CDP. The Go backend reloads the page after breakpoints are installed.

## Production image

`deploy/backend.Dockerfile` builds the React SPA in a Node stage and copies `dist` into `/opt/goland/web`. The Go binary serves both API and SPA on port 8788; it does not embed the assets in the binary. Compose publishes it as `GOLAND_PORT` (default 8080).

## Persistence

- MongoDB volume: users, sessions, workspace metadata, task history, audit.
- Goland data volume: source workspaces, per-workspace homes, encryption key.
- Source code never lives in MongoDB.
