"""
QuotaLedger model — lightweight per-OMC quota tracking, laying the
groundwork for future quota-drift/breach detection.

Deliberately minimal: one row per OMC, updated periodically (not an event
log), just enough state to eventually compute "is this OMC's entitlement
growing faster than their invoiced/paid volume." No service, route, or
recalculation job reads/writes this yet — the computation logic behind
"the proposed monitoring approach" wasn't specified, so only the schema
exists so far. Treat this the same as audit.py/transactions.py: a real
table, no behavior built on it yet.

Unlike omc.py/depot.py/dispatch.py/etc. (synthetic data owned by
scripts/etl_pipeline.py's pandas .to_sql(if_exists='replace')), this table
is NOT excluded from Alembic — there's no generator producing quota data,
and "updated periodically" describes ongoing application state, the same
category as anomaly_resolutions and users/roles/permissions, not a
bulk-replaced synthetic table. See alembic/env.py's
NOT_ALEMBIC_MANAGED_TABLES if that assumption changes.

omc_id is deliberately NOT a ForeignKey, even though it conceptually
belongs to one OMC — same reasoning as anomaly_resolution.py's dispatch_id:
omcs is owned by etl_pipeline.py's to_sql(if_exists='replace'), which drops
and recreates that table every run. A live FK from an Alembic-managed table
back to an ETL-dropped one would make every future ETL run fail outright
(Postgres blocks DROP TABLE while something still references it, and
to_sql doesn't use CASCADE). The trade-off is the same as
anomaly_resolutions: no DB-level referential integrity, so this can
reference an omc_id that no longer exists after an ETL re-run.

No ORM relationship() to OMC either, for the same reason
anomaly_resolution.py has none to Dispatch — relationship() needs a real
FK (or an explicit primaryjoin) to know how to join; without one, look up
by omc_id manually if you need the OMC row.
"""
from sqlalchemy import Column, DateTime, Integer, Text

from app.utils.db_connection import Base


class QuotaLedger(Base):
    __tablename__ = "quota_ledger"

    omc_id = Column(Text, primary_key=True)
    base_quota_litres = Column(Integer)
    current_quota_litres = Column(Integer)  # base_quota + trailing-offtake adjustment
    trailing_window_days = Column(Integer, default=30)
    last_recalculated_at = Column(DateTime)
