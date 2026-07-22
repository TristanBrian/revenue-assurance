🚛 KPC Revenue Assurance Platform

> **Enterprise-Grade Reconciliation Engine for Kenya Pipeline Company**  

> *Solving Problems #7 (Order-to-Cash Leakage) & #8 (E-Billing Integration)*

[![Python]([https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://python.org)](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://python.org))

[![FastAPI]([https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com))

[![Docker]([https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docker.com)](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docker.com))

[![Tests]([https://img.shields.io/badge/Tests-41%2F42%20Passing-brightgreen)](#)](https://img.shields.io/badge/Tests-41%2F42%20Passing-brightgreen)](#))

---

## 📖 Overview

KPC loses billions of shillings due to revenue leakage in its Order-to-Cash cycle:

- **Missing Invoices** – Fuel dispatched, no bill sent.

- **Missing Payments** – Bills sent, never paid.

- **Underpayments** – Paid less than invoiced.

**Our solution** reconciles Dispatches → Invoices → Payments, detects these leaks, and exposes everything via a REST API with automatic Swagger/OpenAPI docs. The platform also includes an **enterprise-grade E-Billing integration** with retry logic, Dead Letter Queues, webhook callbacks, and real-time monitoring.

---

## 🏗️ Architecture

```mermaid

graph TD

    subgraph Data_Layer["📁 DATA LAYER"]

        CSV[("📄 Raw CSVs")]

        DB[("🗄️ SQLite DB")]

    end

    subgraph Service_Layer["⚙️ BACKEND SERVICES"]

        ETL["🔄 ETL Pipeline"]

        Recon["🔍 Reconciliation"]

        Fraud["🕸️ Fraud Detection"]

        EBill["📤 E-Billing"]

    end

    subgraph API_Layer["🌐 API LAYER"]

        API["🚀 FastAPI"]

        Routes["/reconcile<br>/upload<br>/sync<br>/status<br>/export<br>/webhook"]

    end

    subgraph UI_Layer["🖥️ FRONTEND"]

        Dashboard["📊 Dashboard"]

        Cards["💳 Metric Cards"]

        Table["📋 Anomaly Table"]

        Graph["🕸️ Fraud Graph"]

        EBillUI["🔌 E-Billing Status"]

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

---

## ✨ Key Features

| Feature | Description |

| :--- | :--- |

| **Three-Way Reconciliation** | Matches Dispatches → Invoices → Payments to detect Missing Invoices, Missing Payments, and Underpayments. |

| **E-Billing Integration** | Syncs invoices to KRA iCMS with retry logic (3 attempts, exponential backoff). |

| **Dead Letter Queue** | Failed invoices are stored for later reprocessing – nothing is ever lost. |

| **Webhook Callback** | Simulates KRA's asynchronous confirmation of invoice processing. |

| **Reconciliation Dashboard** | Full visibility into sync health: synced/pending/failed counts, reconciliation rate. |

| **Failure Monitoring** | Alerts when failure rate exceeds 10% threshold. |

| **Materiality Threshold** | Configurable filter to focus on significant losses. |

| **Duplicate Detection** | Flags duplicate invoices to prevent double payments. |

| **OMC Risk Profiling** | Aggregates leakage per OMC and assigns High/Medium/Low risk. |

| **Data Quality Scoring** | 0–100% quality score based on nulls, zeros, invalid customers. |

| **CSV Upload & Templates** | Upload custom CSVs or download templates for correct formatting. |

| **Excel Export** | Boardroom-ready reports with multi-sheet workbooks. |

| **Audit Trail** | Full logs of all sync attempts, retries, and user actions. |

---

## 🛠️ Tech Stack

| Layer | Technology |

| :--- | :--- |

| **Backend** | Python 3.11, FastAPI, Uvicorn |

| **Data Processing** | Pandas, NumPy, SQLAlchemy |

| **Fraud Detection** | NetworkX |

| **Database** | SQLite (Dev) / PostgreSQL (Prod) |

| **Testing** | Pytest (41 tests, 86% coverage) |

| **Deployment** | Docker, Docker Compose |

| **API Docs** | Swagger UI, ReDoc |

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose

- OR Python 3.11+ (Local development)

### With Docker (Recommended)

```bash

# Clone the repo

git clone [https://github.com/TristanBrian/revenue-assurance.git](https://github.com/TristanBrian/revenue-assurance.git)

cd revenue-assurance

# Start the entire stack

docker compose up --build

# Backend: [http://localhost:8000](http://localhost:8000)

# Swagger Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

```

### Local Development

```bash

# Backend

cd backend

python -m venv venv

source venv/bin/activate  # Windows: venv\Scripts\activate

pip install -r requirements.txt

# Generate data

python scripts/generate_kpc_[data.py](http://data.py)

# Run ETL

python scripts/etl_[pipeline.py](http://pipeline.py)

# Start server

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

```

---

## 📚 API Endpoints (Frontend Team)

| Method | Endpoint | Description |

| :--- | :--- | :--- |

| `POST` | `/api/reconcile` | Run reconciliation – returns metrics + anomalies |

| `POST` | `/api/reconcile/upload` | Upload custom CSVs |

| `POST` | `/api/reconcile/sync` | Sync anomalies to E-Billing |

| `POST` | `/api/reconcile/update` | Resolve/update an anomaly |

| `GET` | `/api/reconcile/export` | Download Excel report |

| `GET` | `/api/reconcile/template/{type}` | Download CSV template |

| `GET` | `/api/e-billing/status` | E-Billing integration status |

| `POST` | `/api/e-billing/sync` | Sync invoices to KRA iCMS |

| `POST` | `/api/e-billing/retry/{id}` | Retry failed sync |

| `GET` | `/api/e-billing/logs` | View sync audit logs |

| `POST` | `/api/e-billing/webhook` | Simulate KRA webhook callback |

| `GET` | `/api/e-billing/reconcile` | E-Billing reconciliation dashboard |

| `GET` | `/api/e-billing/monitor` | Failure rate monitoring |

**Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 📂 Project Structure (Team Roles)

```

kpc-revenue-assurance/

│

├── backend/                          # 🟢 Person A, B, C

│   ├── app/

│   │   ├── [main.py](http://main.py)                   # 🟢 Person A – FastAPI entry

│   │   ├── routes/                   # 🟢 Person A – API endpoints

│   │   │   ├── [reconcile.py](http://reconcile.py)          # Reconciliation routes

│   │   │   └── e_[billing.py](http://billing.py)          # E-Billing routes

│   │   ├── services/                 # 🔵 Person B – Business logic

│   │   │   ├── [reconciliation.py](http://reconciliation.py)     # 3-way match engine

│   │   │   └── e_[billing.py](http://billing.py)          # KRA iCMS simulation

│   │   ├── models/                   # 🟢 Person A – Pydantic schemas

│   │   └── utils/                    # 🟡 Person C – Helpers

│   │

│   ├── scripts/                      # 🟡 Person C – Data + ETL

│   │   ├── generate_kpc_[data.py](http://data.py)

│   │   └── etl_[pipeline.py](http://pipeline.py)

│   │

│   ├── data/                         # 🟡 Person C – CSVs (gitignored)

│   ├── tests/                        # 🔵 Person B – 41 tests

│   │   ├── test_[reconciliation.py](http://reconciliation.py)

│   │   ├── test_[ebilling.py](http://ebilling.py)

│   │   ├── test_data_[quality.py](http://quality.py)

│   │   └── test_[etl.py](http://etl.py)

│   └── requirements.txt

│

├── frontend/                         # 🟣 Person D & 🟠 Person E

│   ├── src/

│   │   ├── app/                      # 🟣 Person D – Pages

│   │   ├── components/               # 🟠 Person E – UI

│   │   └── lib/                      # 🟣 Person D – API client

│   └── package.json

│

├── docker-compose.yml                # 🟢 Person A

└── [README.md](http://README.md)                         # Everyone

```

---

## 👥 Team Role Breakdown

| Role | Person | What You Own |

| :--- | :--- | :--- |

| **Backend Core & API** | 🟢 Person A | `main.py`, `routes/`, `models/`, deployment |

| **Business Logic** | 🔵 Person B | `services/reconciliation.py`, `tests/` |

| **Data Engineering** | 🟡 Person C | `scripts/`, `data/`, `utils/`, ETL |

| **Frontend Lead** | 🟣 Person D | `app/`, `lib/`, API client, layout |

| **Frontend Visuals** | 🟠 Person E | `components/`, charts, graph |

---

## 🧪 Testing

```bash

# Run all tests

docker compose exec backend pytest tests/ -v

# Expected: 41 passed, 1 skipped

```

### Test Coverage

```bash

docker compose exec backend pytest tests/ --cov=[app.services](http://app.services) --cov-report=term

# Coverage: 86%

```

---

## 📊 Sample Response

### Reconciliation Response

```json

{

  "metrics": {

    "total_dispatched_kes": 150932276,

    "total_leakage_kes": 22173205,

    "reconciliation_rate": 85.31,

    "anomaly_count": 296,

    "critical_count": 272

  },

  "anomalies": [...],

  "omc_risk_profile": [...]

}

```

### E-Billing Sync Response

```json

{

  "status": "success",

  "message": "Successfully synced 998 invoices, 110 failed.",

  "synced": 998,

  "failed": 110,

  "total_processed": 1108,

  "failed_ids": ["INV-1001", ...],

  "sync_time": "2026-07-22 08:15:00"

}

```

---

## 🏆 Key Metrics

| Metric | Value |

| :--- | :--- |

| **Leakage Detected** | KSh 22.17M |

| **Reconciliation Rate** | 85.31% |

| **Anomalies Found** | 296 |

| **Data Quality Score** | 100% |

| **Tests Passing** | 41/42 |

| **Processing Time** | < 1s |

| **E-Billing Sync Rate** | ~90% |

---

## 📝 Environment Variables

Create a `.env` file in the root:

```env

API_HOST=0.0.0.0

API_PORT=8000

CORS_ORIGINS=[http://localhost:3000](http://localhost:3000)

MATERIALITY_THRESHOLD=100000

KRA_ICMS_ENDPOINT=[https://api.kra.go.ke/icms/v2/invoices](https://api.kra.go.ke/icms/v2/invoices)

KRA_ICMS_API_KEY=test-api-key-12345

LOG_LEVEL=INFO

```

---

## 🔗 Links

- **Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

- **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

- **OpenAPI JSON:** [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)

---

## 📜 License

MIT – Built for the Inuka Hackathon 2026.

---

**Built with ❤️ by Null Terminators – Closing the gap between fuel and cash. 🚛💰**