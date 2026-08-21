"""
Officer model — Field Officer / Program Site master data (outbound domain
equivalent of depot.py — see omc.py's docstring for why identity fields
are NOT NULL here: assumed pre-existing/curated master data, unlike the
raw transactional tables like attendance.py/disbursement.py).
"""
from sqlalchemy import Boolean, Column, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Officer(Base):
    __tablename__ = "officers"

    officer_id = Column(Text, primary_key=True)
    officer_name = Column(Text, nullable=False)
    program_site = Column(Text)
    risk_profile = Column(Text)  # Good/Small/Medium/High — see scripts/generate_kpc_data.py's OFFICER_LEAKAGE_PROFILES
    phone = Column(Text)
    is_active = Column(Boolean, default=True)

    beneficiaries = relationship("Beneficiary", back_populates="officer")
