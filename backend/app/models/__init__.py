from app.models.audit_log import AuditLog
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
from app.models.user import User
from app.models.role import Role
from app.models.permission import Permission
from app.models.omc import OMC
from app.models.quota_ledger import QuotaLedger
from app.models.depot import Depot
from app.models.product import Product
from app.models.dispatch import Dispatch
from app.models.invoice import Invoice
from app.models.payment import Payment
from app.models.depot_ledger import DepotLedger
from app.models.anomaly_resolution import AnomalyResolution

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
]
