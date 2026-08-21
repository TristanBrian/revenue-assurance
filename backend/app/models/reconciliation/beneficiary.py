"""
Beneficiary model — Inuka Foundation program participant (outbound
domain equivalent of omc.py). Each beneficiary belongs to exactly one
officer and one pillar — see scripts/generate_kpc_data.py's
generate_beneficiary_master(), which is what the officer-level leakage
profile cascades through.
"""
from sqlalchemy import Boolean, Column, ForeignKey, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Beneficiary(Base):
    __tablename__ = "beneficiaries"

    beneficiary_id = Column(Text, primary_key=True)
    beneficiary_name = Column(Text, nullable=False)
    officer_id = Column(Text, ForeignKey("officers.officer_id"))
    pillar_id = Column(Text, ForeignKey("pillars.pillar_id"))
    guardian_name = Column(Text)
    registered_address = Column(Text)
    mobile_money_number = Column(Text)
    enrollment_date = Column(Text)  # kept TEXT like depot_ledger.py's date column — see that file's note on format consistency
    is_active = Column(Boolean, default=True)

    officer = relationship("Officer", back_populates="beneficiaries")
    pillar = relationship("Pillar", back_populates="beneficiaries")
