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
