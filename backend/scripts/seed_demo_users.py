"""
Seeds one demo login per role, with well-known credentials, so anyone who
clones this repo and runs the local setup (see README's Quick Start) gets a
working login immediately — without asking a teammate for credentials.

These are throwaway local-dev accounts, not real secrets: the password is
the same across all four on purpose. Never point this at a real deployment.

Idempotent AND self-healing: if an account already exists (e.g. from an
earlier run, or created with a different password at some point), this
resets its password/role/full_name back to the documented values rather
than silently skipping it. Without this, a demo account that ever drifted
from DEMO_PASSWORD — for any reason — would stay broken forever, since
every later re-run would see "already exists" and leave it untouched.

Run with (from backend/, after alembic upgrade head + seed_roles.py):
    python scripts/seed_demo_users.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.password_policy import normalize_email
from app.core.security import hash_password
from app.models.auth.role import Role
from app.models.auth.user import User
from app.models.reconciliation.anomaly_resolution import AnomalyResolution
from app.utils.db_connection import SessionLocal
from datetime import datetime, timezone

DEMO_PASSWORD = "demo-pass-123"

# Fourth element is the depot assigned to the demo depot_supervisor — the
# one real value this scoping needs, since it drives every alert they see
# (see services/alert_scope.py). Null for every other role.
DEMO_USERS = [
    ("depot_supervisor@kpc-demo.co.ke", "Demo Depot Supervisor", "depot_supervisor", "Nairobi"),
    ("manager@kpc-demo.co.ke", "Demo Manager", "manager", None),
    ("revenue_assurance@kpc-demo.co.ke", "Demo Revenue Assurance", "revenue_assurance", None),
    ("system_admin@kpc-demo.co.ke", "Demo System Admin", "system_admin", None),
    # Outbound (stipend/disbursement) — Stage 2. Read-only, outbound-only —
    # see seed_roles.py's ROLE_PERMISSIONS comment.
    ("inuka_manager@kpc-demo.co.ke", "Demo Inuka Manager", "inuka_manager", None),
    # Mobile app demo user aliases:
    ("manager@kpc.co.ke", "KPC Revenue Manager", "manager", None),
    ("inspector@kpc.co.ke", "Gantry Field Inspector", "depot_supervisor", "Nairobi"),
    ("field.agent@kpc.co.ke", "Inuka Field Verification Agent", "revenue_assurance", None),
]


def seed():
    db = SessionLocal()
    try:
        for email, full_name, role_name, depot_id in DEMO_USERS:
            email = normalize_email(email)
            user = db.query(User).filter(User.email == email).first()
            role = db.query(Role).filter(Role.name == role_name).first()
            if role is None:
                raise RuntimeError(f"Role {role_name!r} is not seeded")
            if user is None:
                user = User(
                    email=email,
                    full_name=full_name,
                    hashed_password=hash_password(DEMO_PASSWORD),
                    roles=[role],
                )
                db.add(user)
                db.flush()
                print(f"Created {email} ({role_name})")
            user.hashed_password = hash_password(DEMO_PASSWORD)
            user.full_name = full_name
            user.is_active = True
            user.depot_id = depot_id
            # Demo accounts are intentionally direct-login accounts for hackathon demos.
            # Admin-provisioned real users still follow the forced-reset flow.
            user.must_reset_password = False
            user.temp_password_expires_at = None
            if role:
                user.roles = [role]
            db.commit()
            print(f"Reset password/role/depot: {email}")
    finally:
        db.close()

    # Give the Revenue Assurance demo account a small, stable working set.
    # This is intentionally best-effort: a fresh identity-only database may
    # not have ETL tables yet, but user seeding must still succeed.
    db = SessionLocal()
    try:
        ra = db.query(User).filter(User.email == "revenue_assurance@kpc-demo.co.ke").first()
        if ra:
            try:
                from app.services.reconciliation.reconciliation import run_combined_reconciliation
                cases = run_combined_reconciliation(direction="inbound", materiality=0).get("anomalies", [])
                open_cases = [c for c in cases if c.get("status") != "Reconciled"][:25]
                now = datetime.now(timezone.utc)
                for case in open_cases:
                    dispatch_id = case.get("dispatch_id")
                    if not dispatch_id:
                        continue
                    state = db.query(AnomalyResolution).filter(AnomalyResolution.dispatch_id == dispatch_id).first()
                    if state is None:
                        db.add(AnomalyResolution(dispatch_id=dispatch_id, status="Assigned", assigned_to_user_id=ra.id, assigned_at=now, updated_at=now))
                    elif state.assigned_to_user_id is None and not state.escalated:
                        state.assigned_to_user_id = ra.id
                        state.assigned_at = now
                        state.updated_at = now
                db.commit()
                print(f"Seeded {len(open_cases)} Revenue Assurance review assignments")
            except Exception as assignment_err:
                db.rollback()
                print(f"Skipped review assignments (data may not be loaded yet): {assignment_err}")
    finally:
        db.close()

    print(f"\nDemo login password (all {len(DEMO_USERS)} accounts): {DEMO_PASSWORD}")


if __name__ == "__main__":
    seed()
