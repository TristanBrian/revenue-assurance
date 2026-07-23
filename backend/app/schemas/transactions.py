"""
Schema stub for app/models/transactions.py — that model file is currently
EMPTY (no SQLAlchemy model defined), and no route or service anywhere
references a "transaction" concept distinct from the existing
dispatches/invoices/payments tables (which already have established shapes
via app/schemas/reconciliation.py's Anomaly, sourced from real dispatch/
invoice/payment CSV columns).

Unlike audit.py's AuditLog, there's no obvious minimal shape to infer here
— "transaction" isn't a name used anywhere else in this codebase with a
clear meaning, so inventing fields would be guessing, not inferring.

TODO: define schema(s) here once app/models/transactions.py has an actual
SQLAlchemy model and/or a route or service establishes what a
"transaction" is meant to represent in this domain.
"""
