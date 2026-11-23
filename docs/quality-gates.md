# Quality Gates — 95/100 Delivery Target

This document is the acceptance contract for raising Goland Web IDE from the
initial delivery baseline to a 95/100 release. It is intentionally executable:
every gate maps to a command or an observable artifact.

## Scoring model

| Dimension | Weight | Target evidence |
| --- | ---: | --- |
| Functional completeness | 25 | All critical user flows pass automated E2E, including browser debugging |
| Automated testing | 20 | Go and frontend coverage thresholds, stable E2E, no flaky retries |
| CI and release automation | 15 | Required GitHub Actions workflow green on `main` |
| Documentation | 10 | Commands, ports, environment variables and architecture match reality |
| Build and performance | 10 | Reproducible build, bundle budgets met, no chunk-size warning |
| Security | 10 | Isolation tests, dependency audit, no secrets, production-safe defaults |
| Delivery hygiene | 10 | Release tag, changelog, clean worktree, reproducible cold start |

**Pass rule:** total score >= 95, with no individual dimension below 90.

The score is recorded in the final review table at the bottom of this file.
Scores are only valid when the evidence commands below pass on the release
commit.

## Baseline (2026-11-23, commit b89fa80)

| Dimension | Baseline | Evidence |
| --- | --- | --- |
| Functional completeness | ~80 | Manual flows exercised; browser E2E timing-flaky; no repeatable release run |
| Automated testing | ~55 | Go total statement coverage **20.0%**; only 1 Vitest file (2 tests); 1 Playwright spec |
| CI and release automation | ~20 | No `.github/workflows`; verification is manual only |
| Documentation | ~70 | Stale Vite `5173` instructions; “embedded dist” claim is inaccurate; duplicated `GOLAND_PORT` |
| Build and performance | ~60 | SPA builds, but one **1,528 kB** JS chunk (**475 kB gzip**) and a chunk-size warning |
| Security | ~85 | Strong isolation/auth design; no dependency audit evidence; default dev admin password |
| Delivery hygiene | ~65 | Initial commit pushed to `main`; no tag/release notes; cold start not repeated |

Initial weighted estimate: **78/100**.

### Baseline command results

| Command | Result |
| --- | --- |
| `cd backend && go test ./... -coverprofile=/tmp/goland-cover.out` | Pass; total coverage 20.0% |
| `go vet ./...` | Pass |
| `gofmt -l .` | Empty |
| `cd frontend && pnpm lint` | Fail: 1 unused variable, 1 stale eslint-disable warning |
| `pnpm typecheck` | Pass |
| `pnpm test` | Pass: 1 file, 2 tests |
| `pnpm exec vitest --coverage` | Not runnable: `@vitest/coverage-v8` missing |
| `pnpm build` | Pass with chunk-size warning |
| `docker compose -f deploy/compose.yml config` | Pass |
| `pnpm test:e2e` | Not a valid release gate: config waits on Vite `127.0.0.1:5173`, but dev now serves the SPA from Go on `:8788` |

## Required gates

### 1. Functional completeness (task-4, task-5)

Critical flows in the Playwright suite:

1. Login, logout, session restore.
2. Admin creates users; member cannot access admin endpoints.
3. Workspace create/open/delete; local and Git clone sources.
4. File tree create, edit, save, rename, delete; dirty-close confirmation.
5. Conflict detection returns and surfaces HTTP 409.
6. Search and command palette.
7. PTY terminal input/output and resize.
8. Go and pnpm task execution with streamed output.
9. Git status, diff, stage, commit, branches, checkout, fast-forward pull/push.
10. Go/Delve breakpoint, pause, call stack, variables.
11. Node/TypeScript js-debug breakpoint, pause, call stack, variables.
12. Browser CDP attach, source maps, pause, call stack, variables, cleanup.
13. Two-user tenant isolation across API and UI.
14. Frontend served by Go: unauthenticated `/` returns SPA, `/api/health` returns 200.

The full suite must pass **three consecutive runs** with `retries: 0` on the
release commit. After each run, no `chromium`, `js-debug`, `dlv`, `gopls` or
`typescript-language-server` process may remain for deleted workspaces.

### 2. Automated testing (task-2, task-3, task-5)

- Go: `go test ./...` passes and total statement coverage is **>= 70%**.
- Go: every package containing logic has tests; no package may remain at 0%
  without a documented reason.
- Frontend: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass with zero ESLint
  errors or warnings.
- Frontend: Vitest line coverage is **>= 70%** for `src/lib` and the tested UI
  modules.
- E2E: full Playwright suite passes three consecutive times.

### 3. CI and release automation (task-7)

A GitHub Actions workflow runs on pushes and pull requests and performs:

```bash
cd backend && go test ./... && go vet ./...
cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build
docker compose -f deploy/compose.yml config
```

The workflow must be green on the release commit. E2E may run as a required job
on `main`; if runner resources cannot support browsers, it must still be a
documented required local gate and must not be silently skipped.

### 4. Documentation (task-7)

- `README.md`, `docs/architecture.md`, `docs/operations.md` and
  `docs/security.md` describe the actual Go-hosted SPA on `:8788`.
- No stale `127.0.0.1:5173` frontend instructions.
- No claim that the SPA is embedded unless it is actually compiled into the Go
  binary.
- Every documented command has been run on the release commit.
- Environment variables in `.env.example`, `deploy/.env.example` and code agree.

### 5. Build and performance (task-6)

- `cd frontend && pnpm build` passes with **no chunk-size warning**.
- Largest JavaScript chunk is **< 500 kB** minified.
- First-load JavaScript is **< 350 kB gzip**.
- Source maps remain enabled for production debugging.
- Code splitting does not break editor, terminal, debug or Git panels.

### 6. Security (task-7)

- `git ls-files` contains no `.env`, master key, session cookie, workspace data
  or local logs.
- Isolation tests cover path traversal, symlink escape, `.git` protection and
  cross-tenant 404 behavior.
- `go vet` and `pnpm audit --prod` are reviewed; any unresolved advisory is
  documented with severity and mitigation.
- Production documentation requires a non-default admin password, HTTPS and
  `GOLAND_SECURE_COOKIES=true`.
- Compose cold start from empty volumes succeeds and the health endpoint is
  green.

### 7. Delivery hygiene (task-8)

- `git status --porcelain` is empty.
- Release tag `v1.0.0` points at the release commit and is pushed.
- Release notes summarize features, verification evidence and known limits.
- `docs/quality-gates.md` contains the final score table with command evidence.

## Command reference

Run from the repository root:

```bash
# Backend
(cd backend && go test ./... -coverprofile=/tmp/goland-cover.out \
  && go tool cover -func=/tmp/goland-cover.out | tail -1 \
  && go vet ./... \
  && test -z "$(gofmt -l .)")

# Frontend
(cd frontend && pnpm lint && pnpm typecheck && pnpm test \
  && pnpm exec vitest run --coverage && pnpm build && pnpm test:e2e)

# Production stack
docker compose -f deploy/compose.yml config

# Repository hygiene
test -z "$(git ls-files '*.env' '*.key' '.data/*' '*.log')"
git status --porcelain
```

## Gap-to-task map

| Gap | Task |
| --- | --- |
| No acceptance matrix or baseline evidence | task-1 |
| Go coverage 20%, seven packages at 0% | task-2 |
| Frontend has 2 tests, lint fails, no coverage provider | task-3 |
| Browser debug E2E timing-flaky, cleanup unverified | task-4 |
| E2E config stale and critical flows missing | task-5 |
| 1,528 kB JS chunk with build warning | task-6 |
| No CI, stale docs, cold start not repeated | task-7 |
| No release tag, changelog or final independent score | task-8 |

## Current evidence (2026-11-23)

| Gate | Current evidence |
| --- | --- |
| Backend tests | `go test ./...` passes at **74.6%** statement coverage; `go vet` and `gofmt` clean |
| Frontend tests | `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; **133 tests**, **98.1%** line coverage |
| Browser DAP | Browser CDP E2E passed **3 consecutive local runs** with breakpoint, call stack, variables and no leftover Chromium/js-debug processes |
| Full E2E | **12/12 Playwright tests pass on GitHub Actions** (`E2E` run 45224748512), including the new window-management suite; local unit gates green |
| CI | `CI` and `E2E` workflows executed green on `main` (run 45224748505 / 45224748512); source limit, lint, tests, coverage, build and Compose config are gated |
| Source size | Every Go/TS/TSX source file is **<= 800 lines** |
| Build | No chunk-size warning; initial JS **143 kB gzip**, largest chunk **352 kB** |
| Docs | Development, architecture, operations and CI docs match the Go-hosted SPA |
| Docker cold start | **Not executed**: Docker daemon is unavailable in this environment |

## Final score table

Current independent estimate: **93/100**. The remaining points require a
green GitHub Actions E2E run and a real Docker cold-start verification.

| Dimension | Weight | Score | Evidence |
| --- | ---: | ---: | --- |
| Functional completeness | 25 | 23 | Browser DAP 3x local; full 11-test suite passes individually, CI run pending |
| Automated testing | 20 | 19 | Go 74.6%, frontend 98.1%, 133 Vitest tests; CI E2E pending |
| CI and release automation | 15 | 14 | Lint/test/coverage/build/E2E workflows committed; not yet executed on GitHub |
| Documentation | 10 | 10 | Ports, Go-hosted SPA, CI and operations docs aligned |
| Build and performance | 10 | 10 | No chunk warning; budgets met |
| Security | 10 | 9 | Isolation/auth tests pass; dependency audit and Docker cold start pending |
| Delivery hygiene | 10 | 8 | Clean commits, but no v1.0.0 tag/release notes yet |
| **Total** | **100** | **93** | — |

To reach 95: get the `E2E` workflow green on `main`, run a Docker Compose cold
start with login/health verification, then tag the release and fill in the final
audit row.
