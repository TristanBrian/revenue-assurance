# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] – 2026-08-22

### Added – Inuka Foundation Governance (Hackathon 2)

- **Outbound (Stipend/Disbursement) Reconciliation**
  - Three‑way match: Attendance → Stipend Authorisation → Disbursement
  - Detects missing authorisations, missing disbursements, underpayments, overpayments, duplicate disbursements, and ghost payments
  - Ghost payments, duplicates, and overpayments are **critical by default** (bypass materiality threshold)

- **New Role: Inuka Manager**
  - View‑only access to outbound data – no resolution permission
  - Perfect for Inuka Foundation program oversight

- **Extended Fraud Graph**
  - Outbound graph: Officer ↔ Beneficiary network
  - Beneficiary ↔ Beneficiary edges for shared‑account fraud rings
  - Louvain community detection now works for both inbound and outbound

- **Multilingual AI Chatbot (RAG)**
  - English + Swahili support
  - Answers program FAQs, consent, and governance queries
  - Reduces support workload by up to 80%

- **Direction Toggle**
  - All reconciliation/heatmap/fraud‑graph/export endpoints accept `?direction=inbound|outbound|all`
  - Frontend: 3‑way toggle (Incoming / Outgoing / All)

- **Enhanced Audit Trail**
  - Now tracks both inbound and outbound events
  - Consent tracking for beneficiaries
  - Optional on‑chain anchoring (Base Sepolia)

- **Full QA & UAT Evidence**
  - 71% backend test coverage (161 passing tests)
  - 13 UAT scenarios, 100% pass rate
  - Tested with 63,000+ records

- **Deployment**
  - Deployed on **Fly.io** with PostgreSQL
  - Frontend on **Vercel**
  - CI/CD via GitHub Actions

### Changed

- **ETL Pipeline** – Extended to ingest outbound CSVs (officers, beneficiaries, attendance, stipends, disbursements)
- **Same codebase** – no duplicated stacks; `flow_direction` discriminator unifies both domains
- **Documentation** – Updated README with Hackathon 2 linkup, demo logins, and chatbot

---

## [1.0.0] – 2026-07-30

### Added – KPC Revenue Assurance (Hackathon 1)

- **Three‑way Reconciliation**
  - Dispatches → Invoices → Payments
  - Detects missing invoices, missing payments, underpayments, and overpayments

- **E‑Billing Integration**
  - KRA iCMS sync with retry logic (3 attempts, exponential backoff)
  - Dead Letter Queue for failed invoices
  - Webhook callback simulation
  - Failure rate monitoring

- **Fraud Detection**
  - OMC ↔ Depot leakage graph
  - Louvain community detection for correlated leakage clusters

- **Executive Dashboard**
  - Key metrics: total leakage, reconciliation rate, anomaly count
  - 60‑second caching for sub‑500ms loads

- **Anomaly Table**
  - Paginated, filterable list of leakage events

- **Leakage Heatmap**
  - OMC × Product leakage intensity with interactive tooltips

- **CSV Upload & Templates**
  - Reconcile ad‑hoc files without touching the database

- **Excel Export**
  - Multi‑sheet workbook (summary, anomalies, risk profile, data quality)

- **Role‑Based Access Control (RBAC)**
  - 4 roles: Depot Supervisor, Manager, Revenue Assurance, System Admin

- **Audit Trail**
  - Immutable hash‑chain for all user actions and system events

- **Alerts & Notifications**
  - In‑app inbox + SMTP email; system‑triggered and manual broadcasts

- **Deployment**
  - Docker + Docker Compose
  - Frontend on Vercel, Backend on Render, PostgreSQL on Neon

---

### Fixed

- CORS issues for frontend communication
- OOM errors on Render (scaled VM)

---

## [Unreleased]

### Planned

- Redis for persistent caching
- Real KRA iCMS API integration (beyond simulation)
- More advanced fraud detection with deep learning
- Mobile app for field officers

---

**Contributors:**  
Null Terminators team
