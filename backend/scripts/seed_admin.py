"""
Seeds the first system_admin user directly into the DB, bypassing the API
entirely — the only way to bootstrap one, since POST /api/auth/register is
gated behind require_permission("manage_users") and nothing exists yet to
grant that permission to anyone.

Credentials must be supplied through BOOTSTRAP_ADMIN_EMAIL and
BOOTSTRAP_ADMIN_PASSWORD. Existing accounts are never reset.

Run with (from backend/, same as seed_roles.py — run that first, this
script depends on the system_admin role already existing):
    python scripts/seed_admin.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.security import hash_password
from app.models.auth.role import Role
from app.models.auth.user import User
from app.utils.db_connection import SessionLocal

ADMIN_EMAIL = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
ADMIN_FULL_NAME = "Admin"


def seed():
    if not ADMIN_EMAIL or len(ADMIN_PASSWORD) < 12:
        raise RuntimeError("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters)")
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
        if existing:
            print(f"Admin user '{ADMIN_EMAIL}' already exists — nothing to do.")
            return

        role = db.query(Role).filter(Role.name == "system_admin").first()
        if not role:
            raise RuntimeError("system_admin role not found — run scripts/seed_roles.py first.")

        user = User(
            email=ADMIN_EMAIL,
            full_name=ADMIN_FULL_NAME,
            hashed_password=hash_password(ADMIN_PASSWORD),
            roles=[role],
        )
        db.add(user)
        db.commit()
        print(f"Seeded admin user: {ADMIN_EMAIL}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
