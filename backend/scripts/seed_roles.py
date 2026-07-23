"""
Seeds the 3 roles named in your README (Depot Supervisor, Manager, Revenue
Assurance) and a starter permission set.

*** The permission-to-role mapping below is a PLACEHOLDER guess based only on
the role names — I don't have your actual README permission matrix text.
Edit ROLE_PERMISSIONS to match it before running this against real data. ***

Run with (from backend/, same as etl_pipeline.py):
    python scripts/seed_roles.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.user import Permission, Role
from app.utils.db_connection import SessionLocal

PERMISSIONS = [
    ("view_dashboard", "View reconciliation dashboard"),
    ("upload_csv", "Upload dispatch/invoice/payment CSVs"),
    ("resolve_anomaly", "Resolve/review/assign anomalies"),
    ("view_audit", "View audit trail"),
    ("manage_ebilling", "Trigger/retry e-billing sync"),
    ("export_reports", "Export Excel/CSV reports"),
    ("view_fraud_graph", "View fraud/graph detection view"),
    ("manage_users", "Create, edit, deactivate users and assign roles to them"),
    ("manage_permissions", "Create/edit permissions and assign them to roles"),
]

# PLACEHOLDER — replace with your actual matrix.
# system_admin is scoped ONLY to user/permission control, not revenue-assurance
# features — per your instruction that "his work is user control".
ROLE_PERMISSIONS = {
    "system_admin": ["manage_users", "manage_permissions"],
    "depot_supervisor": ["view_dashboard", "upload_csv"],
    "manager": ["view_dashboard", "upload_csv", "resolve_anomaly", "export_reports"],
    "revenue_assurance": [
        "view_dashboard",
        "upload_csv",
        "resolve_anomaly",
        "view_audit",
        "manage_ebilling",
        "export_reports",
        "view_fraud_graph",
    ],
}

ROLE_DESCRIPTIONS = {
    "system_admin": "System Admin",
    "depot_supervisor": "Depot Supervisor",
    "manager": "Manager",
    "revenue_assurance": "Revenue Assurance",
}


def seed():
    db = SessionLocal()
    try:
        perm_objs = {}
        for code, desc in PERMISSIONS:
            perm = db.query(Permission).filter(Permission.code == code).first()
            if not perm:
                perm = Permission(code=code, description=desc)
                db.add(perm)
                db.flush()
            perm_objs[code] = perm

        for role_name, perm_codes in ROLE_PERMISSIONS.items():
            role = db.query(Role).filter(Role.name == role_name).first()
            if not role:
                role = Role(name=role_name, description=ROLE_DESCRIPTIONS[role_name])
                db.add(role)
                db.flush()
            role.permissions = [perm_objs[c] for c in perm_codes]

        db.commit()
        print("Seeded roles and permissions.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
