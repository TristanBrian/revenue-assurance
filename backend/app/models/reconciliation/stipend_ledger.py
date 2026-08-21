"""
StipendLedger model — running balance per beneficiary/pillar (outbound
domain equivalent of depot_ledger.py/quota_ledger.py). Declared per the
Stage 2 spec ("mirrors depot_ledger.py/quota_ledger.py"), and deliberately
in the SAME state those two are already in: no service, route, seed, or
ETL step reads or writes it yet. Not wired to anything — a real running-
balance feature (cumulative eligible vs. authorized vs. disbursed per
beneficiary/pillar over time) is a reasonable follow-up, not built here.
"""
from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class StipendLedger(Base):
    __tablename__ = "stipend_ledger"

    ledger_id = Column(Text, primary_key=True)
    beneficiary_id = Column(Text, ForeignKey("beneficiaries.beneficiary_id"))
    pillar_id = Column(Text, ForeignKey("pillars.pillar_id"))
    period = Column(Text)
    opening_balance = Column(Integer)
    eligible = Column(Integer)
    authorized = Column(Integer)
    disbursed = Column(Integer)
    running_balance = Column(Integer)

    beneficiary = relationship("Beneficiary")
    pillar = relationship("Pillar")
