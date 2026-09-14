# Reconova Inuka Hackathon Demo and Data Fabric

## What is implemented

Reconova (Enterprise Intelligence System, formerly FlowGuard) is a synthetic-data demonstration of assurance controls for KPC's Inuka programme pillars: Scholarship, Plus, Vocational, and Tech. It is not connected to KPC production systems and no conclusion about a real beneficiary or payment should be treated as a finding. The demo shows how evidence can be joined, scored, reviewed, and acted on with privacy controls.

The web portal separates Oil Revenue Assurance from Inuka Programme Assurance. Inuka cases are grouped by disbursement/beneficiary-period and show beneficiary IDs in operational lists. A name is available only inside an authorised case investigation.

## Production data flow

| Source | Production arrival | Controls applied |
| --- | --- | --- |
| Beneficiary/program registry | Scheduled extract, API, or CDC event | Stable beneficiary ID, programme/pillar, eligibility and effective dates |
| Attendance/participation systems | QR/mobile attendance events or verified participation files | Duplicate detection, late-event handling, cohort and session checks |
| Authorization workflows | Approval events from programme finance/workflow systems | Maker-checker state, approver identity, approval time and amount |
| Bank/M-Pesa disbursements | Bank statement/API, settlement file, or payment-provider webhook | Payment reference, beneficiary account, amount, status and settlement date |
| Field verification tools | Mobile forms with offline queue, GPS and timestamped photographs | Consent, device/user identity, evidence hash and conflict resolution |

Each adapter maps into the same event contract. The current application persists events in the `inuka_stream_events` table, which acts as a small bronze/event layer. The simulator produces synthetic events by default so judges can see the flow without KPC credentials. In a production deployment, set `INUKA_STREAM_SIMULATOR=false` and let the trusted source adapters POST signed events to `POST /api/inuka/stream/events`.

```text
registry / attendance / authorization / bank-M-Pesa / field app
                         |
                  source adapters
                         |
              inuka_stream_events (bronze)
                         |
        validation + identity/consent controls
                         |
      reconciliation + anomaly/case aggregation
                         |
      review actions, alerts, reports, dashboards
```

The mobile field app uses a durable local queue. A verification is keyed by `verification_id`; a retry uses last-write-wins for that key. Failed submissions remain queued, while successful submissions are removed. GPS is optional when permission or connectivity is unavailable, and a captured photo keeps its capture timestamp.

## Demonstration numbers

The current numbers are synthetic and generated from the repository seed data. During the latest local run the Inuka engine produced approximately 585 grouped cases and KES 6.22M of synthetic amount at risk. These are prioritisation signals, not confirmed fraud or recovered money. In a real pilot, impact should be measured as review-cycle time, prevented/recovered value after adjudication, false-positive rate, consent completeness, and percentage of records reconciled.

## 10-minute presentation sequence

### 0:00–1:00 — The Inuka problem

Explain that KPC-funded training programmes must prove that the right beneficiary was eligible, participated, was authorised, and received the correct amount. Ghost beneficiaries, duplicate payments, over/underpayment, missing authorisations, stale records, and weak evidence create both financial and programme risks.

### 1:00–3:00 — Architecture and data flow

Show the four pillars, the source-adapter/event contract, the bronze stream table, consent/privacy controls, grouped case engine, and role-separated views. Use the stream status card and optionally call `/api/inuka/stream/events` to show new events arriving. Emphasise that the simulator is synthetic but the ingestion boundary is production-shaped.

### 3:00–7:00 — Live case investigation

1. Open Inuka Assurance Overview and point to the review queue and exposure by control.
2. Open Anomalies and select a grouped case such as `DISB-002169`.
3. Explain the signals: ghost payment, duplicate disbursement, missing authorisation, or overpayment.
4. Show the beneficiary ID in the queue, then open the authorised detail view for sensitive evidence.
5. Demonstrate that a reviewer can assign, request evidence, mark false positive, resolve, or escalate a case; show the audit trail/action state.
6. Open Consent & Privacy and show status, withdraw/renew state, and anonymised-export indicator.

### 7:00–8:00 — Consent and privacy safeguards

Show that operational lists use beneficiary IDs rather than names, that the consent register is separate, that exports are explicitly marked as anonymised or blocked, and that access is workspace/role scoped. Explain that withdrawal should stop downstream non-essential use and trigger re-evaluation of existing exports in a production implementation.

### 8:00–9:00 — Quantified impact

Use the synthetic case count and amount-at-risk only as an example. Translate it into a pilot measurement plan: reduce time to detect, reduce duplicate/ghost disbursements, increase complete authorization evidence, improve consent completeness, and measure confirmed recovery after human adjudication.

### 9:00–10:00 — Pilot roadmap and Q&A

Propose a controlled pilot with one pillar and one payment channel: establish data dictionaries and data-sharing agreements, onboard registry/authorization/payment feeds, train reviewers, run shadow mode, compare precision and review time, then expand to all four pillars. Leave time for questions about synthetic data, production security, and false positives.

## Demo runbook

### Web and backend

```bash
docker compose up -d db backend frontend
open http://localhost:3000/login
```

Useful checks:

```bash
curl http://localhost:8000/health
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/inuka/stream/status
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/inuka/stream/events
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/inuka/consents
```

### Mobile field demonstration

```bash
cd mobile
cp .env.example .env
# Physical phone: set EXPO_PUBLIC_API_URL to http://<computer-LAN-IP>:8000
npm start
```

Scan the Expo QR code using Expo Go on a phone connected to the same Wi-Fi. Sign in with the demo Inuka account, open the menu, choose **Beneficiary Verification**, enter `BEN-0158`, capture a participation result, take a photo, and save. To demonstrate offline mode, stop the backend or temporarily disable phone Wi-Fi, save a second record, then restore connectivity and tap **Sync now**. The queue count should decrease and the API stream endpoint should show `verification.captured`. Physical phones must not use `localhost`; that address points back to the phone.

## Current limitations and honest next steps

The simulator is not a KPC production feed, the current event table is not a full Kafka/managed-stream deployment, and the mobile background task cannot authenticate after a cold OS restart without a platform-specific secure refresh mechanism. For a pilot, use a managed queue/stream, signed service-to-service ingestion, encrypted evidence storage, immutable audit logging, consent withdrawal propagation, and formal UAT with field officers.
