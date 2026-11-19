"""The surf-truth admin action log: every state-changing admin action in the surf-truth area, append-only.

Anchor status changes, audit verdicts and (later) flag and status changes each write one row here with the admin,
the action, its target, a reason and a small JSON detail. Admins never edit a reported number: there is no action for
that, and the routes take no such field. Same lock as the anchor log: RLS on, the Supabase service key may only read
and append, and triggers refuse UPDATE, DELETE and TRUNCATE for every role.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, DDL, String, Text, event

from database import Base
from .base import generate_uuid


def _now():
    return datetime.now(timezone.utc)


class SurfTruthAdminAction(Base):
    __tablename__ = 'surf_truth_admin_actions'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    admin_id = Column(String(36), nullable=False, index=True)
    action = Column(String(32), nullable=False)          # e.g. anchor_status, audit_verdict
    target_type = Column(String(32), nullable=False)     # e.g. anchor, surf_observation
    target_id = Column(String(36), nullable=False, index=True)
    reason = Column(Text, nullable=True)
    detail = Column(Text, nullable=True)                 # JSON
    at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)


APPEND_ONLY_FUNCTION = (
    "CREATE OR REPLACE FUNCTION surf_truth_admin_actions_append_only() RETURNS trigger LANGUAGE plpgsql "
    "SET search_path = '' AS $$ "
    "BEGIN RAISE EXCEPTION 'surf_truth_admin_actions is append-only'; END; $$"
)
APPEND_ONLY_TRIGGER = (
    "CREATE TRIGGER surf_truth_admin_actions_no_rewrite BEFORE UPDATE OR DELETE ON %(fullname)s "
    "FOR EACH ROW EXECUTE FUNCTION surf_truth_admin_actions_append_only()"
)
NO_TRUNCATE_TRIGGER = (
    "CREATE TRIGGER surf_truth_admin_actions_no_truncate BEFORE TRUNCATE ON %(fullname)s "
    "FOR EACH STATEMENT EXECUTE FUNCTION surf_truth_admin_actions_append_only()"
)
for _statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated, service_role',
    'GRANT SELECT, INSERT ON TABLE %(fullname)s TO service_role',
    APPEND_ONLY_FUNCTION, APPEND_ONLY_TRIGGER, NO_TRUNCATE_TRIGGER,
):
    event.listen(SurfTruthAdminAction.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
