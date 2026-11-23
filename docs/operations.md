# Operations

## Development

```bash
mise install
mise run install
mise run db:start
mise run dev
```

Frontend: http://127.0.0.1:5173
API: http://127.0.0.1:8788

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
