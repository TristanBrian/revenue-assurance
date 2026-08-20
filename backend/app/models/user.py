"""
User model. See role.py / permission.py for the other two, and
associations.py for the user_roles / role_permissions join tables.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.associations import user_roles
from app.utils.db_connection import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    must_reset_password = Column(Boolean, default=False, nullable=False)
    temp_password_expires_at = Column(DateTime, nullable=True)

    last_login_at = Column(DateTime, nullable=True)

    # Cached "latest state" for fast checks (dependencies.py's guard,
    # login()'s terms_required branch) — the full history lives in
    # consent_records (models/consent_record.py), not here. Null =
    # never accepted anything.
    terms_accepted_version = Column(String(50), nullable=True)
    terms_accepted_at = Column(DateTime, nullable=True)

    roles = relationship("Role", secondary=user_roles, back_populates="users")

    def has_permission(self, code: str) -> bool:
        return any(p.code == code for role in self.roles for p in role.permissions)

    def permission_codes(self) -> set[str]:
        return {p.code for role in self.roles for p in role.permissions}
