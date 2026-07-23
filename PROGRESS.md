# Frontend ↔ Backend Wiring Progress

**Current phase:** Phase 3 — E-Billing Panel (done) → next up: Phase 4 (Export & Polish)
**Branch:** `feat/e-billing-panel`

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

## Phase 4 — Export & Polish (not started)
- [ ] Excel export download → `/api/reconcile/export`
- [ ] Empty-state / error polish

## Phase 5 — Fraud Graph (blocked)
- Blocked on backend: `app/services/graph_engine.py` and `app/routes/graph.py` are empty stubs, not mounted in `main.py`. No frontend work until that exists.
