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

## Window management

The IDE shell is driven by a pure layout model in `frontend/src/lib/layout.ts` and the
`useIdeLayout` hook:

- `rows: string[][]` describes editor groups as rows of group ids (at most four groups,
  so splits can form a 2x2 grid). Each group stores tab paths and its own active path;
  open tab content remains in a single `tabs` array in `IDE.tsx`.
- Panel state stores the sidebar width/visibility/view and the bottom dock
  height/visibility/maximized flag/view. Widths and heights are clamped on read, on
  write and on window resize.
- Layout state is persisted to `localStorage` keyed by `goland.layout.<userId>.<workspaceId>`
  and validated by `sanitizeLayout`; corrupt JSON, unknown fields, duplicate paths and
  out-of-range sizes fall back to defaults or are clamped.
- After a reload the layout is restored first, then the tab paths assigned to each group
  are reopened through the files API; paths that no longer exist are dropped.

No backend endpoint or MongoDB schema is involved. `ResizeDivider`, `BottomPanel` and
`EditorGroups` split the UI into testable components, and `IDE.tsx` keeps the existing
tabs, LSP, PTY, task, Git and debug flows intact.

## Persistence

- MongoDB volume: users, sessions, workspace metadata, task history, audit.
- Goland data volume: source workspaces, per-workspace homes, encryption key.
- Source code never lives in MongoDB.
