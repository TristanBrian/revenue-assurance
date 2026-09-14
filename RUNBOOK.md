# Reconova operations and handover

## Scope and release status

Hackathon 3, Domain 4: Problem 7 (demurrage billing) and Problem 8 (meter-to-invoice reconciliation). See [alignment assessment](docs/HACKATHON_3_ALIGNMENT.md) for implemented features, gaps, and acceptance criteria. The current gantry display is synthetic; it does not control depot gates or issue demurrage invoices. Do not present recorded payments or forecast exposure as realized savings.

The existing mobile instructions are retained in [Mobile runbook](docs/MOBILE_RUNBOOK.md).

## Architecture and ownership

- `frontend/`: Next.js executive and analyst UI, deployed as a separate Vercel project. Browser calls FastAPI using `NEXT_PUBLIC_API_URL` and bearer tokens.
- `backend/`: FastAPI, SQLAlchemy, Alembic, reconciliation, audit, alerts and e-billing. Fly.io is the primary target; Render configuration is an alternative.
- PostgreSQL: durable operational and audit state. CSV ETL owns reconciliation tables; Alembic owns auth/audit/workflow tables. ETL replaces tables and must never be a routine production startup operation.
- Optional Base Sepolia anchoring: configured through backend secrets. A successful local hash check does not establish on-chain confirmation.
- Optional model training, graph refresh and audit anchoring run inside the API process. Use one API instance until scheduled work is externalized or protected with distributed locks.
- SAP, SCADA, KRA production contracts and enterprise SSO remain integration work. The existing KRA adapter simulates responses.

## Required deployment configuration

Never commit `.env` or paste its contents into logs. Configure these through the host's secret/environment settings:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Dedicated persistent PostgreSQL database; never ephemeral SQLite in production |
| `SECRET_KEY` | Strong random signing secret, shared across instances; rotate with a session-reset plan |
| `CORS_ORIGINS` | Exact comma-separated frontend HTTPS origins, e.g. `https://flowguardd.vercel.app`; embedded wildcards are not supported |
| `PORT` | 8000 on Fly; Render supplies/configures its port |
| `NEXT_PUBLIC_API_URL` | Backend HTTPS origin, set in Vercel **before building**, with no `/api` suffix |
| `INUKA_STREAM_SIMULATOR` | `false` for production; `true` only for a dedicated synthetic demo |
| `BOOTSTRAP_DEMO_DATA` | Defaults to `false`; `true` regenerates synthetic CSVs and replaces ETL tables on every startup |
| `RUN_MIGRATIONS` | Defaults to `true`; disable only when an external release job runs migrations and role/terms seeds |
| `BOOTSTRAP_ADMIN` | Defaults to `false`; temporary first-admin bootstrap flag |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | Required for admin bootstrap; password minimum 12 characters |
| `SEED_DEMO_USERS` | Defaults to `false`; opt-in reset of synthetic demo accounts |

### Vercel

1. Import the `revenue-assurance` Git repository and set project Root Directory to `frontend` (not the repository root, which contains Expo dependencies).
2. Framework: Next.js; install: `npm ci`; build: `npm run build`. Use Node 20 or 22. `frontend/vercel.json` contains the build settings.
3. Set `NEXT_PUBLIC_API_URL` for each intended environment. Set the corresponding exact frontend origin in backend `CORS_ORIGINS`.
4. Redeploy after changing any public environment variable: values are compiled into browser assets.
5. Verify sign-in, an authenticated reconciliation request, and a failed-verification case. Do not use green sample cards as a health check.

### Fly.io

Run from the repository root containing `fly.toml` and `Dockerfile`:

```bash
fly status
fly secrets list
fly deploy
fly checks list
fly logs
```

Before deployment, attach/configure a PostgreSQL database and required secrets. The image uses Python 3.12, CPU-only XGBoost, and OpenMP (`libgomp1`). The HTTP service checks `/health`; database failures return 503. `/ping` is process liveness only. Container health probes honor `PORT`.

Run migrations once per release when scaling beyond a single instance; concurrent startup migrations are not supported. Do not run a live ETL bootstrap just to resolve a schema error.

### Render alternative

The Blueprint explicitly uses the root Dockerfile and repository-root Docker build context. This Dockerfile copies `backend/` into `/app`. Supply PostgreSQL and exact CORS origins through Render settings. Deployments use `checksPass`; ensure the repository's GitHub checks are visible to Render. Free-tier service capacity and sleep behavior must be assessed before claiming 24/7 readiness.

### Initial data and admin bootstrap

For an empty **dedicated demo database only**, run the following from `backend/` with its `DATABASE_URL` configured:

```bash
python scripts/generate_kpc_data.py
mkdir -p data/raw
cp scripts/data/raw/*.csv data/raw/
python scripts/etl_pipeline.py
alembic upgrade head
python scripts/seed_roles.py
python scripts/seed_terms_documents.py
python scripts/seed_admin.py
```

Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` before the final command. Existing accounts are left unchanged. Remove bootstrap secrets/flags afterward. A deployed account created by the old fixed-credential seed must have its password changed by the operator; this code change does not revoke existing accounts.

Production requires a validated data import/integration process. Empty operational tables are not repaired by automatically inserting synthetic records.

## Verification and CI

```bash
# frontend/
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run build

# backend/ in an isolated test environment
pip install -r requirements.txt
alembic heads
pytest tests/ -q
```

Fresh SQLite Alembic migrations are currently unsupported because historical revisions use PostgreSQL ALTER operations. Use PostgreSQL for migration/startup verification; SQLite remains a test/ETL convenience.

Legacy backend ETL tests require the synthetic ETL dataset. Never point tests at a production database. CI generates its own SQLite dataset and separately tests migrations twice on PostgreSQL 16. Frontend unit tests are scoped to `src/**/*.test.*`; browser tests run separately with `npm run test:e2e` and a configured test backend.

CI does not yet publish Fly/Vercel releases itself. Vercel Git integration and manual Fly deployment remain host-side setup; require passing CI before a release. Do not describe CI success as proof that live credentials, DNS, callbacks or telemetry work.

## API reference and operational checks

Interactive API specifications: `/docs` and `/openapi.json` on the backend. Normal JSON responses use `{Success, Message, Data, Timestamp}`.

| Endpoint | Meaning |
| --- | --- |
| `GET /ping` | Process liveness |
| `GET /health`, `HEAD /health`, `GET /api/health` | Database connectivity; HTTP 503 on failure, 200 on success |
| `POST /api/auth/login` | Session sign-in; may require terms acceptance/password reset |
| `GET /api/reconcile/gantry-lanes` | **Synthetic demo** lane snapshot with explicit `source` |
| `GET /api/audit/verify` | Permission-protected local integrity and independent anchor verification |
| `POST /api/reports/verify` | Matches uploaded bytes to recorded export hashes; UNKNOWN is not VERIFIED |

Report hashing uses SHA-256 and backend HMAC-SHA256, not an Ed25519 digital signature. The UI must never infer report authenticity from a locally computed hash. Verification failures display unavailable status. A full Merkle proof viewer remains future work.

## Incident response and monitoring

Assign named Em-Tech primary and KPC IT backup owners before go-live. Configure an external uptime monitor for `/health` and a separate frontend sign-in smoke check. PagerDuty/Slack escalation for infrastructure failures is not configured by this repository.

1. Record release commit, timestamp, affected host, HTTP status and redacted error.
2. Inspect host logs, health checks, memory pressure and database availability.
3. For build failures, reproduce `npm ci && npm run build` or Docker build from the documented context. Do not disable TypeScript/test gates.
4. For migration failures, run `alembic current` and `alembic heads` against the affected database. Never generate merge revisions on startup or blindly stamp to head. Recover the missing revision from release history.
5. For CORS errors, compare the browser Origin to the exact configured allowlist. Check that the compiled frontend API origin points to the correct host.
6. For failed tax/ERP submissions, inspect adapter logs and DLQ; reconcile external receipt status before replay. The current simulated adapter is not suitable for real tax submissions.
7. For integrity/anchor mismatches, preserve logs and database evidence and escalate to the audit owner. Do not reseal or rewrite history to make checks green.

## Backup, recovery and rollback

Proposed service objectives requiring owner approval: RPO 1 hour, RTO 4 hours. Enable managed PostgreSQL backups/PITR and test restore before launch. Retain release image/commit, migrations, encrypted secret recovery procedures, model artifacts and relevant CSV provenance.

- Take a database snapshot before migration or bulk ingestion.
- Restore into a new isolated PostgreSQL instance, never over the sole live copy.
- Match the restored database's Alembic revision to the application release. Run auth/reconciliation checks and local/on-chain audit verification before changing application connection settings.
- Redeploy the last known good image for application rollback only when schema compatibility is established. Prefer forward schema repair to untested downgrade migrations.
- Record restore start/end times and lost-event reconciliation results; measure achieved RPO/RTO.

## Formal handover checklist

Em-Tech engineering owns application releases and incident diagnosis; KPC IT owns identity, infrastructure access and business-system connectivity; Revenue Assurance owns rate/tolerance approval and reconciliation decisions. These are proposed responsibilities until named owners sign off.

Before acceptance, record: repository and host ownership, secret custody, approved product tolerances and contract rates, API sandbox test receipts, CI results, production smoke-test evidence, restore-drill results, data-retention policy, escalation contacts, and a dated acceptance record from Em-Tech and KPC IT. Attach the ROI assumptions and demo script in the alignment assessment.

Provider references: [Fly configuration](https://fly.io/docs/reference/configuration/), [Render Blueprint](https://render.com/docs/blueprint-spec), [Vercel build settings](https://vercel.com/docs/builds/configure-a-build), [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables), [XGBoost CPU installation](https://xgboost.readthedocs.io/en/stable/install.html).
