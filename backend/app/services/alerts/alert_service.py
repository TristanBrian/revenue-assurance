"""
Alert / notification service — backs routes/alerts/alerts.py, and is called from
every other service/route that generates a system alert. See
services/alerts/alert_types.py for the full trigger -> tier -> audience registry
this module is driven by; this file is the mechanics (create/read/dedup/
throttle), that file is the policy (who gets what, why).

Framework-agnostic on purpose (no FastAPI imports) — same convention as
audit_service.py / reconciliation.py / e_billing.py.

Two channels, one call: create_alert() always writes an in-app Alert row,
and (unless notify_email=False) also emails it via app.core.email —
callers don't pick a channel separately.

Visibility-filtering note: Alert.target_permissions/target_roles are JSON
list columns. Matching "does this list share anything with the viewing
user's permissions/roles" portably across Postgres and SQLite (tests run
against in-memory SQLite) without raw dialect-specific JSONB operators is
done in Python, over a bounded recent-alerts window (_VISIBILITY_SCAN_LIMIT)
rather than as a SQL WHERE clause — this table stays small (hundreds to
low-thousands of rows for an app this size), so the simplicity/portability
trade is worth it. Recipient *emailing* doesn't have this problem at all:
target_permissions/target_roles arrive as plain Python lists from the
registry at creation time, resolved against users_with_permission/
users_with_role (ordinary relational joins, no JSON involved).
"""
import hashlib
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.email import is_configured, send_email
from app.models.alerts.alert import Alert
from app.models.alerts.alert_read import AlertRead
from app.models.auth.permission import Permission
from app.models.auth.role import Role
from app.models.auth.user import User
from app.services.alerts.alert_types import AlertTier, AlertType, get_meta

APP_NAME = "KPC Revenue Assurance"
_VISIBILITY_SCAN_LIMIT = 5000

# ============================================================================
# Configurable thresholds for the new reconciliation-side triggers. Same
# convention as services/reconciliation/reconciliation.py's MATERIALITY_THRESHOLD /
# CRITICAL_AGE_DAYS — plain module constants, not (yet) env-driven.
# ============================================================================
MATERIALITY_SPIKE_MULTIPLIER = 5       # a single anomaly >= 5x materiality fires immediately
DATA_QUALITY_ALERT_THRESHOLD = 70.0    # quality_score below this fires immediately
DUPLICATE_SPIKE_THRESHOLD = 50         # duplicate_count above this fires immediately
REPEATED_RESOLVE_REOPEN_THRESHOLD = 3  # status changes on one dispatch...
REPEATED_RESOLVE_REOPEN_WINDOW_DAYS = 7  # ...within this many days


def _coerce_uuid(value):
    if value is None:
        return None
    try:
        return uuid_lib.UUID(str(value))
    except ValueError:
        return None


# ============================================================================
# RECIPIENT RESOLUTION (for emailing — ordinary relational queries)
# ============================================================================

def users_with_permission(db: Session, permission_code: str) -> list[User]:
    """Every active user holding `permission_code` through any role — the
    same set require_permission(permission_code) would let through."""
    return (
        db.query(User)
        .join(User.roles)
        .join(Role.permissions)
        .filter(Permission.code == permission_code, User.is_active.is_(True))
        .distinct()
        .all()
    )


def users_with_role(db: Session, role_name: str) -> list[User]:
    return (
        db.query(User)
        .join(User.roles)
        .filter(Role.name == role_name, User.is_active.is_(True))
        .distinct()
        .all()
    )


def _audience_users(db: Session, target_permissions: list[str], target_roles: list[str]) -> list[User]:
    seen: dict = {}
    for code in target_permissions:
        for u in users_with_permission(db, code):
            seen[u.id] = u
    for name in target_roles:
        for u in users_with_role(db, name):
            seen[u.id] = u
    return list(seen.values())


def _recipient_emails(
    db: Session,
    target_permissions: list[str],
    target_roles: list[str],
    target_user_id,
    exclude_user_id=None,
) -> list[str]:
    if target_user_id is not None:
        # No is_active filter here on purpose (unlike the permission/role
        # branches below): an explicit single-user target is a deliberate
        # address chosen by the caller — e.g. notify_user_deactivated_or_
        # reactivated() targets a user whose is_active is already False by
        # the time it calls this, and the whole point is to still email them.
        user = db.query(User).filter(User.id == target_user_id).first()
        if user is None or user.id == exclude_user_id:
            return []
        return [user.email]
    if target_permissions or target_roles:
        users = _audience_users(db, target_permissions, target_roles)
    else:
        users = db.query(User).filter(User.is_active.is_(True)).all()
    return [u.email for u in users if u.id != exclude_user_id]


def _user_can_see(alert: Alert, perm_codes: set, role_names: set, user_id) -> bool:
    if alert.exclude_user_id is not None and alert.exclude_user_id == user_id:
        return False
    if alert.target_user_id is not None:
        return alert.target_user_id == user_id
    tp = set(alert.target_permissions or [])
    tr = set(alert.target_roles or [])
    if not tp and not tr:
        return True  # general announcement
    return bool(tp & perm_codes) or bool(tr & role_names)


# ============================================================================
# DEDUP / THROTTLE HELPERS
# ============================================================================

def alert_exists(db: Session, category: str, related_id: str) -> bool:
    """'Ever alerted' de-dup guard, used for triggers that should fire at
    most once per thing (a dispatch, an OMC, a cluster) — see
    notify_critical_anomalies / notify_omc_risk_escalation."""
    if not related_id:
        return False
    return (
        db.query(Alert)
        .filter(Alert.category == category, Alert.related_id == related_id)
        .first()
        is not None
    )


def _most_recent_alert(db: Session, category: str, related_id: Optional[str] = None) -> Optional[Alert]:
    query = db.query(Alert).filter(Alert.category == category)
    if related_id is not None:
        query = query.filter(Alert.related_id == related_id)
    return query.order_by(Alert.created_at.desc()).first()


def _within_throttle_window(alert: Optional[Alert], window: timedelta) -> bool:
    if alert is None:
        return False
    created_at = alert.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - created_at < window


# ============================================================================
# CREATE (in-app row + optional email, one call) — registry-driven
# ============================================================================

def create_alert(
    db: Session,
    *,
    title: str,
    message: str,
    alert_type: Optional[AlertType] = None,
    category: Optional[str] = None,
    severity: Optional[str] = None,
    tier: Optional[AlertTier] = None,
    target_permissions: Optional[list[str]] = None,
    target_roles: Optional[list[str]] = None,
    target_user_id=None,
    related_type: Optional[str] = None,
    related_id: Optional[str] = None,
    created_by_user_id=None,
    exclude_user_id=None,
    notify_email: bool = True,
) -> Alert:
    """
    Adds an Alert row to `db` and flushes it, but does NOT call db.commit()
    itself — same contract as audit_service.log_action: the caller commits
    as part of its own transaction, so an alert is atomic with the action
    it's about.

    Pass `alert_type` for anything in alert_types.REGISTRY — tier/severity/
    audience come from there, and `target_permissions`/`target_roles` here
    are *additive* to the registry's (e.g. a manual override adding one
    more recipient), not a replacement. Omit `alert_type` (category="manual"
    broadcasts) to specify everything explicitly instead.
    """
    if alert_type is not None:
        meta = get_meta(alert_type)
        resolved_category = alert_type.value
        resolved_severity = severity or meta.severity
        resolved_tier = (tier or meta.tier).value
        resolved_permissions = list(dict.fromkeys([*meta.target_permissions, *(target_permissions or [])]))
        resolved_roles = list(dict.fromkeys([*meta.target_roles, *(target_roles or [])]))
    else:
        resolved_category = category or "manual"
        resolved_severity = severity or "info"
        resolved_tier = (tier or AlertTier.IMMEDIATE).value
        resolved_permissions = list(target_permissions or [])
        resolved_roles = list(target_roles or [])

    alert = Alert(
        title=title,
        message=message,
        severity=resolved_severity,
        tier=resolved_tier,
        category=resolved_category,
        target_permissions=resolved_permissions or None,
        target_roles=resolved_roles or None,
        target_user_id=target_user_id,
        related_type=related_type,
        related_id=related_id,
        created_by_user_id=created_by_user_id,
        exclude_user_id=exclude_user_id,
    )
    db.add(alert)
    db.flush()

    if notify_email:
        recipients = _recipient_emails(db, resolved_permissions, resolved_roles, target_user_id, exclude_user_id)
        if recipients:
            sent = send_email(
                to=recipients,
                subject=f"[{APP_NAME}] {title}",
                html_body=f"<p><strong>{title}</strong></p><p>{message}</p>",
                text_body=message,
            )
            alert.email_sent = sent
            if not sent and alert_type is not AlertType.ALERT_DELIVERY_FAILED:
                _notify_alert_delivery_failed(db, failed_alert=alert, recipient_count=len(recipients))

    return alert


def _notify_alert_delivery_failed(db: Session, failed_alert: Alert, recipient_count: int) -> None:
    """In-app-only follow-up when an alert's own email failed to send —
    forced notify_email=False (retrying the same failing SMTP call would
    be pointless) and forced alert_type=ALERT_DELIVERY_FAILED so this
    can't recurse into itself.

    Gated on is_configured(): send_email() returns False for two very
    different reasons — SMTP is configured but the send itself broke
    (genuine delivery failure, worth an alert), or SMTP was simply never
    configured at all (the expected state for e.g. CI, or any deployment
    that hasn't set SMTP_* yet — not a failure of anything, and alerting
    on it would mean *every* alert creation spawns a second one, forever,
    in any environment without SMTP set up). Only the first case is a
    delivery failure; this exists to alert on that one, not the other.
    """
    if not is_configured():
        return
    create_alert(
        db,
        alert_type=AlertType.ALERT_DELIVERY_FAILED,
        title=f"Email delivery failed: {failed_alert.title}",
        message=(
            f"An alert (category={failed_alert.category}, id={failed_alert.id}) was created but its "
            f"email to {recipient_count} recipient(s) failed to send. Check SMTP configuration and logs."
        ),
        related_type="alert",
        related_id=str(failed_alert.id),
        notify_email=False,
    )


# ============================================================================
# RECONCILIATION TRIGGERS (called from routes/reconciliation/reconcile.py's
# reconcile_metrics() cache-miss branch)
# ============================================================================

def notify_critical_anomalies(db: Session, anomalies: list[dict]) -> list[Alert]:
    """
    One Alert row per *new* critical anomaly (so each is individually
    visible/resolvable in the in-app inbox), but a single digest email per
    call — sample data runs to 80+ critical anomalies at once, and a
    same-count flood of individual emails would be a worse notification
    experience, not a better one. Idempotent via alert_exists()/
    related_id=dispatch_id. Caller must db.commit().
    """
    meta = get_meta(AlertType.CRITICAL_ANOMALY)
    new_critical = [
        a
        for a in anomalies
        if a.get("status") == "Critical"
        and a.get("dispatch_id")
        and not alert_exists(db, category=AlertType.CRITICAL_ANOMALY.value, related_id=a["dispatch_id"])
    ]
    if not new_critical:
        return []

    created = []
    for a in new_critical:
        alert = Alert(
            title=f"Critical anomaly: {a.get('break_type', 'leakage')} — {a['dispatch_id']}",
            message=(
                f"Dispatch {a['dispatch_id']} ({a.get('customer', 'unknown customer')}) is flagged "
                f"{a.get('break_type', 'a critical anomaly')} with KES {a.get('leakage_kes', 0):,} in leakage."
            ),
            severity=meta.severity,
            tier=meta.tier.value,
            category=AlertType.CRITICAL_ANOMALY.value,
            target_permissions=list(meta.target_permissions) or None,
            target_roles=list(meta.target_roles) or None,
            related_type="dispatch",
            related_id=a["dispatch_id"],
        )
        db.add(alert)
        created.append(alert)
    db.flush()

    total_leakage = sum(a.get("leakage_kes", 0) for a in new_critical)
    recipients = _recipient_emails(db, meta.target_permissions, meta.target_roles, None)
    if recipients:
        rows = "".join(
            f"<li>{a['dispatch_id']} — {a.get('customer', 'unknown')} — "
            f"{a.get('break_type', '')} — KES {a.get('leakage_kes', 0):,}</li>"
            for a in new_critical[:25]
        )
        more = f"<p>…and {len(new_critical) - 25} more.</p>" if len(new_critical) > 25 else ""
        subject = (
            f"[{APP_NAME}] {len(new_critical)} new critical anomal"
            f"{'y' if len(new_critical) == 1 else 'ies'} — KES {total_leakage:,} leakage"
        )
        sent = send_email(
            to=recipients,
            subject=subject,
            html_body=(
                f"<p><strong>{len(new_critical)} new critical anomalies</strong> found, "
                f"totaling <strong>KES {total_leakage:,}</strong> in leakage.</p>"
                f"<ul>{rows}</ul>{more}"
                f"<p>Review and resolve in the Anomalies dashboard.</p>"
            ),
            text_body=(
                f"{len(new_critical)} new critical anomalies found, totaling KES {total_leakage:,} in leakage.\n"
                + "\n".join(f"- {a['dispatch_id']} ({a.get('break_type', '')})" for a in new_critical[:25])
            ),
        )
        for alert in created:
            alert.email_sent = sent
        if not sent:
            _notify_alert_delivery_failed(db, failed_alert=created[0], recipient_count=len(recipients))

    return created


def notify_materiality_spike(db: Session, anomalies: list[dict], materiality: float) -> list[Alert]:
    """A single anomaly at >= MATERIALITY_SPIKE_MULTIPLIER x materiality is
    too large to wait for the digest — one immediate alert per such
    anomaly, deduped by dispatch_id like the critical-anomaly digest."""
    spike_threshold = materiality * MATERIALITY_SPIKE_MULTIPLIER
    created = []
    for a in anomalies:
        dispatch_id = a.get("dispatch_id")
        leakage = a.get("leakage_kes", 0)
        if not dispatch_id or leakage < spike_threshold:
            continue
        if alert_exists(db, category=AlertType.ANOMALY_MATERIALITY_SPIKE.value, related_id=dispatch_id):
            continue
        alert = create_alert(
            db,
            alert_type=AlertType.ANOMALY_MATERIALITY_SPIKE,
            title=f"Materiality spike: KES {leakage:,} — {dispatch_id}",
            message=(
                f"Dispatch {dispatch_id} ({a.get('customer', 'unknown')}) shows KES {leakage:,} in leakage — "
                f"{leakage / materiality:.1f}x the materiality threshold (KES {materiality:,.0f})."
            ),
            related_type="dispatch",
            related_id=dispatch_id,
        )
        created.append(alert)
    return created


def notify_omc_risk_escalation(db: Session, omc_risk_profile: list[dict]) -> list[Alert]:
    """
    One Alert row per OMC newly seen at High risk (dedup by OMC name — see
    alert_types.REGISTRY[OMC_RISK_ESCALATION].notes for the "ever, not
    re-escalation" limitation), but one digest email per call — a dataset
    can plausibly surface a dozen+ newly-High OMCs in a single run, and
    a same-count flood of individual emails is both a bad notification
    experience and a good way to trip SMTP rate limiting (observed live:
    20 individual sends here measurably contributed to a subsequent send
    timing out). Same batching shape as notify_critical_anomalies.
    """
    meta = get_meta(AlertType.OMC_RISK_ESCALATION)
    new_escalations = [
        row
        for row in omc_risk_profile
        if row.get("risk_level") == "High"
        and row.get("customer")
        and not alert_exists(db, category=AlertType.OMC_RISK_ESCALATION.value, related_id=row["customer"])
    ]
    if not new_escalations:
        return []

    created = []
    for row in new_escalations:
        omc = row["customer"]
        alert = Alert(
            title=f"OMC risk escalation: {omc} is now High risk",
            message=(
                f"{omc} has escalated to High risk — KES {row.get('leakage_kes', 0):,} in cumulative leakage "
                f"across {row.get('anomaly_count', 0)} anomalies."
            ),
            severity=meta.severity,
            tier=meta.tier.value,
            category=AlertType.OMC_RISK_ESCALATION.value,
            target_permissions=list(meta.target_permissions) or None,
            target_roles=list(meta.target_roles) or None,
            related_type="omc",
            related_id=omc,
        )
        db.add(alert)
        created.append(alert)
    db.flush()

    recipients = _recipient_emails(db, meta.target_permissions, meta.target_roles, None)
    if recipients:
        rows = "".join(
            f"<li>{r['customer']} — KES {r.get('leakage_kes', 0):,} across {r.get('anomaly_count', 0)} anomalies</li>"
            for r in new_escalations
        )
        sent = send_email(
            to=recipients,
            subject=f"[{APP_NAME}] {len(new_escalations)} OMC(s) escalated to High risk",
            html_body=f"<p><strong>{len(new_escalations)} OMCs</strong> newly escalated to High risk:</p><ul>{rows}</ul>",
            text_body=f"{len(new_escalations)} OMCs newly escalated to High risk:\n" + "\n".join(
                f"- {r['customer']} (KES {r.get('leakage_kes', 0):,})" for r in new_escalations
            ),
        )
        for alert in created:
            alert.email_sent = sent
        if not sent:
            _notify_alert_delivery_failed(db, failed_alert=created[0], recipient_count=len(recipients))

    return created


def notify_data_quality_drop(db: Session, data_quality: dict) -> Optional[Alert]:
    score = data_quality.get("quality_score")
    if score is None or score >= DATA_QUALITY_ALERT_THRESHOLD:
        return None
    recent = _most_recent_alert(db, category=AlertType.DATA_QUALITY_DROP.value)
    if _within_throttle_window(recent, timedelta(hours=1)):
        return None
    return create_alert(
        db,
        alert_type=AlertType.DATA_QUALITY_DROP,
        title=f"Data quality score dropped to {score}%",
        message=(
            f"Post-ETL data quality score is {score}% (threshold {DATA_QUALITY_ALERT_THRESHOLD}%) — "
            f"{data_quality.get('null_volume', 0)} null volumes, {data_quality.get('null_value', 0)} null values, "
            f"{data_quality.get('invalid_customer', 0)} invalid customer references."
        ),
    )


def notify_duplicate_spike(db: Session, duplicate_anomalies: list[dict]) -> list[Alert]:
    created = []
    for dup in duplicate_anomalies:
        count = dup.get("duplicate_count", 0)
        column = dup.get("column", "unknown")
        if count < DUPLICATE_SPIKE_THRESHOLD:
            continue
        related_id = column  # one alert per offending column, not per row
        recent = _most_recent_alert(db, category=AlertType.DUPLICATE_SPIKE.value, related_id=related_id)
        if _within_throttle_window(recent, timedelta(hours=1)):
            continue
        alert = create_alert(
            db,
            alert_type=AlertType.DUPLICATE_SPIKE,
            title=f"Duplicate spike on '{column}': {count} rows",
            message=(
                f"{count} duplicate rows detected on column '{column}' ({dup.get('label', '')}) — "
                f"above the {DUPLICATE_SPIKE_THRESHOLD}-row threshold."
            ),
            related_type="column",
            related_id=related_id,
        )
        created.append(alert)
    return created


def notify_anomaly_reopened(db: Session, dispatch_id: str, before_status: Optional[str], new_status: str) -> Optional[Alert]:
    """Called from services/ebilling/e_billing.py's update_anomaly_status(). Caller
    commits alongside the resolution write, same transaction."""
    if before_status != "Resolved" or new_status == "Resolved":
        return None
    return create_alert(
        db,
        alert_type=AlertType.ANOMALY_REOPENED,
        title=f"Anomaly reopened: {dispatch_id}",
        message=f"Dispatch {dispatch_id} was Resolved and has been set back to {new_status}.",
        related_type="dispatch",
        related_id=dispatch_id,
        notify_email=False,  # immediate but in-app is enough here; audit trail has the full history
    )


def notify_repeated_resolve_reopen(db: Session, dispatch_id: str, actor_user_id, change_count: int) -> Optional[Alert]:
    """Called from services/ebilling/e_billing.py's update_anomaly_status() with a
    count of status changes on this dispatch within
    REPEATED_RESOLVE_REOPEN_WINDOW_DAYS. Fires once per breach, not once
    per subsequent change past the threshold."""
    if change_count < REPEATED_RESOLVE_REOPEN_THRESHOLD:
        return None
    recent = _most_recent_alert(db, category=AlertType.REPEATED_RESOLVE_REOPEN.value, related_id=dispatch_id)
    if _within_throttle_window(recent, timedelta(days=REPEATED_RESOLVE_REOPEN_WINDOW_DAYS)):
        return None
    return create_alert(
        db,
        alert_type=AlertType.REPEATED_RESOLVE_REOPEN,
        title=f"Repeated status changes: {dispatch_id}",
        message=(
            f"Dispatch {dispatch_id} has changed status {change_count} times within "
            f"{REPEATED_RESOLVE_REOPEN_WINDOW_DAYS} days (same user) — possible process or data issue."
        ),
        related_type="dispatch",
        related_id=dispatch_id,
    )


def notify_etl_failed(db: Session, error: str) -> Alert:
    """Called from scripts/etl_pipeline.py's own SessionLocal on an
    unhandled exception in main(). Caller commits."""
    return create_alert(
        db,
        alert_type=AlertType.ETL_RUN_FAILED,
        title="ETL run failed",
        message=f"scripts/etl_pipeline.py did not complete: {error}",
    )


# ============================================================================
# FRAUD GRAPH TRIGGERS (called from routes/fraud/graph.py's fraud_graph() on a
# cache miss)
# ============================================================================

def _cluster_identity(node_ids: list[str]) -> str:
    """A stable, short identity for a cluster's membership — Alert.related_id
    is varchar(100), and raw concatenated node ids ("depot:Mombasa (KOSF)|
    omc:OMC-007|...") blow past that for anything but a tiny cluster
    (observed live: a 7-member cluster produced a 100+ char string and
    silently failed every insert in the batch — caught only because the
    caller's try/except logged it as non-fatal, not because it worked)."""
    raw = "|".join(sorted(node_ids))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def notify_fraud_clusters(db: Session, communities: list[dict]) -> list[Alert]:
    """
    One Alert row per newly-seen High-risk cluster (identity = hash of its
    sorted OMC-id set — see alert_types.REGISTRY's notes), one digest email
    per call covering all of them — same batching reasoning as
    notify_critical_anomalies. FRAUD_CLUSTER_RISK_INCREASE and
    FRAUD_CLUSTER_OMC_JOINED are deliberately not attempted here — see
    their registry entries for why a correct implementation needs more
    persisted state than this function has.
    """
    meta = get_meta(AlertType.FRAUD_CLUSTER_NEW)

    new_clusters = []
    for community in communities:
        node_ids = community.get("node_ids", [])
        if community.get("risk_level") != "High" or not node_ids:
            continue
        cluster_id = _cluster_identity(node_ids)
        if alert_exists(db, category=AlertType.FRAUD_CLUSTER_NEW.value, related_id=cluster_id):
            continue
        new_clusters.append((cluster_id, community))

    if not new_clusters:
        return []

    created = []
    for cluster_id, community in new_clusters:
        alert = Alert(
            title=f"New high-risk cluster: {community.get('member_count', len(community.get('node_ids', [])))} OMCs",
            message=(
                f"Louvain clustering found a new correlated-leakage community — "
                f"KES {community.get('total_leakage_kes', 0):,} across "
                f"{community.get('member_count', 0)} members."
            ),
            severity=meta.severity,
            tier=meta.tier.value,
            category=AlertType.FRAUD_CLUSTER_NEW.value,
            target_permissions=list(meta.target_permissions) or None,
            target_roles=list(meta.target_roles) or None,
            related_type="cluster",
            related_id=cluster_id,
        )
        db.add(alert)
        created.append(alert)
    db.flush()

    recipients = _recipient_emails(db, meta.target_permissions, meta.target_roles, None)
    if recipients:
        sent = send_email(
            to=recipients,
            subject=f"[{APP_NAME}] {len(new_clusters)} new high-risk fraud cluster(s)",
            html_body="<p>" + "</p><p>".join(a.message for a in created) + "</p>",
            text_body="\n\n".join(a.message for a in created),
        )
        for alert in created:
            alert.email_sent = sent
        if not sent:
            _notify_alert_delivery_failed(db, failed_alert=created[0], recipient_count=len(recipients))

    return created


# ============================================================================
# E-BILLING TRIGGERS
# ============================================================================

def notify_ebilling_dlq(db: Session, invoice_id: str, error_message: str) -> Optional[Alert]:
    """Called from services/ebilling/e_billing.py's sync_invoices_to_ebilling() on
    each DLQ insert. Deduped per invoice — a retried-and-failed-again
    invoice doesn't re-alert every attempt."""
    if alert_exists(db, category=AlertType.EBILLING_DLQ.value, related_id=invoice_id):
        return None
    return create_alert(
        db,
        alert_type=AlertType.EBILLING_DLQ,
        title=f"Invoice in dead-letter queue: {invoice_id}",
        message=f"Invoice {invoice_id} exhausted retries and entered the DLQ: {error_message}",
        related_type="invoice",
        related_id=invoice_id,
    )


def notify_ebilling_failure_rate(db: Session, failure_rate: float, threshold: float) -> Optional[Alert]:
    """Called after every sync (sync_invoices_to_ebilling). Throttled to at
    most one breach alert per hour; also fires a one-off recovery alert
    the first time the rate drops back under threshold after a breach.
    Caller must db.commit()."""
    breached = failure_rate > threshold
    last_breach = _most_recent_alert(db, category=AlertType.EBILLING_FAILURE_RATE_BREACH.value)
    last_recovery = _most_recent_alert(db, category=AlertType.EBILLING_FAILURE_RATE_RECOVERED.value)
    was_breached = last_breach is not None and (
        last_recovery is None or last_breach.created_at > last_recovery.created_at
    )

    if breached:
        if _within_throttle_window(last_breach, timedelta(hours=1)):
            return None
        return create_alert(
            db,
            alert_type=AlertType.EBILLING_FAILURE_RATE_BREACH,
            title=f"E-Billing failure rate breach: {failure_rate}%",
            message=(
                f"E-billing sync failure rate is {failure_rate}%, above the {threshold}% threshold. "
                f"Review the sync logs and dead-letter queue."
            ),
        )
    if was_breached:
        return create_alert(
            db,
            alert_type=AlertType.EBILLING_FAILURE_RATE_RECOVERED,
            title=f"E-Billing failure rate recovered: {failure_rate}%",
            message=f"E-billing sync failure rate is back to {failure_rate}%, under the {threshold}% threshold.",
        )
    return None


def notify_ebilling_webhook_failure(db: Session, invoice_id: str, message: str) -> Alert:
    return create_alert(
        db,
        alert_type=AlertType.EBILLING_WEBHOOK_FAILURE,
        title=f"Webhook failure: {invoice_id}",
        message=f"KRA webhook reported failure for invoice {invoice_id}: {message}",
        related_type="invoice",
        related_id=invoice_id,
        notify_email=False,  # one per failed webhook could be frequent; in-app is enough, DLQ/failure-rate carry the email escalation
    )


# ============================================================================
# AUTH & USER LIFECYCLE TRIGGERS
# ============================================================================

def notify_temp_password_expired(db: Session, user: User) -> Optional[Alert]:
    """Deduped per user+expiry: a user hammering the login form with the
    same expired temp password shouldn't create a new alert on every
    attempt. Re-arms once a fresh temp password is issued, since
    related_id encodes the expiry timestamp the alert was about."""
    related_id = f"{user.id}:{user.temp_password_expires_at.isoformat() if user.temp_password_expires_at else 'unknown'}"
    if alert_exists(db, category=AlertType.TEMP_PASSWORD_EXPIRED.value, related_id=related_id):
        return None
    return create_alert(
        db,
        alert_type=AlertType.TEMP_PASSWORD_EXPIRED,
        title=f"Temp password expired unused: {user.email}",
        message=f"{user.email}'s temporary password expired before first login. They'll need a resend.",
        related_type="user",
        related_id=related_id,
        notify_email=False,  # informational; doesn't need to interrupt an admin's inbox
    )


def notify_forced_reset_completed(db: Session, user: User) -> Alert:
    return create_alert(
        db,
        alert_type=AlertType.FORCED_RESET_COMPLETED,
        title="Password reset complete",
        message="Your temporary password has been replaced. You're now signed in normally.",
        target_user_id=user.id,
        related_type="user",
        related_id=str(user.id),
        notify_email=False,  # same-request confirmation; see registry notes
    )


def notify_user_deactivated_or_reactivated(db: Session, user: User, is_active: bool) -> Alert:
    alert_type = AlertType.USER_REACTIVATED if is_active else AlertType.USER_DEACTIVATED
    verb = "reactivated" if is_active else "deactivated"
    return create_alert(
        db,
        alert_type=alert_type,
        title=f"Your account was {verb}",
        message=f"An administrator {verb} your account.",
        target_user_id=user.id,
        related_type="user",
        related_id=str(user.id),
    )


def notify_role_changed(db: Session, user: User, new_role: str) -> Alert:
    return create_alert(
        db,
        alert_type=AlertType.ROLE_CHANGED,
        title="Your role was changed",
        message=f"Your role has been changed to {new_role}. Your available features may have changed.",
        target_user_id=user.id,
        related_type="user",
        related_id=str(user.id),
    )


# ============================================================================
# AUDIT / ADMIN TRIGGERS
# ============================================================================

def notify_admin_sensitive_action(db: Session, action: str, summary: str, actor_user_id, target_id: Optional[str] = None) -> Alert:
    """Four-eyes visibility: every OTHER system_admin, not the one who did it."""
    return create_alert(
        db,
        alert_type=AlertType.ADMIN_SENSITIVE_ACTION,
        title=f"Admin action: {action}",
        message=summary,
        related_type="user",
        related_id=target_id,
        created_by_user_id=actor_user_id,
        exclude_user_id=actor_user_id,
    )


def notify_bulk_export(db: Session, actor_user_id, row_count: int) -> Alert:
    return create_alert(
        db,
        alert_type=AlertType.BULK_EXPORT,
        title=f"Bulk export performed ({row_count} anomaly rows)",
        message=f"A reconciliation report was exported ({row_count} anomaly rows).",
        created_by_user_id=actor_user_id,
        notify_email=False,
    )


# ============================================================================
# READ / LIST (in-app inbox)
# ============================================================================

def _recent_alerts(db: Session):
    return db.query(Alert).order_by(Alert.created_at.desc()).limit(_VISIBILITY_SCAN_LIMIT).all()


def list_alerts_for_user(
    db: Session,
    user: User,
    unread_only: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Alert], int, int]:
    perm_codes = set(user.permission_codes())
    role_names = {r.name for r in user.roles}
    read_ids = {row[0] for row in db.query(AlertRead.alert_id).filter(AlertRead.user_id == user.id).all()}

    visible = [a for a in _recent_alerts(db) if _user_can_see(a, perm_codes, role_names, user.id)]
    unread_count = sum(1 for a in visible if a.id not in read_ids)

    if unread_only:
        visible = [a for a in visible if a.id not in read_ids]

    total = len(visible)
    start = (page - 1) * page_size
    page_items = visible[start:start + page_size]
    for a in page_items:
        a.is_read = a.id in read_ids
    return page_items, total, unread_count


def get_unread_count(db: Session, user: User) -> int:
    perm_codes = set(user.permission_codes())
    role_names = {r.name for r in user.roles}
    read_ids = {row[0] for row in db.query(AlertRead.alert_id).filter(AlertRead.user_id == user.id).all()}
    return sum(
        1
        for a in _recent_alerts(db)
        if _user_can_see(a, perm_codes, role_names, user.id) and a.id not in read_ids
    )


def mark_alert_read(db: Session, alert_id: str, user_id) -> bool:
    aid = _coerce_uuid(alert_id)
    if aid is None:
        raise ValueError(f"No alert with id: {alert_id}")
    existing = db.query(AlertRead).filter(AlertRead.alert_id == aid, AlertRead.user_id == user_id).first()
    if existing is not None:
        return False
    db.add(AlertRead(alert_id=aid, user_id=user_id))
    db.flush()
    return True


def mark_all_read(db: Session, user: User) -> int:
    perm_codes = set(user.permission_codes())
    role_names = {r.name for r in user.roles}
    read_ids = {row[0] for row in db.query(AlertRead.alert_id).filter(AlertRead.user_id == user.id).all()}
    unread = [
        a
        for a in _recent_alerts(db)
        if _user_can_see(a, perm_codes, role_names, user.id) and a.id not in read_ids
    ]
    for a in unread:
        db.add(AlertRead(alert_id=a.id, user_id=user.id))
    if unread:
        db.flush()
    return len(unread)
