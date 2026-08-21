"""
Importing every model module here guarantees they're all registered on the
shared Base before SQLAlchemy configures any mapper. Each model's
relationship() targets are string names ("Role", "Dispatch", etc.) resolved
lazily against that shared registry — if only some of these files had ever
been imported, resolving a string naming a class from one of the others
would fail. Since importing any single app.models.* submodule already runs
this __init__.py first, that's enough to make the whole set safe regardless
of which one gets imported first elsewhere in the app.
"""
from app.models.auth.user import User
from app.models.auth.role import Role
from app.models.auth.permission import Permission
from app.models.reconciliation.omc import OMC
from app.models.reconciliation.quota_ledger import QuotaLedger
from app.models.reconciliation.depot import Depot
from app.models.reconciliation.product import Product
from app.models.reconciliation.dispatch import Dispatch
from app.models.reconciliation.invoice import Invoice
from app.models.reconciliation.payment import Payment
from app.models.reconciliation.depot_ledger import DepotLedger
from app.models.reconciliation.anomaly_resolution import AnomalyResolution
from app.models.audit.audit import AuditLog
from app.models.alerts.alert import Alert
from app.models.alerts.alert_read import AlertRead
from app.models.auth.terms_document import TermsDocument
from app.models.auth.consent_record import ConsentRecord

__all__ = [
    "User",
    "Role",
    "Permission",
    "OMC",
    "QuotaLedger",
    "Depot",
    "Product",
    "Dispatch",
    "Invoice",
    "Payment",
    "DepotLedger",
    "AnomalyResolution",
    "AuditLog",
    "Alert",
    "AlertRead",
    "TermsDocument",
    "ConsentRecord",
]
