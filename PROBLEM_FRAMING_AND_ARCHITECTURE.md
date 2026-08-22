# KPC Order-to-Cash Revenue Assurance
## Problem Framing & System Architecture

**Team:** [Team Name] · Inuka Fellowship Hackathon
**Problem Statement:** #7, Domain D — Revenue Assurance: Billing & Reconciliation
**Prepared by:** [Names]
**Date:** [Date]

---

## Part 1 — Problem Framing

### 1.1 The KPC Pain Point

KPC does not own the fuel moving through its network. It is a state-owned
midstream infrastructure operator that earns revenue purely as a **service
fee** for transporting and storing fuel owned by Oil Marketing Companies
(OMCs) — Shell, Total Kenya, Rubis, Vivo Energy, and others.

Every truck that loads fuel at a KPC depot should trigger three downstream
events in sequence: an **invoice** issued to the OMC, and a **payment**
received against that invoice. In practice, this chain breaks in
predictable, costly ways:

- Fuel leaves a depot with **no invoice ever generated** (a "ghost load")
- An invoice is issued for **less volume than was actually loaded**
- An invoice is issued correctly but **never paid, or only partially paid**
- An invoice is issued **far later than the loading event**, delaying cash
  conversion even when the underlying transaction is otherwise correct

Each of these is a distinct flavour of **revenue leakage** — money KPC is
owed but does not reliably collect. Currently, closing this gap relies on
manual, retrospective reconciliation, meaning leakage is discovered weeks
after it occurs, if at all.

### 1.2 Why This Problem, Specifically

- **Deterministic, not probabilistic.** Unlike demand forecasting or
  predictive maintenance, reconciliation logic can be checked and verified
  by a judge in real time — "does this load have an invoice? does this
  invoice have a payment?" This makes the solution unusually defensible
  under Q&A.
- **Revenue-denominated impact.** Leakage is measured in Kenyan Shillings,
  giving the ROI pitch (20% of the rubric) a natural, credible unit —
  unlike "downtime hours" or "litres of loss," which require more
  assumption-laden translation into cost.
- **Structurally proven pattern.** The reconciliation-and-exception
  architecture mirrors a production system studied in an Inuka masterclass
  (fraud detection over M-Pesa transactions), giving the team a validated
  blueprint rather than a novel, untested design.

### 1.3 What Success Looks Like

A working system that can state, with evidence: *"Of N loading events over
the observation period, X% show a reconciliation gap, representing an
estimated KES Y in leakage. Our tool would surface these gaps within
[latency] instead of the current manual audit cycle."*

---

## Part 2 — The Actors

| Actor | Role | Interacts With |
|-------|------|-----------------|
| **Depot supervisors / loading clerks** | Record physical loading events at each depot | Produces `loading_events` (simulated by `generator.py`) |
| **KPC billing / finance department** | Converts loading records into invoices | Produces `invoices` (simulated by `generator.py`) |
| **OMC treasury / accounts payable** | Pays invoices on the customer side | Produces `payments` (simulated by `generator.py`) |
| **KPC stock control team** | Tracks entitlement balances per OMC per depot | Owns `depot_stock_ledger` (conceptual, Stage 2) |
| **Revenue Assurance Analyst** *(primary end user)* | Reviews flagged exceptions daily, investigates root cause | Analyst dashboard view |
| **Depot / Operations Manager** *(secondary end user)* | Reviews leakage filtered to their own depot | Same dashboard, filtered view |
| **Senior Leadership / Executive** *(Stage 3 required user)* | Reviews quantified ROI, trend, and business case | Executive-facing summary view |

In the hackathon build, `generator.py` stands in for the first four actors,
producing synthetic records that mimic what each department's real system
would emit.

---

## Part 3 — System Architecture

### 3.1 High-Level Data Flow

```
Depot & billing teams (simulated source data)
        │
        ▼
ETL pipeline — extract, validate, transform, load
        │
        ▼
Database — clean event tables + exception records
        │
        ▼
Reconciliation engine — 4 independent leakage checks
        │
        ▼
API layer — FastAPI serves aggregated JSON
        │
        ▼
Dashboard — Analyst view + Executive view
        │
        ▼
Analysts & leadership — investigate, decide, report
```

### 3.2 Layer-by-Layer Design

**Layer 1 — Source Data (`generator.py`, `models.py`)**
Synthetic 90-day dataset across 5 depots, 5 OMCs, 3 product types, with four
leakage patterns injected at known, controlled rates. A hidden
`ground_truth_leakage` table records the true label for every load —
queried only by the evaluation script, never by detection logic.

**Layer 2 — ETL Pipeline (`etl_pipeline.py`)**
Same `extract → validate → transform → load` pattern used in prior
coursework:
- `extract()` — reads new/unprocessed records from the source tables
- `validate()` — Great Expectations suite: schema checks, range checks
  (e.g. volume within physical truck capacity), null checks, referential
  checks
- `transform()` — standardises formats, computes derived fields (dwell
  time, invoice lag)
- `load()` — writes to clean tables, idempotently (safe to re-run)

**Layer 3 — Database**
SQLite for local development; Supabase (managed Postgres) once the team
needs a shared, always-on dataset for collaborative dashboard development.

**Layer 4 — Reconciliation Engine (`reconciliation.py`)**
Five independent checks, run without ever reading the ground-truth table:
1. **Ghost load** — loading event with no matching invoice
2. **Volume mismatch** — invoiced volume vs. loaded volume, exceeding a
   product-and-dwell-time-aware evaporation tolerance (see §4.3)
3. **Payment gap** — invoice with no or partial payment
4. **Timing leakage** — invoice issued more than 7 days after loading
5. **Capacity overrun** *(stretch goal)* — cumulative OMC loads exceeding
   their entitlement balance in `depot_stock_ledger`

**Layer 5 — Evaluation (`evaluate.py`)**
A separate script — never part of the detection pipeline — that compares
the reconciliation engine's output against `ground_truth_leakage` to
compute precision and recall. This is how the team honestly reports
detector accuracy without contaminating the detection logic with the
answer key.

**Layer 6 — API Layer (FastAPI)**
Serves pre-aggregated JSON to the dashboard: leakage rate by depot, by
OMC, by product, trend over time, and top exception cases. Chosen over
direct database queries from the frontend because it allows the backend
and frontend to scale and deploy independently.

**Layer 7 — Dashboard (NextJS)**
Two distinct views, both required by the rubric:
- **Analyst view** — exception list, filters by depot/OMC/leakage type,
  drill-down into individual flagged cases
- **Executive view** — single-page ROI summary: total leakage detected,
  KES at risk, trend direction, no operational detail

### 3.3 Deployment Architecture (Stage 3)

```
Supabase (PostgreSQL)  ← ETL pipeline writes here
        ↓
FastAPI on Render       ← reads and serves aggregations
        ↓
NextJS on Vercel         ← fetches from FastAPI, renders dashboard
```

CI: GitHub Actions runs the Great Expectations suite on every push,
gating merges on data-quality checks passing.

---

## Part 4 — Core Business Logic

### 4.1 Ownership Model

KPC owns pipeline and depot infrastructure only. OMCs own the fuel. OMCs
onboard via a **Transport and Storage Agreement (TSA)** governing rates
and capacity allocation.

### 4.2 Invoice Formula (Two-Part Tariff)

```
transport_cost_kes = volume_m3 × distance_km × transport_tariff_rate
storage_cost_kes   = volume_litres × depot_storage_rate_per_litre
invoiced_amount_kes = transport_cost_kes + storage_cost_kes
```

Gazetted transport tariff: Sh 5.44/m³/km (2025/26). Depot storage rates
vary significantly by location — Mombasa ≈ Sh 1.07/L, rising to
Sh 4.23–4.24/L at Kisumu and Eldoret.

### 4.3 Evaporation Tolerance (Prevents False-Positive Leakage Flags)

Refined-product evaporation is real but small (industry benchmark: ≤0.25%
of volume, netted quarterly) and highly product-dependent — petrol (PMS)
is far more volatile than diesel (AGO) or kerosene (IK). A volume mismatch
is only flagged as leakage if it exceeds the expected evaporation band for
that product and dwell time:

```python
def allowable_evaporation_pct(product_type, dwell_days):
    daily_rate = {
        "PMS": 0.00025 / 90,
        "AGO": 0.00025 / 90 * 0.05,
        "IK":  0.00025 / 90 * 0.08,
    }
    return daily_rate[product_type] * dwell_days
```

### 4.4 Why Not a Time-Based Storage Fee

Verified against real KPC/EPRA tariff structures: storage is billed as a
flat per-volume throughput fee, not a per-day rent. KPC discourages
slow-moving stock through **capacity throttling** (future allocation based
on trailing sales volume) rather than direct billing. The system should
model this as an analytical insight (which OMCs are at risk of reduced
future allocation due to slow movement), not invent a fictional fee.

---

## Part 5 — Data Model

See `DATA_DICTIONARY.md` and `TECHNICAL_REFERENCE.md` for the full schema.
Summary: `loading_events`, `invoices`, `payments`, `depot_stock_ledger`,
and the hidden `ground_truth_leakage` evaluation table.

---

## Part 6 — Build Roadmap Against the Rubric

| Stage | Weight | Deliverable | Status |
|-------|--------|-------------|--------|
| **Stage 1** — Data Engineering | 20% | ETL foundation, CI/data-quality gates, problem-framing memo, 5-min pitch | Generator + schema built; ETL pipeline next |
| **Stage 2** — Operational Analytics | 35% | Dashboards, diagnostics, first predictive model, QA/UAT evidence | Not started |
| **Stage 3** — Solutions Showcase | 45% | Hardened deployment, CI/CD, executive view, ROI pitch | Not started |

### Immediate Next Steps

1. `etl_pipeline.py` — extract, validate (Great Expectations), transform, load
2. `reconciliation.py` — the 5 independent detection checks
3. `evaluate.py` — precision/recall against ground truth
4. GitHub Actions CI wired to the Great Expectations suite
5. This document's Part 1 condensed into the required one-page memo

---

*This document is the team's shared source of truth. Update it whenever a
design decision changes — do not let the code and this document drift
apart.*
