"""
Central alert registry — every AlertType the platform can fire, with its
tier and its audience, defined in exactly one place. alert_service.create_alert()
takes an AlertType and pulls tier/audience from here rather than each call
site inventing its own — that's what makes "does alert routing follow the
same permission matrix as route access" a single answerable question
instead of N ad-hoc decisions scattered across the codebase.

Two ways to address an audience, both OR'd together with target_user_id:
  - target_permissions: visible to any active user holding ANY of these
    permission codes — the same codes require_permission() gates routes
    with. Use this for business/feature alerts: if a role can't reach the
    feature a trigger is about, don't put them in this list.
  - target_roles: visible to any active user holding ANY of these role
    names, regardless of feature permissions. Use this only for pure
    platform-operational concerns (ETL failures, SMTP delivery failures,
    bulk exports, four-eyes admin actions) where "system_admin" is the
    right audience precisely *because* they operate the platform, not
    because they hold a revenue-assurance feature permission — see
    README's "system_admin is scoped only to user management" note.
    Mixing both on one AlertType is intentionally allowed (e.g. e-billing
    DLQ: the people who can retry it, plus the platform operator).

Every entry below traces back to a specific trigger table drafted for this
platform's roles (Depot Supervisor / Manager / Revenue Assurance /
Admin). Where that table named a recipient the real permission model
doesn't support (e.g. "Admin" for something only a feature-permission
holder can act on), the audience here was corrected to match actual
permission holders instead, noted per-entry. `implemented=False` entries
are trigger points this registry defines on purpose but nothing in the
codebase fires yet — each says why (no scheduler, no lockout system, no
self-service password-change endpoint, no quota-consumption logic, no
stable cross-request cluster identity) rather than being silently absent.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class AlertTier(str, Enum):
    IMMEDIATE = "immediate"        # fire right away, one alert per event
    DIGESTED = "digested"          # batched into one alert covering a whole run (see notify_critical_anomalies)
    THROTTLED = "throttled"        # rate-limited to at most one per window regardless of event volume
    TRANSACTIONAL = "transactional"  # tied to one user's own action/account


class AlertType(str, Enum):
    # --- Reconciliation (services/reconciliation.py) ---
    CRITICAL_ANOMALY = "critical_anomaly"
    ANOMALY_MATERIALITY_SPIKE = "anomaly_materiality_spike"
    OMC_RISK_ESCALATION = "omc_risk_escalation"
    DATA_QUALITY_DROP = "data_quality_drop"
    DUPLICATE_SPIKE = "duplicate_spike"
    ANOMALY_REOPENED = "anomaly_reopened"
    REPEATED_RESOLVE_REOPEN = "repeated_resolve_reopen"
    ETL_RUN_FAILED = "etl_run_failed"

    # --- Fraud Graph (services/graph_engine.py) ---
    FRAUD_CLUSTER_NEW = "fraud_cluster_new"
    FRAUD_CLUSTER_RISK_INCREASE = "fraud_cluster_risk_increase"
    FRAUD_CLUSTER_OMC_JOINED = "fraud_cluster_omc_joined"

    # --- E-Billing (services/e_billing.py) ---
    EBILLING_DLQ = "ebilling_dlq"
    EBILLING_FAILURE_RATE_BREACH = "ebilling_failure_rate_breach"
    EBILLING_FAILURE_RATE_RECOVERED = "ebilling_failure_rate_recovered"
    EBILLING_WEBHOOK_FAILURE = "ebilling_webhook_failure"
    EBILLING_ENDPOINT_UNREACHABLE = "ebilling_endpoint_unreachable"

    # --- Auth & user lifecycle ---
    USER_PROVISIONED = "user_provisioned"
    TEMP_PASSWORD_EXPIRING_SOON = "temp_password_expiring_soon"
    TEMP_PASSWORD_EXPIRED = "temp_password_expired"
    FORCED_RESET_COMPLETED = "forced_reset_completed"
    PASSWORD_CHANGED_SELF_SERVICE = "password_changed_self_service"
    LOGIN_LOCKOUT = "login_lockout"
    USER_DEACTIVATED = "user_deactivated"
    USER_REACTIVATED = "user_reactivated"
    ROLE_CHANGED = "role_changed"

    # --- Audit / Admin ---
    ADMIN_SENSITIVE_ACTION = "admin_sensitive_action"
    BULK_EXPORT = "bulk_export"

    # --- System / Operational ---
    ALERT_DELIVERY_FAILED = "alert_delivery_failed"
    SCHEDULED_JOB_MISSED = "scheduled_job_missed"
    QUOTA_THRESHOLD = "quota_threshold"


@dataclass(frozen=True)
class AlertMeta:
    tier: AlertTier
    severity: str  # info | warning | critical
    target_permissions: list[str] = field(default_factory=list)
    target_roles: list[str] = field(default_factory=list)
    description: str = ""
    implemented: bool = True
    notes: str = ""


REGISTRY: dict[AlertType, AlertMeta] = {
    # ------------------------------------------------------------------
    # Reconciliation
    # ------------------------------------------------------------------
    AlertType.CRITICAL_ANOMALY: AlertMeta(
        tier=AlertTier.DIGESTED,
        severity="critical",
        target_permissions=["view_anomaly_table"],  # Manager + Revenue Assurance, exactly this pair
        description="New critical anomaly (Missing Invoice/Payment, Under/Overpayment above materiality).",
    ),
    AlertType.ANOMALY_MATERIALITY_SPIKE: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="critical",
        target_permissions=["view_anomaly_table"],
        target_roles=["system_admin"],
        description="A single anomaly far exceeds materiality (5-10x threshold) — too large to wait for the digest.",
    ),
    AlertType.OMC_RISK_ESCALATION: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_permissions=["view_omc_risk_profile"],  # Manager + Revenue Assurance
        description="An OMC's computed risk level reaches High.",
        notes=(
            "Fires the first time an OMC is seen at High risk (dedup by omc as related_id, "
            "same existence-check as critical_anomaly). omc_risk_profile is recomputed fresh "
            "every reconciliation run with no persisted history, so this can't detect a "
            "Medium->High->Medium->High re-escalation — only ever-reached-High-once."
        ),
    ),
    AlertType.DATA_QUALITY_DROP: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_roles=["system_admin"],
        description="Data quality score drops below threshold post-ETL — pipeline health, not a feature permission.",
    ),
    AlertType.DUPLICATE_SPIKE: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_roles=["system_admin"],
        description="Duplicate dispatch/invoice records spike above a configured count.",
        notes="No historical baseline is tracked — 'spike' is an absolute count threshold, not a rolling comparison.",
    ),
    AlertType.ANOMALY_REOPENED: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_permissions=["view_anomaly_table"],
        description="A previously Resolved anomaly is set back to a non-Resolved status.",
        notes="Corrected from the source table's 'Revenue Assurance, Admin' — Admin can't view anomalies at all, so was dropped.",
    ),
    AlertType.REPEATED_RESOLVE_REOPEN: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_roles=["system_admin"],
        description="Same dispatch resolved/reopened repeatedly by the same user within a short window.",
    ),
    AlertType.ETL_RUN_FAILED: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="critical",
        target_roles=["system_admin"],
        description="scripts/etl_pipeline.py's main() raised before completing.",
    ),

    # ------------------------------------------------------------------
    # Fraud Graph
    # ------------------------------------------------------------------
    AlertType.FRAUD_CLUSTER_NEW: AlertMeta(
        tier=AlertTier.DIGESTED,
        severity="warning",
        target_permissions=["view_fraud_graph"],  # Revenue Assurance only
        description="A new correlated-leakage community is detected by Louvain clustering.",
        notes="Identity = hash of the community's sorted OMC-id set; membership changes read as a 'new' cluster.",
    ),
    AlertType.FRAUD_CLUSTER_RISK_INCREASE: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="critical",
        target_permissions=["view_fraud_graph"],
        implemented=False,
        description="An existing cluster's risk_level increases (e.g. Medium -> High).",
        notes=(
            "Deferred: FRAUD_CLUSTER_NEW only alerts once a cluster is already High-risk (to avoid "
            "spamming on every Low/Medium community), which means there's no recorded prior state to "
            "detect an escalation *from* — the dedup-by-existence mechanism can tell 'seen before' vs "
            "'not seen before' but not 'was Medium, now High' without persisting risk_level history for "
            "every community on every run, not just the High ones. Would need that history table first."
        ),
    ),
    AlertType.FRAUD_CLUSTER_OMC_JOINED: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_permissions=["view_fraud_graph"],
        target_roles=["system_admin"],
        implemented=False,
        description="An OMC joins an existing high-risk cluster.",
        notes=(
            "Deferred: Louvain community numbering isn't a stable identity across separate graph "
            "computations, and the graph is built on-demand (no persisted cluster-membership history "
            "to diff a new OMC arrival against). Would need a stable clustering-identity store first."
        ),
    ),

    # ------------------------------------------------------------------
    # E-Billing
    # ------------------------------------------------------------------
    AlertType.EBILLING_DLQ: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="critical",
        target_permissions=["manage_ebilling"],  # Revenue Assurance — can actually retry it
        target_roles=["system_admin"],
        description="An invoice enters the dead-letter queue after exhausting retries.",
    ),
    AlertType.EBILLING_FAILURE_RATE_BREACH: AlertMeta(
        tier=AlertTier.THROTTLED,
        severity="warning",
        target_permissions=["manage_ebilling"],
        target_roles=["system_admin"],
        description="Sync failure rate exceeds FAILURE_THRESHOLD. At most one alert per hour.",
        notes="Corrected from 'Admin, Manager' — Manager holds no e-billing permission and can't act on this; swapped for the actual actor (manage_ebilling).",
    ),
    AlertType.EBILLING_FAILURE_RATE_RECOVERED: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="info",
        target_permissions=["manage_ebilling"],
        target_roles=["system_admin"],
        description="Failure rate drops back under threshold after a breach.",
    ),
    AlertType.EBILLING_WEBHOOK_FAILURE: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_permissions=["manage_ebilling"],
        target_roles=["system_admin"],
        description="KRA webhook callback reports status=failed for an invoice.",
    ),
    AlertType.EBILLING_ENDPOINT_UNREACHABLE: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="critical",
        target_roles=["system_admin"],
        implemented=False,
        description="Sustained iCMS endpoint outage (consecutive failures, not just one).",
        notes="Deferred: needs a consecutive-failure counter beyond a single call; EBILLING_DLQ and the failure-rate breach already surface the practical effect of this today.",
    ),

    # ------------------------------------------------------------------
    # Auth & user lifecycle
    # ------------------------------------------------------------------
    AlertType.USER_PROVISIONED: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="info",
        description="A new admin-provisioned account's temp password.",
        notes=(
            "Special-cased in routes/admin.py: calls app.core.email.send_email directly, bypassing "
            "create_alert()/the Alert table entirely, because the message contains the plaintext temp "
            "password and create_alert() always persists its message — exactly what must never happen. "
            "No in-app row for this one, by design."
        ),
    ),
    AlertType.TEMP_PASSWORD_EXPIRING_SOON: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="info",
        implemented=False,
        description="Warn a user their temp password will expire soon, before they've used it.",
        notes="Deferred: needs a scheduled job to notice time passing with no login; no scheduler exists in this codebase yet.",
    ),
    AlertType.TEMP_PASSWORD_EXPIRED: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="warning",
        target_roles=["system_admin"],
        description="A user attempted to log in with an expired temp password.",
    ),
    AlertType.FORCED_RESET_COMPLETED: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="info",
        description="Confirmation to the user that their forced password reset succeeded.",
        notes="In-app only (notify_email=False) — it's a same-request confirmation of an action the user just took, an email would be redundant noise.",
    ),
    AlertType.PASSWORD_CHANGED_SELF_SERVICE: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="warning",
        implemented=False,
        description="Security notice when a user changes their own password while already logged in.",
        notes="Deferred: no such endpoint exists yet (only admin-set passwords and the forced-reset flow) — not built as a side effect of alerts work.",
    ),
    AlertType.LOGIN_LOCKOUT: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="critical",
        target_roles=["system_admin"],
        implemented=False,
        description="Failed-login threshold exceeded for an account.",
        notes="Deferred: no rate-limiting/lockout system exists in this codebase (flagged previously too) — not built as a side effect of alerts work.",
    ),
    AlertType.USER_DEACTIVATED: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="warning",
        description="An admin deactivates a user's account.",
    ),
    AlertType.USER_REACTIVATED: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="info",
        description="An admin reactivates a previously deactivated account.",
    ),
    AlertType.ROLE_CHANGED: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="info",
        description="An admin changes a user's role.",
    ),

    # ------------------------------------------------------------------
    # Audit / Admin
    # ------------------------------------------------------------------
    AlertType.ADMIN_SENSITIVE_ACTION: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="warning",
        target_roles=["system_admin"],
        description="A sensitive admin action (user created/deleted, role changed) — four-eyes visibility to every OTHER admin.",
        notes="The acting admin is excluded from recipients — see create_alert()'s exclude_user_id.",
    ),
    AlertType.BULK_EXPORT: AlertMeta(
        tier=AlertTier.TRANSACTIONAL,
        severity="info",
        target_roles=["system_admin"],
        description="A user performs a large/bulk export.",
    ),

    # ------------------------------------------------------------------
    # System / Operational
    # ------------------------------------------------------------------
    AlertType.ALERT_DELIVERY_FAILED: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="warning",
        target_roles=["system_admin"],
        description="An alert's own email delivery failed (SMTP bounce/unreachable) — in-app fallback only.",
        notes="notify_email is forced False when creating this one — retrying the same failing SMTP call would be pointless.",
    ),
    AlertType.SCHEDULED_JOB_MISSED: AlertMeta(
        tier=AlertTier.IMMEDIATE,
        severity="critical",
        target_roles=["system_admin"],
        implemented=False,
        description="A scheduled job (ETL, sync, digest) misses its expected run window.",
        notes="Deferred: no job scheduler exists in this codebase — ETL/sync are run manually or via docker startup, not on a cron.",
    ),
    AlertType.QUOTA_THRESHOLD: AlertMeta(
        tier=AlertTier.THROTTLED,
        severity="warning",
        target_roles=["system_admin"],
        implemented=False,
        description="An OMC's quota usage approaches/exceeds its allocated threshold.",
        notes="Deferred: quota_ledger (backend/SCHEMA_NOTES.md) has a table but no service/route/recalculation job reading or writing it yet — nothing to hook this into.",
    ),
}


def get_meta(alert_type: AlertType) -> AlertMeta:
    return REGISTRY[alert_type]
