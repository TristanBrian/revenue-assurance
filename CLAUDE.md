# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

KPC Revenue Assurance Platform: reconciles Dispatches → Invoices → Payments to detect revenue leakage (missing invoices, missing payments, under/overpayments) for Kenya Pipeline Company, plus a simulated E-Billing integration with KRA iCMS (retry logic, Dead Letter Queue, webhooks, monitoring). Built for the Inuka Hackathon 2026.

The repo is two independent apps with no shared code: `backend/` (FastAPI) and `frontend/` (Next.js). They are not yet wired together — the frontend is still the default `create-next-app` scaffold (only `layout.tsx`/`page.tsx`), while the backend is a working REST API.

## Commands

### Backend (run from `backend/`)

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Generate synthetic CSVs into data/raw/, then build the SQLite DB (data/clean -> ../kpc.db)
python scripts/generate_kpc_data.py
python scripts/etl_pipeline.py

# Run the API (reload enabled)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Data generation and ETL must be run before the DB-backed endpoints (`/api/reconcile`, `/api/e-billing/*`) will work — `kpc.db` is gitignored and not checked in. `scripts/etl_pipeline.py` reads from `data/raw/` relative to the CWD, so it must be run from `backend/`.

Tests:
```bash
pytest tests/ -v                                   # all tests
pytest tests/test_reconciliation.py -v              # single file
pytest tests/test_reconciliation.py::test_name -v   # single test
pytest tests/ --cov=app.services --cov-report=term  # coverage
```
There is no `pytest.ini`/`pyproject.toml` — tests rely on default discovery and each test file appends the backend root to `sys.path` manually.

### Frontend (run from `frontend/`)

```bash
npm run dev      # Next.js dev server (Turbopack)
npm run build
npm run lint
```

### Docker (from repo root)

```bash
docker compose up --build
```
This runs data generation, ETL, and the API server in sequence inside one container (see the `command:` in `docker-compose.yml`); there is no frontend service defined yet.

## Backend architecture

Request flow: `app/routes/*.py` (FastAPI routers, HTTP concerns only) → `app/services/*.py` (business logic, pure-ish functions) → SQLite (`backend/kpc.db`) via raw `sqlite3` + `pandas.read_sql`, not an ORM despite SQLAlchemy being a dependency.

- **`app/main.py`** — app factory, CORS, and router registration. Only `reconcile` and `e_billing` routers are actually mounted here.
- **`app/routes/reconcile.py`** — `/api/reconcile*`: run reconciliation from DB, upload-your-own-CSVs variant (with strict column validation), CSV template downloads, Excel export.
- **`app/routes/e_billing.py`** — `/api/e-billing/*`: sync (sync + async/background-task variants), task polling, retry, webhook, logs, monitoring.
- **`app/services/reconciliation.py`** — the core engine. `run_reconciliation_on_dataframes()` is the pure function (accepts 3 DataFrames, returns metrics/anomalies/data-quality/OMC-risk dict) used by both the DB-backed and CSV-upload paths; `run_reconciliation()` just loads the three tables from SQLite and delegates to it. Column names are resolved dynamically (e.g. `customer_name`/`customer`/`omc_id`) rather than hardcoded, so schema drift between raw CSVs and DB tables doesn't break it.
- **`app/services/e_billing.py`** — simulated KRA iCMS integration: `call_kra_api()` randomly fails (~10%) to emulate real-world flakiness, wrapped in a `retry_on_failure` decorator (3 attempts, exponential backoff). Failures land in the `ebilling_dlq` table. Async sync (`/sync/async`) uses FastAPI `BackgroundTasks` with an **in-memory** `task_status` dict — task state is lost on restart and won't work across multiple workers/replicas.
- **`app/utils/db_connection.py`** / inline `sqlite3.connect(DB_PATH)` calls in services — `DB_PATH` is computed as `backend/kpc.db` via `os.path.dirname` chains, independent of CWD.
- **`app/models/`** — Pydantic schemas; only `reconciliation.py` and `e_billing.py` have content, `audit.py` and `transactions.py` are empty placeholders.
- **`app/routes/anomalies.py`, `app/routes/audit.py`, `app/routes/graph.py`, `app/services/graph_engine.py`, `app/services/metrics.py`** — empty stub files, not implemented and not mounted in `main.py`. The README's fraud-detection/graph feature (NetworkX + python-louvain, listed in `requirements.txt`) is not yet built despite being in the architecture diagram.

### Reconciliation logic specifics (`services/reconciliation.py`)

- Break types: `Missing Invoice` (no invoice row), `Missing Payment` (invoice exists, nothing paid), `Underpayment`/`Overpayment` (diff beyond `UNDERPAYMENT_THRESHOLD` = KSh 100), else `Reconciled`.
- `status` escalates to `Critical` for missing invoice/payment, or for underpayments older than `CRITICAL_AGE_DAYS` (60); overpayments are always `Review Required`.
- `materiality` (default KSh 100,000, passed as a query param) filters anomalies by `leakage_kes` after break detection, not before.
- Payments are aggregated per `invoice_id` before merging (handles multi-installment payments).
- Duplicate detection and OMC risk bucketing (`Low`/`Medium`/`High` by cumulative leakage) run as separate post-processing steps and are included in the response alongside `metrics`/`anomalies`.

## Frontend

Standard Next.js 16 (App Router) + React 19 + Tailwind 4 + TypeScript scaffold — no custom pages, components, or API client exist yet (`src/app/` only has the generated `layout.tsx`/`page.tsx`).

`frontend/CLAUDE.md` imports `frontend/AGENTS.md`, which instructs agents to check `node_modules/next/dist/docs/` before writing Next.js code since this Next.js version (16.2.11) may differ from training data — this is legitimate boilerplate from `create-next-app`, not project-specific guidance. Follow it when working in `frontend/`.

## Environment variables

Copy `.env.example` to `.env` at the repo root. Key ones: `DATABASE_URL`, `CORS_ORIGINS`, `MATERIALITY_THRESHOLD`, `CRITICAL_AGE_DAYS`, `KRA_ICMS_*`. Note the backend code does not currently read most of these from env — `MATERIALITY_THRESHOLD`/`CRITICAL_AGE_DAYS`/KRA endpoint/key are hardcoded constants in `app/services/reconciliation.py` and `app/services/e_billing.py`, so changing `.env` alone won't change behavior without also updating those constants.
