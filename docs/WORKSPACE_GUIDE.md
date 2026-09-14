# Reconova workspace guide

## Find the right workflow

Use the sidebar workspace selector. Switching a shared module keeps that module; switching from a domain-specific module opens the target overview. **Find a module** searches only links allowed for the current account. On narrow screens, use the menu button; the sidebar scrolls independently. The theme menu retains light, dark and system choices. Keyboard focus is visible, and motion follows the reduced-motion preference.

| Oil revenue | Inuka program assurance |
| --- | --- |
| Invoice/payment overview | Eligibility and disbursement overview |
| Oil anomalies and review queue | Cases by pillar/officer and beneficiary |
| OMC leakage and network risk | Payout exposure and program risk |
| Depot Operations: lane/drift previews | Programs & Pillars; Field Officers |
| E-Billing, Data Import | Beneficiaries; Consent & Privacy |
| Scoped reports and audit | Scoped reports and report verification |

Overview shows four primary metrics. Use Refresh overview for new reconciliation data. Exposure is money at risk, not cash saved. Recorded payments are not avoided leakage. Depot Operations sample statuses and the mobile gate preview do not control barriers or authorize dispatch. Real ERP/SCADA acknowledgements require connected adapters.

## Roles

| Role | Workspace | Allowed activity |
| --- | --- | --- |
| Depot Supervisor | Oil | Metrics, CSV ingestion, assigned-depot alerts; no case resolution or billing |
| Manager | Oil and Inuka | Read and export permitted assurance views; audit/oversight; no case mutations or billing |
| Revenue Assurance | Oil and Inuka | Investigation, case actions, exports; Oil billing and data ingestion |
| Inuka Manager | Inuka only | Read program metrics, cases, beneficiaries, pillars/officers, consent and reports |
| System Admin | Administration | User/permission management; no business dashboard by default |

The backend checks every scoped operation independently of link visibility. Custom roles must receive the feature permission and `view_outgoing_data` for Inuka. Restricted depot/Inuka roles cannot expand their workspace with extra feature permissions. Avoid assigning both restricted roles to one account. APIs reject denied actions with 403. No database migration is required for the access changes.

## Failure and integration behavior

- API loading/failure states are distinct from successful empty results. Refresh retries a failed overview or yard request.
- Case writes require `resolve_anomaly`; managers see case evidence/history without a write form.
- Oil E-Billing requires `manage_ebilling`, including iCMS logs in Reports.
- SAP/KRA issuance and SCADA ingestion prototypes return 501 until persistence and enterprise adapters exist. Nothing is issued or recorded on that response.
- Mobile gate results are local demonstrations. Field verification uploads require a write-authorized Inuka account; queued requests denied by the server remain unsent.
- The optional Chatbase widget is disabled by default because the embedded configuration produced a runtime error. Set `NEXT_PUBLIC_ENABLE_CHATBASE=true` at build time only after validating its deployment configuration.

## Release and support handover

1. Run backend tests against an isolated test database, plus frontend lint, typecheck, unit tests and build. Run `npm run typecheck` in mobile after `npm ci`.
2. Run `npx playwright test e2e/workspace-ui.spec.ts` in frontend for fixture-based UI checks. Set `CHROME_PATH` to a local Chrome/Chromium executable, or leave it unset in CI to use Playwright's installed browser. This proves UI behavior, not a live ERP connection.
3. Verify each seeded role against the deployed API. Inuka direct requests to gantry/billing must return 403; viewer case writes must return 403; unauthenticated control requests must return 401.
4. Follow RUNBOOK.md for deployment, readiness, rollback and recovery. Run live smoke checks after the CI-gated release.
5. Complete the acceptance column in HACKATHON_3_ALIGNMENT.md, record owners and restore evidence, and attach measured ROI before production sign-off.

## Dependency review

The mobile lockfile installs successfully, but npm reports 27 dependency advisories (5 high, 21 moderate, 1 low). These remain an outstanding release-security review; no forced major-version dependency upgrades were applied during the UI alignment. Track remediation and revalidate Expo/device compatibility before production acceptance.
