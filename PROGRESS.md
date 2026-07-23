# Frontend ↔ Backend Wiring Progress

**Current phase:** Phase 5 — Fraud Graph (done). All 5 phases complete.
**Branch:** `feat/graph-export-devops`

Update this file as the last step of each phase/step below, before moving to the next one. It's the source of truth for "where are we" across sessions.

## Phase 0 — Foundations
- [x] Feature branch created (`feat/reconciliation-dashboard`)
- [x] `PROGRESS.md` added

## Phase 1 — Reconciliation Dashboard
- [x] `frontend/src/lib/types.ts` — types matching the real `/api/reconcile` response shape
- [x] `frontend/src/lib/api.ts` — fetch wrapper, `NEXT_PUBLIC_API_URL`-based
- [x] `frontend/.env.local.example`
- [x] `MetricCards` component
- [x] `AnomalyTable` component
- [x] `page.tsx` wired to real data (loading/error states, materiality input)
- [x] Manual end-to-end verification (backend + frontend dev servers, browser check) + `npm run lint` + `tsc --noEmit` — all clean

## Phase 2 — CSV Upload
- [x] `reconcileUpload()` + `templateUrl()` added to `frontend/src/lib/api.ts`
- [x] `CsvUploadPanel` component (3 file inputs, per-file template links)
- [x] Wired into `page.tsx` with a data-source indicator (database vs. upload) and a way back to live data
- [x] Manual end-to-end verification: downloaded real templates via curl, uploaded through the browser, confirmed metrics/table update and "switch back to live database" works + `npm run lint` + `tsc --noEmit` — all clean

## Phase 3 — E-Billing Panel
- [x] Status cards → `/api/e-billing/status` (`EbillingStatusCards`)
- [x] Async sync + polling → `/api/e-billing/sync/async` + `/api/e-billing/task/{id}` (`EbillingPanel`, 1s poll interval)
- [x] Logs table → `/api/e-billing/logs` (`EbillingLogsTable`)
- [x] Retry action → `/api/e-billing/retry/{id}` (retry button on failed rows)
- [x] Failure-rate monitor banner → `/api/e-billing/monitor` (`EbillingMonitorBanner`)
- [x] Manual end-to-end verification: triggered sync in the browser, watched task polling → completion banner → status/logs/monitor refresh, retried the one failed invoice + `npm run lint` + `tsc --noEmit` — all clean
- Note: upstream `main` picked up a backend migration (raw SQLite → SQLAlchemy engine, Postgres-ready) and JWT auth (`/api/auth/*`) while this branch was in progress — merged into this branch before starting Phase 3. Local dev still runs on SQLite by default; `.env` now needs `SECRET_KEY` (see `AUTH_NOTES.md`) or the backend fails to import.

## Phase 4 — Export & Polish
- [x] Excel export download → `/api/reconcile/export` (link next to the materiality input, only shown when viewing live-database data so the download always matches what's on screen)
- [x] Empty-state / error polish — audited existing loading/error/empty states (page.tsx, AnomalyTable, EbillingLogsTable, CsvUploadPanel, EbillingPanel) and found them already consistent; gave the new FraudGraph section the same treatment rather than inventing busywork
- [x] `npm run lint` + `tsc --noEmit` + `npm run build` — all clean

## Phase 5 — Fraud Graph
- [x] Backend: `app/services/graph_engine.py` — OMC↔depot leakage graph + Louvain community detection (`python-louvain`, already a dependency), pure-function core unit-tested in `tests/test_graph.py`
- [x] Backend: `app/routes/graph.py` (`GET /api/graph`), `app/schemas/graph.py`, mounted in `main.py`
- [x] Frontend: `FraudGraph` component — dependency-free SVG radial graph (risk-colored/shaped nodes, leakage-weighted edges, hover tooltip, click-to-pin detail panel) + companion risk-communities table
- [x] Manual end-to-end verification: browser-checked node colors/shapes, hover tooltip, click-to-select detail panel, communities table, no console errors + `npm run lint` + `tsc --noEmit` — all clean
- Note: this was previously blocked on the backend stub — built the backend piece too rather than waiting, per explicit instruction.

## DevOps
- [x] CI (`.github/workflows/ci.yml`): backend (generate data + ETL + pytest w/ coverage) and frontend (lint + typecheck + build) jobs on push/PR to `main`
- [x] Fixed the backend test suite, which was broken before this work started (24/42 tests erroring — two fixtures still patched a `DB_PATH` module constant removed by an earlier SQLAlchemy migration)
- [x] Local full-stack Docker Compose — `frontend/Dockerfile` + completed the `frontend` service in `docker-compose.yml` (was a commented-out stub)
- [x] Inert deployment templates (`render.yaml`, `frontend/vercel.json`) matching the platforms named in `PROBLEM_FRAMING_AND_ARCHITECTURE.md` — do nothing until connected to a real account; no account was created or secret provisioned
