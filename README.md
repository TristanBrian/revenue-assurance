# KPC Revenue Assurance Platform

**Reconciliation engine for Kenya Pipeline Company**
Detects Order-to-Cash leakage and integrates with KRA's e-billing (iCMS) system.

## Overview

KPC loses revenue in its Order-to-Cash cycle through:

- **Missing invoices** — fuel dispatched, no bill sent
- **Missing payments** — bills sent, never paid
- **Underpayments** — paid less than invoiced

This platform reconciles Dispatches → Invoices → Payments, flags these breaks, and exposes the results via a REST API (with Swagger/OpenAPI docs). It also includes a simulated E-Billing integration with KRA iCMS: retry logic, a dead letter queue, webhook callbacks, and failure-rate monitoring.

## Architecture

```mermaid
graph TD
    subgraph Data_Layer["Data Layer"]
        CSV[("Raw CSVs")]
        DB[("SQLite DB")]
    end

    subgraph Service_Layer["Backend Services"]
        ETL["ETL Pipeline"]
        Recon["Reconciliation"]
        Fraud["Fraud Detection"]
        EBill["E-Billing"]
    end

    subgraph API_Layer["API Layer"]
        API["FastAPI"]
        Routes["/reconcile · /upload · /sync · /status · /export · /webhook"]
    end

    subgraph UI_Layer["Frontend"]
        Dashboard["Dashboard"]
        Cards["Metric Cards"]
        Table["Anomaly Table"]
        Graph["Fraud Graph"]
        EBillUI["E-Billing Status"]
    end

    CSV -->|Load| ETL
    ETL -->|Clean & Aggregate| DB
    DB -->|Query| Recon
    DB -->|Query| Fraud
    DB -->|Query| EBill

    Recon -->|JSON| API
    Fraud -->|JSON| API
    EBill -->|JSON| API
    API --> Routes

    Routes -->|JSON| Dashboard
    Dashboard --> Cards
    Dashboard --> Table
    Dashboard --> Graph
    Dashboard --> EBillUI

    classDef data fill:#e8daef,stroke:#8e44ad,stroke-width:2px,color:#000
    classDef service fill:#dae8fc,stroke:#6c8ebf,stroke-width:2px,color:#000
    classDef api fill:#fff2cc,stroke:#d6b656,stroke-width:2px,color:#000
    classDef ui fill:#f8cecc,stroke:#b85450,stroke-width:2px,color:#000

    class CSV,DB data
    class ETL,Recon,Fraud,EBill service
    class API,Routes api
    class Dashboard,Cards,Table,Graph,EBillUI ui
```



`Fraud` and the `Fraud Graph` UI represent planned work — the backend service and route are currently stubs (see [Project Status](#project-status)).

## Key Features


| Feature                  | Description                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Three-way reconciliation | Matches Dispatches → Invoices → Payments to detect missing invoices, missing payments, and under/overpayments. |
| E-Billing integration    | Syncs invoices to KRA iCMS with retry logic (3 attempts, exponential backoff).                                 |
| Dead letter queue        | Failed invoices are stored for reprocessing rather than dropped.                                               |
| Webhook callback         | Simulates KRA's asynchronous confirmation of invoice processing.                                               |
| E-Billing dashboard      | Sync health: synced/pending/failed counts, reconciliation rate.                                                |
| Failure monitoring       | Alerts when the sync failure rate exceeds a configurable threshold.                                            |
| Materiality threshold    | Configurable filter to focus on significant leaks.                                                             |
| Duplicate detection      | Flags duplicate invoices/dispatches.                                                                           |
| OMC risk profiling       | Aggregates leakage per OMC and assigns a High/Medium/Low risk level.                                           |
| Data quality scoring     | 0-100% score based on nulls, zeros, and invalid customer references.                                           |
| CSV upload & templates   | Reconcile ad hoc CSVs without touching the database, or download templates for the expected format.            |
| Excel export             | Multi-sheet workbook report (summary, anomalies, data quality, risk profile).                                  |




## Tech Stack


| Layer                     | Technology                                            |
| ------------------------- | ----------------------------------------------------- |
| Backend                   | Python 3.11, FastAPI, Uvicorn                         |
| Data processing           | Pandas, NumPy, SQLAlchemy                             |
| Fraud detection (planned) | NetworkX, python-louvain                              |
| Database                  | SQLite (dev) / PostgreSQL (prod)                      |
| Testing                   | Pytest                                                |
| Frontend                  | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Deployment                | Docker, Docker Compose                                |
| API docs                  | Swagger UI, ReDoc                                     |




## 👥 User Roles

| Role | Description | Key Features |

| :--- | :--- | :--- |

| **Depot Supervisor** | Operations Lead – manages daily depot activities. | Live Feed, Upload CSV, Dashboard Metrics |

| **Manager** | Strategic Decision Maker – oversees regional operations. | Heatmap, OMC Risk Profile, Executive Summary, Export Reports |

| **Revenue Assurance** | Financial Analyst – investigates and resolves anomalies. | Anomaly Table, Resolve/Review/Assign, Audit Trail, E-Billing Sync, Sync Logs |

### Permission Mapping

| Feature | Depot Supervisor | Manager | Revenue Assurance |

| :--- | :--- | :--- | :--- |

| Live Feed | ✅ | ✅ | ✅ |

| Upload CSV | ✅ | ❌ | ✅ |

| Heatmap | ❌ | ✅ | ✅ |

| OMC Risk Profile | ❌ | ✅ | ✅ |

| Executive Metrics | ✅ | ✅ | ✅ |

| Anomaly Table | ❌ | ✅ | ✅ |

| Resolve/Review/Assign | ❌ | ❌ | ✅ |

| E-Billing Sync | ❌ | ❌ | ✅ |

| Audit Trail | ❌ | ✅ | ✅ |

| Export Reports | ❌ | ✅ | ✅ |

| Templates | ✅ | ❌ | ✅ |

## Quick Start



### Prerequisites

- Docker and Docker Compose, or
- Python 3.11+ and Node.js 20+ for local development



### With Docker

```bash
git clone git@github.com:TristanBrian/revenue-assurance.git
cd revenue-assurance
docker compose up --build
```

Backend: [http://localhost:8000](http://localhost:8000) · Swagger docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Local development

Backend:

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

python scripts/generate_kpc_data.py   # generate synthetic CSVs
python scripts/etl_pipeline.py        # build the SQLite database

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Frontend: [http://localhost:3000](http://localhost:3000)

## API Endpoints


| Method | Endpoint                         | Description                                                           |
| ------ | -------------------------------- | --------------------------------------------------------------------- |
| POST   | `/api/reconcile`                 | Run reconciliation against the database — returns metrics + anomalies |
| POST   | `/api/reconcile/upload`          | Run reconciliation against uploaded CSVs                              |
| POST   | `/api/reconcile/sync`            | Sync anomalies to E-Billing                                           |
| POST   | `/api/reconcile/update`          | Resolve/update an anomaly                                             |
| GET    | `/api/reconcile/export`          | Download an Excel report                                              |
| GET    | `/api/reconcile/template/{type}` | Download a CSV template                                               |
| GET    | `/api/e-billing/status`          | E-Billing integration status                                          |
| POST   | `/api/e-billing/sync`            | Sync invoices to KRA iCMS (synchronous)                               |
| POST   | `/api/e-billing/sync/async`      | Trigger a non-blocking background sync (returns `task_id`)            |
| GET    | `/api/e-billing/task/{task_id}`  | Poll async task progress and result                                   |
| POST   | `/api/e-billing/retry/{id}`      | Retry a failed sync                                                   |
| GET    | `/api/e-billing/logs`            | View sync audit logs                                                  |
| GET    | `/api/e-billing/pending`         | List pending invoices                                                 |
| POST   | `/api/e-billing/webhook`         | Simulate a KRA webhook callback                                       |
| GET    | `/api/e-billing/reconcile`       | E-Billing reconciliation dashboard                                    |
| GET    | `/api/e-billing/monitor`         | Failure rate monitoring                                               |
| GET    | `/health`                        | Service health check (DB + API status)                                |


Full interactive docs: [http://localhost:8000/docs](http://localhost:8000/docs) (Swagger) and [http://localhost:8000/redoc](http://localhost:8000/redoc) (ReDoc).

## Project Structure

```
revenue-assurance/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entry point
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # Business logic (reconciliation, e-billing)
│   │   ├── models/          # Pydantic schemas
│   │   └── utils/           # DB connection, data loading helpers
│   ├── scripts/              # Synthetic data generation + ETL
│   ├── data/                 # Raw/clean CSVs (gitignored)
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/               # Pages
│   │   ├── components/        # UI components
│   │   └── lib/                # API client, types
│   └── package.json
├── docker-compose.yml
└── PROGRESS.md                # Frontend/backend integration status
```

Team ownership by area:


| Area               | Owns                                        |
| ------------------ | ------------------------------------------- |
| Backend core & API | `main.py`, `routes/`, `models/`, deployment |
| Business logic     | `services/reconciliation.py`, `tests/`      |
| Data engineering   | `scripts/`, `data/`, `utils/`, ETL          |
| Frontend           | `app/`, `lib/`, `components/`               |




## Testing

```bash
docker compose exec backend pytest tests/ -v
docker compose exec backend pytest tests/ --cov=app.services --cov-report=term
```



## Sample Response

Reconciliation output (values vary by run — data is synthetically generated with randomized fraud injection):

```json
{
  "status": "success",
  "data": {
    "metrics": {
      "total_dispatched_kes": 150932276,
      "total_leakage_kes": 16686227,
      "reconciliation_rate": 88.94,
      "anomaly_count": 90,
      "critical_count": 84
    },
    "anomalies": [ "..." ],
    "omc_risk_profile": [ "..." ]
  }
}
```

E-Billing sync response:

```json
{
  "status": "success",
  "message": "Successfully synced 998 invoices, 110 failed.",
  "synced": 998,
  "failed": 110,
  "total_processed": 1108,
  "failed_ids": ["INV-1001"],
  "sync_time": "2026-07-22 08:15:00"
}
```



## Environment Variables

Copy `.env.example` to `.env` at the repo root:

```env
API_HOST=0.0.0.0
API_PORT=8000
CORS_ORIGINS=http://localhost:3000
MATERIALITY_THRESHOLD=100000
KRA_ICMS_ENDPOINT=https://api.kra.go.ke/icms/v2/invoices
KRA_ICMS_API_KEY=test-api-key-12345
LOG_LEVEL=INFO
```

Note: `MATERIALITY_THRESHOLD`, `CRITICAL_AGE_DAYS`, and the KRA endpoint/key are currently hardcoded constants in the backend services rather than read from these variables — update the constants directly in `app/services/reconciliation.py` and `app/services/e_billing.py` if you need to change them.

## Project Status

See [PROGRESS.md](./PROGRESS.md) for the current state of frontend/backend integration. In short: the reconciliation API and E-Billing simulation are functional and tested; the reconciliation dashboard is wired to live data; CSV upload, the E-Billing panel, export, and the fraud-detection graph (backend and frontend) are still in progress or not yet started.

## License

MIT. Built for the Inuka Hackathon 2026 by Null Terminators.