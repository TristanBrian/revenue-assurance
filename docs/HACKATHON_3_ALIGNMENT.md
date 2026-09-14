# Hackathon 3: Domain 4 alignment and release review

Reviewed 14 September 2026 against `Docs/KPC Inuka Fellowship Hackathon 3.pdf` and the requested improvement plan. This is a code assessment, not certification of a live deployment.

## Executive finding

The application has a substantial reconciliation, RBAC, audit and analyst foundation, but the latest Domain 4 executive panels are largely demonstrations. Deploying those panels does not establish a working demurrage billing engine or physical gate control. Focus the next implementation on a traceable truck visit from gate-in through meter reconciliation to exit and a persisted invoice draft.

The Stage 3 rubric weights deployment/resilience 30%, quantified ROI 25%, integration/usability 20%, documentation/handover 15%, and presentation 10%. The brief asks teams to choose one problem within a domain; demonstrate Problem 8 as the primary workflow and Problem 7 as a clearly scoped extension if both cannot be completed to the same standard.

## Deployment and correctness repairs in this review

- Added the missing frontend icon dependency and lockfile entry.
- Removed duplicate `getAuditVerify` export and reused the existing audit response contract.
- Corrected the OMC leaderboard to consume `customer` and `leakage_kes`.
- Removed fabricated successful report verification and invented blockchain anchors after API failures; added failure regression tests.
- Removed fabricated gantry fallback data after API failure. Labeled the remaining gantry/drift samples explicitly. Derived sample alignment from lane values and removed the unsupported KES 14.25M recovery figure.
- Renamed the payment-derived card to Recorded Payments; removed the invented comparison-period trend. Payments are not prevented leakage.
- Isolated unit tests from Playwright browser tests; added unit tests and PostgreSQL migration checks to CI.
- Made Docker Python version match CI, added OpenMP, removed unused Torch, and selected CPU-only XGBoost.
- Made Render's root Docker context explicit, removed ineffective wildcard CORS entries, and added Fly health checks.
- Made the historical depot/user migration initialize an empty depot master on fresh databases, preserving existing ETL master data.
- Returned HTTP 503 for failed database readiness, including HEAD health checks.
- Made synthetic ETL and demo credentials opt-in. Admin bootstrap now requires environment-provided credentials.
- Replaced the mobile-only root runbook with system operations, recovery, deployment and handover guidance; retained the original under `docs/MOBILE_RUNBOOK.md`.

## Delivery matrix

| Workstream | Observed implementation | Acceptance criteria still needed |
| --- | --- | --- |
| Problem 8 reconciliation | Existing invoice/payment reconciliation; synthetic six-lane endpoint | Persist manifest, invoice and metering events; compare end minus start meter in consistent units; reject invalid/late/duplicate events; apply versioned PMS/AGO/IK policies; reconcile payments separately |
| Problem 7 demurrage | Demo dwell minutes and UI only | Persist gate-in, gantry-entry, loading-end, gate-out in UTC; validate ordering; apply contract-specific free time/rate; create exactly one invoice draft on exit, with repeat delivery/restart tests |
| Executive KPI cards | UI exists; corrected payment label and demo attribution | Calculate realized savings from resolved cases, billed demurrage from issued invoices, recovered demurrage from payments; attach period, source and freshness |
| Yard grid and drift | Sample lanes and sample volume history | Live authenticated telemetry, depot scope, stale-data indicator, distinct unassessed/loading/cleared/held states, persisted gate decision |
| OMC leaderboard | Reconciliation exposure ranking | Separate discrepancy frequency from dwell delays and demurrage value; normalize by loading count |
| Audit and reports | SHA-256/HMAC report hashes, audit chain and optional Base Sepolia verification | Full proof viewer, unknown/altered/error cases, authoritative export matching, permission and upload-size review; hash generation alone never proves authenticity |
| Mobile | Existing overview/anomalies/alerts/profile workflows | Manifest/seal camera scanning, four timestamp events, authoritative gate decision, durable offline queue and idempotent conflict resolution |
| Autonomous actions | Existing alert and simulated e-billing foundations | Transactional outbox, authenticated gate controller, idempotent SAP invoice draft, tax adjustment sandbox adapter, delivered/failed receipts, escalation on DLQ |
| Enterprise adapters | KRA simulation; no verified end-to-end SAP/SCADA/SSO integration | Approved schema mappings, service authentication, OAuth2/SAML role mapping, retries/backoff/jitter, DLQ and operator replay with duplicate checks |
| Design system | Executive components and current themed UI | Complete accessibility, keyboard/modal behavior, mobile field workflow and reduced-motion checks after the operational flow works |
| Deployment | Repaired local build/startup configuration and CI gates | Live host credentials/settings, CI-gated release publishing, external uptime/incident routing and load/restore evidence |
| Handover | Expanded runbook and proposed ownership | Named owners, accepted RPO/RTO, restore drill, incident contacts and signed acceptance |
| ROI | Previously displayed sample amounts | Costed implementation and measured savings with explicit assumptions and no double counting |

## Recommended implementation sequence

1. Create a `truck_visit` record and a versioned product/contract policy. Ingest meter and invoice updates into immutable events with unique source-event IDs. Expose an authenticated visit view for web and mobile.
2. Use `physical_volume_l = end_meter_l - start_meter_l` and `variance_l = physical_volume_l - invoiced_volume_l`. Record flow rate with units and timestamp for plausibility checks; do not confuse rate with volume. Missing invoice/meter data must be unassessed, never implicitly cleared.
3. Apply approved product tolerance in explicit units. Proposed gate rule: hold when physical volume exceeds invoice volume plus permitted tolerance. Negative excess variance still requires discrepancy review, even if it is not an unbilled-volume hold. Do not invent regulatory evaporation percentages; KPC must approve the policy and reference conditions.
4. Calculate `billable_hours = max(0, (gate_out - gate_in).total_seconds()/3600 - free_hours)`. Apply decimal currency arithmetic and contract rounding rules. Two hours is a demonstration assumption until contract-approved. Loading-end is not gate-out.
5. Commit the gate decision, demurrage draft and outbox events atomically. A unique invoice key per visit and charge type prevents duplicate billing after retries. External issuance needs approved SAP credentials and acknowledgement handling.
6. Connect the dashboard and mobile screens to these records. Remove remaining samples once authenticated real event ingestion is available. Represent offline/stale/pending/held states explicitly.
7. Exercise restart, duplicate telemetry, out-of-order time, missing invoice, within-tolerance variance, excessive volume, on-time exit and overdue exit. Capture receipts and business evidence for the pitch.

## ROI worksheet (assumptions, not claimed savings)

Collect a baseline period and a comparable pilot period:

- Prevented leakage KES: sum confirmed prevented quantities times the agreed revenue valuation, linked to resolved cases. Do not count every alert as saved cash.
- Demurrage billed KES: sum issued, non-voided demurrage invoices. Demurrage recovered KES: cash applied to those invoices.
- Operational saving KES: measured reduction in staff hours or truck idle hours times an agreed cost; avoid counting the same benefit twice.
- Total cost: implementation effort, infrastructure, integration, security review, devices, training and ongoing support.
- Net annual benefit = validated annual savings minus annual operating cost.
- Payback months = upfront implementation cost / positive monthly net benefit. Report no payback if monthly net benefit is zero or negative.

Include quantities, unit costs, measurement dates, exclusions, confidence bounds and named business approval. Neither total payments nor gross detected exposure is a substitute for ROI.

## Ten-minute demonstration outline

- 0–1 min: Domain 4 problem, measured baseline and selected primary problem.
- 1–4 min: Truck event lifecycle; show mismatch and server-side hold, then authorized reconciliation.
- 4–6 min: Overdue exit; show exactly one persisted demurrage draft across a retry.
- 6–7 min: Show a failed dependency/offline event and recovery without fabricated success.
- 7–8 min: Audit/export verification and independent anchor state.
- 8–9 min: ROI worksheet with evidence and assumptions.
- 9–10 min: CI, health monitor, restore evidence and handover owners.

Until the operational steps above are implemented, present them as planned work rather than simulating a successful live control.

## Validation evidence from this review

- Clean frontend dependency installation completed with the updated lockfile.
- Next.js production build and TypeScript validation passed after removing the duplicate API export and fixing OMC field mappings.
- Frontend unit suite: 11 tests passed, including API-unavailable and unknown-report verification cases.
- Isolated PostgreSQL 16: fresh `alembic upgrade head` succeeded, a second upgrade was a no-op, and roles/terms seeded successfully. One committed head: `e195493cd484`.
- Backend full suite: 191 passed, 1 skipped, with two new health assertions initially failing because error envelopes omit Data. After correcting those assertions, all four health regression tests passed. Tests used a temporary database copy.
- Actual startup script smoke test: HTTP 200 with PostgreSQL connected and synthetic bootstrap disabled. Empty operational tables still require validated data ingestion; the background graph refresh logs missing dispatch data on an empty database.
- Final frontend lint and TypeScript checks passed without errors or warnings.
- Live Fly/Render/Vercel deployment, device testing, browser end-to-end tests, load testing and real ERP/SCADA/KRA connections have not been verified here.

## Workspace and access alignment — September 2026

The executive overview now shows a single four-card summary and a decision-focused chart/queue. Depot lane previews and variance analytics live in **Oil → Depot Operations**. Oil has dedicated **E-Billing** and **Data Import** routes. Inuka has **Beneficiaries**, **Programs & Pillars**, **Field Officers**, **Consent & Privacy**, and its own case queue. Shared analytics and exports receive an explicit workspace. Report verification remains under Reports; the audit trail remains available to permitted Oil oversight roles.

Navigation and direct workspace URLs share the same module policy. Oil-only APIs now enforce the same boundary, including legacy OMC/depot endpoints and integration stubs. Outbound access requires `view_outgoing_data`; Inuka managers stay outbound-only, depot supervisors inbound-only. Case writes and Inuka stream ingestion require `resolve_anomaly`; read-only managers can inspect and export but cannot record actions. Existing roles need no new permissions for this change. Mobile mirrors these restrictions, resets to overview when switching workspaces, and labels the gate calculation as a non-authoritative preview.

The standalone `/api/v1/control` and `/api/v1/integrations` prototypes previously fabricated ERP acknowledgements. They now require scoped authentication. Unimplemented SAP/KRA issuance and SCADA persistence return **501**, with no fake invoice, receipt or telemetry ID. The lockout calculator is explicitly a simulation, validates finite positive invoice quantities, and requires a supplied tolerance. It cannot authorize a physical gate release.

### Stage 3 acceptance checklist for both workspaces

| Deliverable | Evidence available | Acceptance still required |
| --- | --- | --- |
| Executive control plane | Separate Oil/Inuka overviews, scoped modules, accessible lane inspector, module search, refresh, mobile responsive layout | Business owners validate metric definitions and source data against their ledger |
| Quality and resilience | Build/lint/unit/API permission tests; CI PostgreSQL migration checks; DB readiness health check | Successful live pipeline run, external uptime monitor and approved notification delivery |
| Autonomous linkup | Existing reconciliation/case workflow and simulated billing foundations | Persisted yard events, versioned product/contract policies, idempotent invoice outbox, authenticated telemetry and real delivery receipts |
| Quantified ROI | Measurement worksheet in this document; exposure and payment values identified separately | Signed baseline/pilot dataset, costs, confirmed prevented losses and collected demurrage; no invented savings |
| Handover | RUNBOOK.md and WORKSPACE_GUIDE.md with role matrix, navigation, failure semantics and release checks | Named Em-Tech/KPC owners, incident contacts, approved RPO/RTO and witnessed restore drill |
| Pitch | Six-slide deck and ten-minute demonstration outline | Rehearsal with the deployed system and honest disclosure of simulations |

Do not present Stage 3 as production complete until the acceptance column is satisfied. Inuka is a separate program assurance workflow; physical petroleum, gate, demurrage and KRA features belong only to Oil.
