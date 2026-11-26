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

## Plugin system

```text
Admin upload/path ──► internal/plugins.Installer ──► <data>/plugins/<id>/<version>/
                                                   └► Mongo plugins + workspacePlugins
Workspace owner ──► enable/config ──► HostManager ──► plugin process (workspace UID)
                                                     │  JSON-RPC 2.0 over stdio
Frontend ──► /api/workspaces/{id}/plugins             │  commands, hooks, ui/* notifications
         └─► /api/ws/workspaces/{id}/plugins          │
         └─► .../plugins/{plugin}/lsp/{server} ───────┘  stdio LSP/DAP framing
```

### Manifest and validation

`internal/plugins/manifest.go` defines `pluginApiVersion: 1`: id, name, semver version,
executable, and contributions (commands, panels, status, settings, hooks, editorActions,
languages, debuggers). Parsing rejects unknown fields, oversized manifests, duplicate ids,
commands outside the plugin-id namespace, invalid form fields, unknown command references
and unsafe server paths. `ValidatePackage` additionally resolves every executable inside the
installed directory and rejects symlink escapes.

### Installation and storage

`internal/plugins/install.go` accepts a local directory or zip. Extraction rejects absolute
paths, `..`, backslashes, symlinks, duplicate entries, excessive depth, more than 2000 files
and more than 64 MiB. Packages are staged and renamed into `plugins/<id>/<version>/`.
`internal/store/plugins.go` persists installed packages and per-workspace enable/config
records (`plugins` and `workspacePlugins` collections, unique per workspace+plugin).

### Host process and protocol

`internal/plugins/host.go` starts the manifest executable as the workspace UID with the
workspace root as cwd and the identity environment (`HOME`, `TMPDIR`, caches). Messages are
newline-delimited JSON-RPC 2.0; `initialize` receives workspace id, root and merged config;
`health` must return `ok`. Requests have timeouts, output is capped, and crashes fail pending
calls and surface a `crashed` event. `HostManager` keeps one host per workspace/plugin,
restarts crashed hosts lazily and stops process groups on disable, uninstall, workspace
delete or shutdown.

Plugin notifications (`command/output`, `ui/status`, `ui/panel`, `ui/notify`, `log`) fan out
through `pluginEventHub` to `/api/ws/workspaces/{id}/plugins`. Command execution is an
authenticated `POST /plugins/{plugin}/commands/{command}` and can be cancelled with
`POST /plugins/{plugin}/cancel`.

### Hooks

`internal/server/plugins_hooks.go` runs `onOpen` before returning file content, `onSave`
before writing (chained content transforms), `preCommit` before Git commits, and `postPull`
after a successful fast-forward. Each call is audited with plugin, hook, path and duration.
Plugin errors follow the manifest `failure` policy (`open` skips, `closed` blocks).

### Frontend modules

Plugins may declare `contributes.frontends` entries whose `entry` is a `.js`/`.mjs` ES module.
The host imports the module with native `import()`, expects a default-exported custom element
class, defines it, and mounts it in the sidebar after setting an `api` property. The API exposes
workspace metadata, theme/language, command execution, cancellation, notifications, file opening
and a `configure()` action that opens the plugin settings panel. Plugins should use Shadow DOM
for style isolation. This is native page code, not an iframe; only administrator-installed
plugins can contribute it, and they are trusted with the user's page privileges.

First-party plugins share the host-served `/plugin-ui.js` kit: theme-aware tokens, form and
action primitives, a streaming output console, keyboard shortcuts, error banners and persisted
inputs. The kit is loaded from the same origin as the SPA and is not bundled into each plugin,
so the host can improve the console design without repackaging every plugin. Plugin views are
widened automatically when opened and remain responsive down to the mobile overlay width.

### Commands, menus and keybindings

The IDE has a single command registry assembled from built-in palette actions and every enabled
plugin command. `useCommandSystem` resolves default shortcuts, plugin `contributes.keybindings`
entries and per-user overrides, detects conflicts, and dispatches global keydown events through
the same command objects used by the command palette. Built-in defaults cover save, terminal,
sidebar, explorer/search/outline/Git, testing, debugging, breakpoints, rename, split, reset and
the command palette.

The command center is a dedicated configuration window opened from the Help menu, the account
menu or `Mod+Alt+K`. It has three sections:

- **Commands** — search all built-in/plugin commands, inspect ids, sources, categories and
  current shortcuts, and run a command directly.
- **Keybindings** — record a new shortcut, unbind with Backspace/Delete, see conflict warnings
  and defaults, reset one or all bindings.
- **Menus** — toggle menu entries and reorder them. Preferences are persisted per user.

Plugins can contribute `menus` entries (`{ id, label, items: [{ command, label?, group? }] }`)
and `keybindings` (`{ command, key }`). Unknown menu ids create a plugin menu; plugin commands
that are not placed explicitly are grouped under **Tools**. The manifest validator checks that
all menu/keybinding commands exist, enforces limits and rejects duplicate menu/keybinding ids.
Command/menu/shortcut preferences are stored in browser localStorage per user and never grant
additional backend permissions.

### Editor, language and debugger integration

The frontend `usePlugins` hook loads workspace plugin state, subscribes to events and maps
commands/panels/status/settings into the existing IDE. `usePluginContributions` builds
palette commands and editor actions. `PluginPanel`, `PluginSettingsSection` and
`PluginStatusBar` render only predefined field types (text, textarea, number, boolean,
select) from the manifest. `LSPClient` and `DAPClient` accept a plugin-provided websocket
URL, so plugin languages and debugger kinds reuse the existing diagnostics, completion,
breakpoint, stack and variable code.

### Security boundary

Plugins are trusted code running as the workspace Unix user. The host controls UID, cwd,
environment, timeouts, output, process cleanup and audit, but does not provide a capability
sandbox or network namespace. Installation is admin-only; enablement requires workspace
ownership; cross-tenant requests return 404. See [security.md](security.md#plugins).

## Persistence

- MongoDB volume: users, sessions, workspace metadata, task history, audit.
- Goland data volume: source workspaces, per-workspace homes, encryption key.
- Source code never lives in MongoDB.
