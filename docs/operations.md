# Operations

## Development

```bash
mise install
mise run install
mise run db:start
mise run dev
```

UI and API: http://127.0.0.1:8788

`mise run dev` builds the SPA and starts the Go backend, which serves both `/` and `/api`. Playwright runs in the `E2E` GitHub Actions workflow.

## Production (Go-hosted SPA)

```bash
cp deploy/.env.example deploy/.env
# edit credentials and GOLAND_PORT
GOLAND_PORT=8080 docker compose -f deploy/compose.yml up -d --build
```

Only MongoDB and the Go backend run. Nginx is no longer required; the Go server serves `/` and `/api`.

## Backups

Back up both:
- the `mongo-data` volume (metadata),
- the `goland-data` volume (source workspaces, homes, master key).

Losing `master.key` makes stored Git tokens unreadable.

## Health

`GET /api/health` returns 200 when Mongo is reachable. Compose uses this endpoint for its healthcheck.

## Logs

```bash
docker compose -f deploy/compose.yml logs -f backend
```

## CI

- `CI` checks backend formatting, vet, tests and coverage, frontend lint/typecheck/tests/build, Compose configuration and the 800-line source limit.
- `E2E` runs Playwright on `main` or by manual dispatch. Reports, traces, screenshots and server logs are uploaded as workflow artifacts.

## Plugins

Installed packages live in `<GOLAND_DATA_DIR>/plugins/<plugin-id>/<version>/`; Mongo stores
their manifests and the per-workspace enable/configuration records. Back up both.

Install through the admin UI (**user menu → Plugins**) by uploading a zip with `manifest.json`
at the root (or inside one wrapper directory) or by entering an existing server directory.
A workspace owner enables and configures the plugin under **Workspace settings → Plugins**.
Disabling stops the host process; the package remains installed.

Build the example plugin and package it for upload:

```bash
cd plugins/demo
go build -trimpath -o bin/demo .
../../scripts/package-plugin.sh . demo.zip
```

Troubleshooting:

- `plugin_start_failed` — the executable is missing, not inside the package, or failed
  `initialize`/`health`; inspect the backend log and run the executable manually as the
  workspace user.
- `plugin_timeout` — a command exceeded 60s (hooks 10s); cancel or disable the plugin.
- `plugin_disabled` / 404 on a websocket — the workspace owner has not enabled the plugin,
  or the request belongs to another tenant.
- LSP/DAP failures appear as a plugin worker error notification in the editor/debug console;
  check the plugin server's stderr in the backend log.
