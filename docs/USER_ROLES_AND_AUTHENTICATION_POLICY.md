# KPC Revenue Assurance — User Roles and Authentication Policy

**Status:** Implementation guidance and system reference  
**Audience:** KPC product owners, security administrators, developers, testers, and deployment teams  
**Scope:** Oil Revenue Assurance, Inuka Program Assurance, and platform administration

## 1. Purpose

This document explains what each platform user is responsible for, which
business domain they can access, what actions they can take, and how identity
and password controls protect the platform. It is intended to accompany the
[Inuka Assurance SRS](./INUKA_ASSURANCE_SRS.md) during handover and review.

The platform is one application with separate workspaces and permissions. It
does not treat Inuka program assurance as an Oil workflow: the datasets,
metrics, cases, and navigation are isolated by domain while identity,
auditability, and security controls remain shared.

## 2. User responsibilities and boundaries

| Role | Primary responsibility | Workspace | Typical actions | Explicit boundary |
|---|---|---|---|---|
| **System Admin** | Operate the platform safely | Platform administration | Provision users, assign roles, disable accounts, force password resets, inspect account/security events | Does not investigate Oil or Inuka operational cases and cannot access their business data through the admin view |
| **Manager** | Executive oversight and escalation | Oil Revenue + Inuka Programs | Review cross-domain exposure, monitor alerts, open cases, escalate decisions, review reports | Does not replace the investigators or program officers who collect evidence and resolve work items |
| **Revenue Assurance** | Investigate leakage and fraud risk | Oil Revenue + Inuka Programs | Review reconciliation exceptions, inspect fraud intelligence, manage Oil assurance cases, review e-Billing and reports | Inuka access is for cross-domain oversight and coordination; Inuka-specific program work remains governed by the Inuka manager workflow |
| **Depot Supervisor** | Monitor assigned depot operations | Oil Revenue | Monitor live feed, review assigned-depot metrics and alerts, follow up operational exceptions | Cannot access other depots or Inuka program records |
| **Inuka Manager** | Protect beneficiary and program funds | Inuka Programs | Review pillar risk, inspect beneficiaries/officers/payments, request evidence, record a review decision, escalate suspected fraud | Cannot access Oil dispatch, invoice, OMC, depot, or e-Billing workflows |

### Shared principles

- A role determines the maximum workspace and action boundary; the frontend is
  only a presentation of that boundary. Backend permissions remain the source
  of truth.
- Every consequential action should be attributable to a user and retained in
  the audit trail: provisioning, access changes, password events, case
  decisions, evidence requests, escalations, and exports.
- Read access and action access are separate. Seeing a case does not
  automatically permit resolving it, changing source data, or approving a
  payment.
- High-risk actions should use a four-eyes workflow in later releases: the
  person who raises or investigates a case should not be the only person who
  closes or approves it.

## 3. Username and identity policy

The platform uses the user's work email address as the username. It is not a
display name and must be unique.

- Email addresses are trimmed and case-folded before storage, lookup, and
  login, so `Manager@KPC.co.ke` and `manager@kpc.co.ke` cannot become two
  accounts.
- The backend validates the address as an email and enforces database
  uniqueness. Display names are descriptive only and are never used for
  authentication.
- Admin provisioning is the normal production flow. It sends a one-time
  temporary password, expires it after 48 hours, and forces a reset before a
  normal session can be issued.
- The public/self-registration path remains restricted by the `manage_users`
  permission; it is not an open sign-up route.

## 4. Password enforcement policy

The active baseline is enforced server-side before hashing. The frontend shows
the same guidance for usability, but a client-side check is never trusted as a
security control.

| Rule | Enforcement |
|---|---|
| Minimum length | 12 characters |
| Character variety | At least one uppercase letter, lowercase letter, number, and symbol |
| Identity protection | Password cannot contain a meaningful fragment of the user's email local-part |
| Common-password protection | Rejects a small baseline list of obvious passwords; production should add a breached-password service or deny-list |
| Confirmation | New password and confirmation must match server-side |
| Temporary password | Cryptographically random, one-time delivery, 48-hour expiry, forced reset |
| Storage | Only a bcrypt hash is stored; plaintext passwords are not logged, returned, or persisted |
| Token safety | Reset tokens are short-lived, scoped to reset only, and invalidated when the password hash changes |

### Why the rules are not selectable per user

An administrator can view the active policy in the Admin workspace, but cannot
weaken it through a browser selector. A selectable policy that permits weak
passwords creates an account-level bypass and produces inconsistent security
across teams. If KPC security policy changes, the baseline should be changed
through a reviewed deployment/configuration change, tested, and documented for
all users at once.

The current API publishes the safe, non-secret policy description at
`GET /api/auth/password-policy` so the reset experience and admin view can
remain aligned with the backend.

## 5. Operational administration

The System Admin workspace should provide:

1. Account health counts: active, pending first login, and reset required.
2. User detail and role-permission preview before access is assigned.
3. Force-reset and account-disable actions with confirmation and audit events.
4. Recent authentication and administration events, without exposing Oil or
   Inuka operational records.
5. A visible password-policy summary and a link to this policy document.

It should not become an operational dashboard. Business investigation belongs
in the Oil and Inuka workspaces, where the user sees the data and actions that
match their responsibility.

## 6. Production follow-ups

Before production use, KPC should add identity-provider integration (or MFA),
rate limiting and lockout monitoring for repeated failed logins, a breached
password deny-list, privileged-action approval, and centralized alerting for
role changes and abnormal administrator activity. These are complementary to
the current baseline, not reasons to weaken it.
