"""Receipts for acknowledged or interrupted gallery copy operations."""
from sqlalchemy import Column, DDL, DateTime, ForeignKey, String, event, func

from database import Base


class GalleryCopyReceipt(Base):
    __tablename__ = "gallery_copy_receipts"

    owner_id = Column(String(36), ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    operation_id = Column(String(36), primary_key=True)
    # Keep the receipt if the original, folder or copy is subsequently removed.
    source_id = Column(String(36), nullable=False)
    target_id = Column(String(36), nullable=False)
    copy_id = Column(String(36), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


for statement in (
    "ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON TABLE %(fullname)s FROM PUBLIC, anon, authenticated",
    "GRANT SELECT, INSERT ON TABLE %(fullname)s TO service_role",
):
    event.listen(GalleryCopyReceipt.__table__, "after_create", DDL(statement).execute_if(dialect="postgresql"))
