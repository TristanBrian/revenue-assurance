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

from app.core.security import hash_password
from app.models.role import Role
from app.models.user import User
from app.services.user_service import EmailAlreadyRegisteredError, register_user
from app.utils.db_connection import SessionLocal

DEMO_PASSWORD = "demo-pass-123"

DEMO_USERS = [
    ("depot_supervisor@kpc-demo.co.ke", "Demo Depot Supervisor", "depot_supervisor"),
    ("manager@kpc-demo.co.ke", "Demo Manager", "manager"),
    ("revenue_assurance@kpc-demo.co.ke", "Demo Revenue Assurance", "revenue_assurance"),
    ("system_admin@kpc-demo.co.ke", "Demo System Admin", "system_admin"),
]


def seed():
    db = SessionLocal()
    try:
        for email, full_name, role_name in DEMO_USERS:
            try:
                register_user(db, email=email, password=DEMO_PASSWORD, full_name=full_name, role_name=role_name)
                print(f"Created {email} ({role_name})")
            except EmailAlreadyRegisteredError:
                user = db.query(User).filter(User.email == email).first()
                role = db.query(Role).filter(Role.name == role_name).first()
                user.hashed_password = hash_password(DEMO_PASSWORD)
                user.full_name = full_name
                user.is_active = True
                if role:
                    user.roles = [role]
                db.commit()
                print(f"Already existed — reset password/role: {email}")
    finally:
        db.close()

    print(f"\nDemo login password (all 4 accounts): {DEMO_PASSWORD}")


if __name__ == "__main__":
    seed()
