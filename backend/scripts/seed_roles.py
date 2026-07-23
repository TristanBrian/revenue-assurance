"""
Seeds the 3 roles named in your README (Depot Supervisor, Manager, Revenue
Assurance) plus system_admin, and the permission set matching the README's
Permission Mapping table.

Rows where every role matches (Live Feed, Executive Metrics) need no
permission at all — those are just "any logged-in user" in
app/core/dependencies.py, not gated by require_permission(). Fraud Graph
isn't in the original README matrix (added after it was written); placed
at Manager+Revenue Assurance here (same pattern as Heatmap/OMC Risk
Profile) — revisit if it should be Revenue-Assurance-only instead.

Run with (from backend/, same as etl_pipeline.py):
    python scripts/seed_roles.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.role import Role
from app.models.permission import Permission
from app.utils.db_connection import SessionLocal

PERMISSIONS = [
    ("upload_csv", "Upload dispatch/invoice/payment CSVs, download templates"),
    ("view_heatmap", "View OMC x Product leakage heatmap"),
    ("view_risk_profile", "View OMC risk profile"),
    ("view_anomalies", "View the anomaly table (line-item leakage detail)"),
    ("view_audit", "View audit trail"),
    ("export_reports", "Export Excel/CSV reports"),
    ("resolve_anomaly", "Resolve/review/assign anomalies"),
    ("manage_ebilling", "Trigger/retry e-billing sync, view sync logs"),
    ("view_fraud_graph", "View the OMC<->depot fraud/leakage graph"),
    ("manage_users", "Create, edit, deactivate users and assign roles to them"),
    ("manage_permissions", "Create/edit permissions and assign them to roles"),
]

# Matches README.md's Permission Mapping table exactly (grouped by identical
# role pattern): system_admin is scoped ONLY to user/permission control, not
# revenue-assurance features.
ROLE_PERMISSIONS = {
    "system_admin": ["manage_users", "manage_permissions"],
    "depot_supervisor": ["upload_csv"],
    "manager": [
        "view_heatmap",
        "view_risk_profile",
        "view_anomalies",
        "view_audit",
        "export_reports",
        "view_fraud_graph",
    ],
    "revenue_assurance": [
        "upload_csv",
        "view_heatmap",
        "view_risk_profile",
        "view_anomalies",
        "view_audit",
        "export_reports",
        "resolve_anomaly",
        "manage_ebilling",
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
