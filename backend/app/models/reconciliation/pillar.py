"""
Pillar model — program pillar reference data (outbound domain equivalent
of product.py): Scholarship / Plus / Vocational / Tech.

UNLIKE product.py, there is no pillars.csv and no ETL step that populates
this table yet — scripts/generate_kpc_data.py's PILLAR_MONTHLY_RATE_KES is
still a plain in-code dict, not a generated master file, since the Stage 2
spec's explicit CSV list only names 5 new files (none of them pillars.csv).
This model exists per that spec's "reference/dimension tables if not
already present" instruction, and to give beneficiary.py/attendance.py a
real FK target to document intent against — same
declared-but-not-yet-populated treatment as depot_ledger.py/
quota_ledger.py. Seed it (or point ETL at a real pillars.csv) before
relying on the `pillar` relationship() below returning anything.
"""
from sqlalchemy import Column, Numeric, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Pillar(Base):
    __tablename__ = "pillars"

    pillar_id = Column(Text, primary_key=True)  # "Scholarship", "Plus", "Vocational", "Tech"
    monthly_rate_kes = Column(Numeric(10, 2), nullable=True)

    beneficiaries = relationship("Beneficiary", back_populates="pillar")
