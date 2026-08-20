"""
Tests for services/alert_service.py + services/alert_types.py.

Uses an in-memory SQLite engine bound to the real ORM Base, same convention
as test_audit_service.py — Alert/AlertRead need Role/Permission/User too
(for permission/role-based visibility), so this fixture creates that whole
cluster rather than a single table.

No SMTP env vars are set in this test environment, so app.core.email.send_email()
is_configured() is False and every create/notify call below exercises the
"email skipped, in-app row still created" path.

Run with: pytest tests/test_alert_service.py -v
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.alert import Alert  # noqa: E402
from app.models.alert_read import AlertRead  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.role import Role  # noqa: E402
from app.models.permission import Permission  # noqa: E402
from app.models.associations import user_roles, role_permissions  # noqa: E402
from app.utils.db_connection import Base  # noqa: E402
from app.services.alert_types import REGISTRY, AlertTier, AlertType  # noqa: E402
from app.services.alert_service import (  # noqa: E402
    alert_exists,
    create_alert,
    get_unread_count,
    list_alerts_for_user,
    mark_all_read,
    mark_alert_read,
    notify_admin_sensitive_action,
    notify_anomaly_reopened,
    notify_critical_anomalies,
    notify_data_quality_drop,
    notify_duplicate_spike,
    notify_ebilling_dlq,
    notify_ebilling_failure_rate,
    notify_fraud_clusters,
    notify_materiality_spike,
    notify_omc_risk_escalation,
    notify_repeated_resolve_reopen,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__, Role.__table__, Permission.__table__,
            user_roles, role_permissions, Alert.__table__, AlertRead.__table__, AuditLog.__table__,
        ],
    )
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _make_user(db, email, permission_codes=(), role_name=None):
    name = role_name or f"role-{email}"
    role = db.query(Role).filter(Role.name == name).first()
    if role is None:
        perms = []
        for code in permission_codes:
            p = db.query(Permission).filter(Permission.code == code).first()
            if p is None:
                p = Permission(code=code, description=code)
                db.add(p)
            perms.append(p)
        role = Role(name=name, permissions=perms)
        db.add(role)
    user = User(email=email, hashed_password="x", is_active=True, roles=[role])
    db.add(user)
    db.commit()
    return user


# ============================================================================
# Registry sanity
# ============================================================================

def test_every_alert_type_has_registry_metadata():
    for t in AlertType:
        assert t in REGISTRY, f"{t} has no AlertMeta"


# Alert types that are inherently personal — their notify_* function
# always supplies target_user_id at call time, so having no
# target_permissions/target_roles in the registry itself is correct, not
# an oversight.
_PERSONAL_ALERT_TYPES = {
    AlertType.FORCED_RESET_COMPLETED,
    AlertType.TEMP_PASSWORD_EXPIRING_SOON,
    AlertType.PASSWORD_CHANGED_SELF_SERVICE,
    AlertType.USER_DEACTIVATED,
    AlertType.USER_REACTIVATED,
    AlertType.ROLE_CHANGED,
}


def test_every_registry_entry_has_a_valid_audience_or_is_deliberately_broad():
    for alert_type, meta in REGISTRY.items():
        assert isinstance(meta.tier, AlertTier)
        assert meta.severity in ("info", "warning", "critical")
        if not meta.target_permissions and not meta.target_roles:
            assert alert_type == AlertType.USER_PROVISIONED or alert_type in _PERSONAL_ALERT_TYPES, (
                f"{alert_type} has no target_permissions/target_roles and isn't a documented exception"
            )


# ============================================================================
# create_alert / alert_exists — registry-driven
# ============================================================================

def test_create_alert_with_alert_type_pulls_tier_and_audience_from_registry(db):
    alert = create_alert(
        db,
        alert_type=AlertType.CRITICAL_ANOMALY,
        title="Test",
        message="Something happened",
        related_type="dispatch",
        related_id="DISP-1",
    )
    db.commit()

    assert alert.category == "critical_anomaly"
    assert alert.tier == "digested"
    assert alert.severity == "critical"
    assert alert.target_permissions == ["view_anomaly_table"]
    assert alert.email_sent is False  # no SMTP configured in test env


def test_create_alert_manual_broadcast_without_alert_type(db):
    alert = create_alert(
        db,
        title="Manual",
        message="Announcement",
        category="manual",
        target_roles=["system_admin"],
    )
    db.commit()
    assert alert.category == "manual"
    assert alert.tier == "immediate"
    assert alert.target_roles == ["system_admin"]


def test_create_alert_does_not_commit(db):
    create_alert(db, title="t", message="m", notify_email=False)
    db.rollback()
    assert db.query(Alert).count() == 0


def test_alert_exists_dedup(db):
    assert alert_exists(db, category="critical_anomaly", related_id="DISP-1") is False
    create_alert(
        db, title="t", message="m", category="critical_anomaly",
        related_type="dispatch", related_id="DISP-1", notify_email=False,
    )
    db.commit()
    assert alert_exists(db, category="critical_anomaly", related_id="DISP-1") is True
    assert alert_exists(db, category="critical_anomaly", related_id="DISP-2") is False


# ============================================================================
# notify_critical_anomalies
# ============================================================================

def test_notify_critical_anomalies_creates_one_row_per_new_critical(db):
    anomalies = [
        {"dispatch_id": "DISP-1", "status": "Critical", "break_type": "Missing Invoice",
         "customer": "OMC A", "leakage_kes": 500000},
        {"dispatch_id": "DISP-2", "status": "Critical", "break_type": "Missing Payment",
         "customer": "OMC B", "leakage_kes": 200000},
        {"dispatch_id": "DISP-3", "status": "Pending", "break_type": "Underpayment",
         "customer": "OMC C", "leakage_kes": 100},  # not critical — skipped
    ]
    created = notify_critical_anomalies(db, anomalies)
    db.commit()

    assert len(created) == 2
    assert {a.related_id for a in created} == {"DISP-1", "DISP-2"}
    assert all(a.category == "critical_anomaly" for a in created)
    assert all(a.target_permissions == ["view_anomaly_table"] for a in created)


def test_notify_critical_anomalies_is_idempotent(db):
    anomalies = [{"dispatch_id": "DISP-1", "status": "Critical", "break_type": "Missing Invoice",
                  "customer": "OMC A", "leakage_kes": 500000}]
    first = notify_critical_anomalies(db, anomalies)
    db.commit()
    assert len(first) == 1

    second = notify_critical_anomalies(db, anomalies)
    db.commit()
    assert second == []
    assert db.query(Alert).filter(Alert.category == "critical_anomaly").count() == 1


# ============================================================================
# New reconciliation triggers
# ============================================================================

def test_notify_materiality_spike_only_fires_above_multiplier(db):
    anomalies = [
        {"dispatch_id": "DISP-1", "leakage_kes": 600000},  # 6x materiality (100k) — fires
        {"dispatch_id": "DISP-2", "leakage_kes": 150000},  # 1.5x — doesn't fire
    ]
    created = notify_materiality_spike(db, anomalies, materiality=100000)
    db.commit()
    assert {a.related_id for a in created} == {"DISP-1"}
    assert created[0].category == "anomaly_materiality_spike"
    assert created[0].target_roles == ["system_admin"]


def test_notify_omc_risk_escalation_fires_once_per_omc(db):
    profile = [{"customer": "OMC A", "risk_level": "High", "leakage_kes": 2000000, "anomaly_count": 5}]
    first = notify_omc_risk_escalation(db, profile)
    db.commit()
    assert len(first) == 1

    second = notify_omc_risk_escalation(db, profile)
    db.commit()
    assert second == []  # already alerted for OMC A


def test_notify_data_quality_drop_below_threshold(db):
    alert = notify_data_quality_drop(db, {"quality_score": 40.0, "null_volume": 5})
    db.commit()
    assert alert is not None
    assert alert.category == "data_quality_drop"

    ok = notify_data_quality_drop(db, {"quality_score": 95.0})
    assert ok is None


def test_notify_duplicate_spike_above_threshold(db):
    dups = [{"column": "dispatch_id", "label": "Dispatch ID", "duplicate_count": 200}]
    created = notify_duplicate_spike(db, dups)
    db.commit()
    assert len(created) == 1
    assert created[0].related_id == "dispatch_id"

    below_threshold = notify_duplicate_spike(db, [{"column": "x", "label": "x", "duplicate_count": 3}])
    assert below_threshold == []


def test_notify_anomaly_reopened_only_when_previously_resolved(db):
    fired = notify_anomaly_reopened(db, "DISP-1", before_status="Resolved", new_status="Pending")
    assert fired is not None
    assert fired.category == "anomaly_reopened"

    not_fired = notify_anomaly_reopened(db, "DISP-2", before_status="Pending", new_status="Critical")
    assert not_fired is None

    not_fired_2 = notify_anomaly_reopened(db, "DISP-3", before_status="Resolved", new_status="Resolved")
    assert not_fired_2 is None


def test_notify_repeated_resolve_reopen_threshold(db):
    below = notify_repeated_resolve_reopen(db, "DISP-1", actor_user_id=None, change_count=2)
    assert below is None

    fired = notify_repeated_resolve_reopen(db, "DISP-1", actor_user_id=None, change_count=3)
    db.commit()
    assert fired is not None

    # Throttled — same dispatch, still within the window.
    again = notify_repeated_resolve_reopen(db, "DISP-1", actor_user_id=None, change_count=4)
    assert again is None


# ============================================================================
# Fraud clusters
# ============================================================================

def test_notify_fraud_clusters_new_high_risk_only(db):
    communities = [
        {"node_ids": ["OMC-1", "OMC-2"], "risk_level": "High", "member_count": 2, "total_leakage_kes": 1000000},
        {"node_ids": ["OMC-3"], "risk_level": "Medium", "member_count": 1, "total_leakage_kes": 50000},
    ]
    created = notify_fraud_clusters(db, communities)
    db.commit()
    assert len(created) == 1
    assert created[0].category == "fraud_cluster_new"
    assert created[0].target_permissions == ["view_fraud_graph"]

    # Same cluster (same OMC set) doesn't re-alert.
    again = notify_fraud_clusters(db, communities)
    assert again == []


# ============================================================================
# E-billing triggers
# ============================================================================

def test_notify_ebilling_dlq_dedup(db):
    first = notify_ebilling_dlq(db, "INV-1", "timeout")
    db.commit()
    assert first is not None
    second = notify_ebilling_dlq(db, "INV-1", "timeout again")
    assert second is None


def test_notify_ebilling_failure_rate_breach_and_recovery(db):
    breach = notify_ebilling_failure_rate(db, failure_rate=25.0, threshold=10.0)
    db.commit()
    assert breach is not None
    assert breach.category == "ebilling_failure_rate_breach"
    assert breach.target_permissions == ["manage_ebilling"]
    assert breach.target_roles == ["system_admin"]

    throttled = notify_ebilling_failure_rate(db, failure_rate=30.0, threshold=10.0)
    assert throttled is None

    recovery = notify_ebilling_failure_rate(db, failure_rate=5.0, threshold=10.0)
    db.commit()
    assert recovery is not None
    assert recovery.category == "ebilling_failure_rate_recovered"

    # Healthy again with no prior breach in effect — no new alert.
    still_healthy = notify_ebilling_failure_rate(db, failure_rate=5.0, threshold=10.0)
    assert still_healthy is None


def test_notify_ebilling_failure_rate_throttle_expires(db):
    first = notify_ebilling_failure_rate(db, failure_rate=25.0, threshold=10.0)
    db.commit()
    first.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    db.commit()
    second = notify_ebilling_failure_rate(db, failure_rate=30.0, threshold=10.0)
    db.commit()
    assert second is not None


# ============================================================================
# Four-eyes admin visibility
# ============================================================================

def test_notify_admin_sensitive_action_excludes_the_acting_admin(db):
    acting_admin = _make_user(db, "acting@kpc-demo.co.ke", role_name="system_admin")
    other_admin = _make_user(db, "other@kpc-demo.co.ke", role_name="system_admin")

    notify_admin_sensitive_action(
        db, action="user created", summary="x was created.", actor_user_id=acting_admin.id, target_id="x",
    )
    db.commit()

    items, total, _ = list_alerts_for_user(db, other_admin)
    assert total == 1

    items, total, _ = list_alerts_for_user(db, acting_admin)
    assert total == 0  # excluded — this is what "four-eyes" means


# ============================================================================
# Visibility / inbox — plural targeting
# ============================================================================

def test_list_alerts_for_user_filters_by_target_permissions(db):
    viewer = _make_user(db, "viewer@kpc-demo.co.ke", permission_codes=["resolve_anomaly"])
    outsider = _make_user(db, "outsider@kpc-demo.co.ke", permission_codes=["view_metrics"])

    create_alert(db, title="For resolvers", message="m", target_permissions=["resolve_anomaly"], notify_email=False)
    db.commit()

    _, total, unread = list_alerts_for_user(db, viewer)
    assert total == 1
    assert unread == 1

    _, total, unread = list_alerts_for_user(db, outsider)
    assert total == 0
    assert unread == 0


def test_list_alerts_for_user_filters_by_target_roles(db):
    admin = _make_user(db, "admin@kpc-demo.co.ke", role_name="system_admin")
    manager = _make_user(db, "manager@kpc-demo.co.ke", role_name="manager")

    create_alert(db, title="Ops", message="m", target_roles=["system_admin"], notify_email=False)
    db.commit()

    _, total, _ = list_alerts_for_user(db, admin)
    assert total == 1
    _, total, _ = list_alerts_for_user(db, manager)
    assert total == 0


def test_list_alerts_for_user_includes_direct_target(db):
    viewer = _make_user(db, "viewer2@kpc-demo.co.ke")
    other = _make_user(db, "other2@kpc-demo.co.ke")

    create_alert(db, title="Just for viewer", message="m", target_user_id=viewer.id, notify_email=False)
    db.commit()

    _, total, _ = list_alerts_for_user(db, viewer)
    assert total == 1
    _, total, _ = list_alerts_for_user(db, other)
    assert total == 0


def test_mark_alert_read_and_unread_count(db):
    viewer = _make_user(db, "viewer3@kpc-demo.co.ke", permission_codes=["resolve_anomaly"])
    a1 = create_alert(db, title="A1", message="m", target_permissions=["resolve_anomaly"], notify_email=False)
    create_alert(db, title="A2", message="m", target_permissions=["resolve_anomaly"], notify_email=False)
    db.commit()

    assert get_unread_count(db, viewer) == 2

    newly = mark_alert_read(db, str(a1.id), viewer.id)
    db.commit()
    assert newly is True
    assert get_unread_count(db, viewer) == 1

    newly_again = mark_alert_read(db, str(a1.id), viewer.id)
    db.commit()
    assert newly_again is False
    assert get_unread_count(db, viewer) == 1

    count = mark_all_read(db, viewer)
    db.commit()
    assert count == 1
    assert get_unread_count(db, viewer) == 0


def test_mark_alert_read_unknown_id_raises(db):
    viewer = _make_user(db, "viewer4@kpc-demo.co.ke")
    with pytest.raises(ValueError):
        mark_alert_read(db, "not-a-uuid", viewer.id)
