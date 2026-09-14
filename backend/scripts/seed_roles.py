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

from app.models.auth.permission import Permission
from app.models.auth.role import Role
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
    ("view_audit", "View the audit trail (who did what, when)"),
    ("view_fraud_graph", "View fraud/graph detection view (structural/network analysis)"),
    ("view_risk_analytics", "View OMC risk features (statistical/EDA analysis, no graph concept)"),
    ("view_depot_alerts", "View critical alerts for the caller's own assigned depot only"),
    ("manage_users", "Create, edit, deactivate users and assign roles to them"),
    ("manage_permissions", "Create/edit permissions and assign them to roles"),
    ("manage_alerts", "Broadcast manual in-app/email alerts to a role or a specific user"),
    # --- Outbound (stipend/disbursement) — Stage 2 ---
    ("view_outgoing_data", "View outbound (stipend/disbursement) reconciliation data — gates access to direction=outbound/all on the existing reconcile/heatmap/fraud-graph/export endpoints"),
]

# Feature permission matrix:
#
# | Feature                | Depot Supervisor | Manager | Revenue Assurance | Inuka Manager |
# |-------------------------|:---:|:---:|:---:|:---:|
# | Live Feed                | Y | Y | Y | Y |
# | Upload CSV / Templates    | Y | N | Y | N |
# | Heatmap                  | N | Y | Y | Y |
# | OMC/Beneficiary Risk Profile | N | Y | Y | Y |
# | Executive Metrics         | Y | Y | Y | Y |
# | Anomaly Table             | N | Y | Y | Y |
# | Resolve/Review/Assign     | N | N | Y | N |
# | E-Billing Sync            | N | N | Y | N |
# | Export Reports            | N | Y | Y | Y |
# | Audit Trail               | N | Y | Y | N |
# | Fraud Graph               | N | N | Y | Y |
# | Outbound (stipend) data   | N | Y | Y | Y (outbound only) |
#
# Workspace scope is enforced on the server by enforce_reconciliation_scope
# and require_workspace_permission, and mirrored by frontend module policy.
# Depot supervisors are Oil-only. Inuka managers are Inuka-only and read-only.
# Manager and Revenue Assurance can switch datasets with view_outgoing_data.
# Only resolve_anomaly permits case mutations; only manage_ebilling permits billing.
# System administrators administer identities and permissions, not business data.
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
# | Audit Trail               | N | Y | Y |
# | Alerts                    | Own depot only | All | All |
#
# system_admin is scoped ONLY to user/permission control, not
# revenue-assurance features — including alerts, which it never sees.
# Depot Supervisor's alert visibility is scoped server-side to their own
# users.depot_id (view_anomaly_table stays N for them — this is a narrower,
# separate permission, not a backdoor into the full anomaly table).
ROLE_PERMISSIONS = {
    "system_admin": ["manage_users", "manage_permissions"],
    "depot_supervisor": [
        "view_live_feed",
        "upload_csv",
        "view_metrics",
        "view_depot_alerts",
    ],
    "manager": [
        "view_live_feed",
        "view_heatmap",
        "view_omc_risk_profile",
        "view_metrics",
        "view_anomaly_table",
        "export_reports",
        "view_audit",
        "manage_alerts",
        "view_outgoing_data",
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
        "view_audit",
        "manage_alerts",
        "view_outgoing_data",
    ],
    "inuka_manager": [
        "view_live_feed",
        "view_heatmap",
        "view_omc_risk_profile",
        "view_metrics",
        "view_anomaly_table",
        "export_reports",
        "view_fraud_graph",
        "view_outgoing_data",
    ],
}

ROLE_DESCRIPTIONS = {
    "system_admin": "System Admin",
    "depot_supervisor": "Depot Supervisor",
    "manager": "Manager",
    "revenue_assurance": "Revenue Assurance",
    "inuka_manager": "Inuka Manager",
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
