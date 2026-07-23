"""
Audit Log Model – Tracks all user actions
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, JSON, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.utils.db_connection import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # Null for system actions
    user_username = Column(String(50), nullable=True)  # Denormalized for speed

    # Action details
    action = Column(String(100), nullable=False)  # e.g., "LOGIN", "RECONCILE", "SYNC", "EXPORT"
    resource = Column(String(100), nullable=True)  # e.g., "INVOICE", "PAYMENT", "ANOMALY"
    resource_id = Column(String(100), nullable=True)  # e.g., "INV-1001", "DISP-002"

    # Request details
    method = Column(String(10), nullable=True)  # GET, POST, PUT, DELETE
    endpoint = Column(String(255), nullable=True)  # /api/reconcile
    ip_address = Column(String(45), nullable=True)  # IPv6 or IPv4
    user_agent = Column(String(255), nullable=True)

    # Result
    status_code = Column(Integer, nullable=True)  # 200, 404, 500
    success = Column(Integer, default=1)  # 1 for success, 0 for failure
    error_message = Column(Text, nullable=True)

    # Additional data
    details = Column(JSON, nullable=True)  # Store extra context as JSON
    previous_state = Column(JSON, nullable=True)  # Before action
    new_state = Column(JSON, nullable=True)      # After action

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    user = relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<AuditLog {self.id}: {self.action} by {self.user_username}>"