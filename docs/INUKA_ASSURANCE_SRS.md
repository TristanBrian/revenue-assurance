# Inuka Program Assurance — Software Requirements Specification

## 1. Purpose

This document defines the business, data, control, API, and user-interface requirements for the Inuka Program Assurance portal. Inuka is a separate operational domain within the FlowGuard platform. It protects training-program funds and beneficiary payments; it does not use the KPC fuel-revenue concepts used by the inbound revenue portal.

The objective is not to label beneficiaries as fraudulent from a single attendance row. The objective is to establish an evidence-backed eligibility and payment chain, identify control breaks, and give an Inuka manager an explainable investigation queue.

## 2. Scope and non-goals

### In scope

- Multiple training programs, cohorts, pillars, sites, and payment periods.
- Beneficiary identity and enrollment assurance.
- Participation evidence beyond a manually supplied attendance flag.
- Officer approval and segregation-of-duties controls.
- Authorization-to-payment reconciliation.
- Explainable risk cases for ghost beneficiaries, duplicate identities, duplicate payments, overpayment, underpayment, invalid enrollment, impossible participation, suspicious account concentration, and officer patterns.
- Paginated investigation screens and program/officer/beneficiary summaries.
- Shared authentication, RBAC, audit, alerts, exports, and anomaly lifecycle with the revenue domain.

### Out of scope for this release

- Direct National ID, bank, or mobile-money provider integrations.
- Automatic criminal or disciplinary decisions.
- Fully autonomous blocking of a beneficiary or officer.
- Machine-learning decisions without sufficient labelled historical cases.

External identity and payment systems are integration points. Until connected, the portal must show the evidence source and confidence level rather than pretend that a record is independently verified.

## 3. Domain separation

FlowGuard remains one platform with shared security and audit infrastructure, but it has two bounded assurance domains:

```text
Inbound revenue assurance: dispatch → invoice → payment
Inuka program assurance: program/enrollment → participation evidence → authorization → disbursement
```

The Inuka manager receives an Inuka shell, terminology, routes, filters, and outbound-only server scope. Revenue screens and concepts must not be used as placeholders for Inuka data.

## 4. Inuka hierarchy

The official Inuka categories are pillars, not individual programs. The four pillars are:

- Inuka Scholarship
- Inuka Plus
- Vocational Training
- Inuka Tech Fellowship

Each pillar can contain multiple concrete programs. Each program can have multiple cohorts and training sites. The system must not present the four pillars as if they were the final program names.

```text
Inuka Foundation
  → Pillar
    → Program / intervention
      → Cohort / intake
        → Training site
          → Beneficiary enrollment
            → Participation evidence
              → Authorization
                → Disbursement
```

The current synthetic source data contains `pillar_id` values (`Scholarship`, `Plus`, `Vocational`, and `Tech`) but does not contain a trustworthy program or cohort registry. The application therefore reports current risk at pillar level and marks program/cohort fields as unavailable until source data supplies them. It must not invent program names beneath a pillar.

## 5. Target eligibility and payment chain

```text
Program → Cohort → Enrollment/KYC → Eligibility rules
       → Participation evidence → Officer approval
       → Stipend authorization → Payment execution
       → Settlement confirmation → Case/audit outcome
```

Attendance is one evidence source. It is not sufficient by itself to establish that a person is a legitimate student or that a payment is valid.

## 6. Target information model

The current tables remain compatible with the first implementation. The target model adds:

- `programs`: pillar, program code, name, sponsor, active dates, stipend rules.
- `cohorts`: program, site, start/end dates, capacity, status.
- `beneficiary_enrollments`: beneficiary, cohort, enrollment status, approval evidence, effective dates.
- `identity_verifications`: verification method, provider/reference, verified timestamp, confidence, reviewer.
- `participation_evidence`: session, beneficiary, evidence type, captured time, site/device metadata, verifier, confidence.
- `risk_cases`: explainable case, risk type, score, amount at risk, status, assignment, timestamps.
- `risk_evidence`: one-to-many evidence items supporting a case.

Existing `pillar_id` values are the current reporting dimension. They must not be treated as a complete program registry. New ingestion contracts should carry `pillar_id`, `program_id`, `cohort_id`, `site_id`, `transaction_reference`, `account_verification_status`, and participation evidence metadata.

## 7. Control and risk requirements

The system shall calculate independent, explainable signals including:

1. Ghost beneficiary — paid or authorized without a verified registry/enrollment record.
2. Duplicate identity — multiple beneficiary IDs sharing a verified identity, phone, or payment account.
3. Invalid enrollment — activity or payment outside active enrollment dates/cohort.
4. Participation inconsistency — impossible timing/site overlap or repeated identical/bulk submissions.
5. Evidence weakness — attendance exists but has no independent verification or was entered unusually late.
6. Officer concentration — unusual approval volume, exception rate, or repeated beneficiary/account concentration.
7. Account concentration — many unrelated beneficiaries paid to one account.
8. Payment integrity — ghost payment, duplicate payment, overpayment, underpayment, split payment, or unmatched settlement.
9. Authorization integrity — self-approval, late approval, amount outside program rules, or approval after payment.

Each case shall expose reason codes, source records, amount at risk, confidence, and a recommended review action. A risk score is triage support, not proof of fraud.

## 8. User experience requirements

The Inuka portal shall provide:

- Control Center: eligible population, verified population, authorized/paid amounts, cases by severity, and exposure.
- Exceptions Queue: server-side pagination, filters, sorting, evidence summaries, and a detail drawer.
- Beneficiary 360: identity, enrollment, participation, authorizations, payments, and related cases.
- Pillar Risk: case and exposure rates for the four official pillars, with program, cohort, site, and period drill-downs when those records are available.
- Officer Assurance: approval volume, anomaly rate, late-entry rate, and concentration signals.
- Payment Controls: unmatched, duplicate, over/under, and account-concentration cases.
- Relationship Explorer: optional secondary investigation view; not the primary dashboard.

Default page size is 25, with 25/50/100 options. Filtering and pagination must happen server-side.

## 9. Security and governance

- Inuka users are restricted server-side to outbound data.
- Identity and payment identifiers must be masked in normal list views.
- Sensitive values must not be sent to an LLM or external service without an approved data-processing policy.
- Every case review, export, assignment, and status change is auditable.
- The portal must not automatically deny benefits solely from a risk score.

## 10. Delivery strategy

Phase 1 (implemented in this branch): a backward-compatible explainable risk-case service over the existing outbound tables, paginated APIs, and Inuka investigation pages.

Phase 2: add the program/cohort/enrollment/evidence tables and ingestion contracts, then replace inferred signals with verified source evidence.

Phase 3: add approved identity/payment-provider adapters and investigator feedback loops.

Phase 4: train and evaluate statistical/ML models only after sufficient labelled outcomes exist; retain rule evidence and human review.

## 11. Acceptance criteria

- An Inuka manager never sees inbound/oil concepts or data.
- A case can be traced to source records and a human-readable reason.
- A beneficiary can be investigated across enrollment, participation, authorization, and payment history.
- The interface distinguishes official pillars from concrete programs and cohorts.
- Large case sets remain responsive through server-side pagination.
- The system distinguishes data-quality weakness from confirmed payment leakage.
- The same shared auth, audit, alerts, and deployment platform continues to serve both domains.
