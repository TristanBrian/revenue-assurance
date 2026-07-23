"""
Seeds the 3 roles named in the README (Depot Supervisor, Manager, Revenue
Assurance) plus system_admin, and the full permission set backing the
feature permission matrix.

Run with (from backend/, same as etl_pipeline.py):
    python scripts/seed_roles.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.permission import Permission
from app.models.role import Role
from app.utils.db_connection import SessionLocal

PERMISSIONS = [
    ("view_live_feed", "View the live anomaly feed"),
    ("upload_csv", "Upload dispatch/invoice/payment CSVs, and download CSV templates"),
    ("view_heatmap", "View the OMC x Product leakage heatmap"),
    ("view_omc_risk_profile", "View the OMC risk profile drill-down"),
    ("view_metrics", "View executive/summary reconciliation metrics"),
    ("view_anomaly_table", "View the full anomaly table"),
    ("resolve_anomaly", "Resolve/review/assign anomalies"),
    ("manage_ebilling", "Trigger/retry e-billing sync, view sync logs and monitoring"),
    ("export_reports", "Export Excel/CSV reports"),
    ("view_fraud_graph", "View fraud/graph detection view (structural/network analysis)"),
    ("view_risk_analytics", "View OMC risk features (statistical/EDA analysis, no graph concept)"),
    ("manage_users", "Create, edit, deactivate users and assign roles to them"),
    ("manage_permissions", "Create/edit permissions and assign them to roles"),
]

# Feature permission matrix:
#
# | Feature                | Depot Supervisor | Manager | Revenue Assurance |
# |-------------------------|:---:|:---:|:---:|
# | Live Feed                | Y | Y | Y |
# | Upload CSV / Templates    | Y | N | Y |
# | Heatmap                  | N | Y | Y |
# | OMC Risk Profile          | N | Y | Y |
# | Executive Metrics         | Y | Y | Y |
# | Anomaly Table             | N | Y | Y |
# | Resolve/Review/Assign     | N | N | Y |
# | E-Billing Sync            | N | N | Y |
# | Export Reports            | N | Y | Y |
#
# system_admin is scoped ONLY to user/permission control, not
# revenue-assurance features.
ROLE_PERMISSIONS = {
    "system_admin": ["manage_users", "manage_permissions"],
    "depot_supervisor": [
        "view_live_feed",
        "upload_csv",
        "view_metrics",
    ],
    "manager": [
        "view_live_feed",
        "view_heatmap",
        "view_omc_risk_profile",
        "view_metrics",
        "view_anomaly_table",
        "export_reports",
    ],
    "revenue_assurance": [
        "view_live_feed",
        "upload_csv",
        "view_heatmap",
        "view_omc_risk_profile",
        "view_metrics",
        "view_anomaly_table",
        "resolve_anomaly",
        "manage_ebilling",
        "export_reports",
        "view_fraud_graph",
        "view_risk_analytics",
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
