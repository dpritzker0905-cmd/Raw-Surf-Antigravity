"""The append-only record of every Company details publish (owner, 2026-11-18: "Yes, correction option").

Company details (services/legal_identity.py) fill the consent's {company} / {privacy_url} tokens. A publish is either
a CHANGE (a different company or privacy notice: a new consent revision, so everyone who opted in is asked again) or a
CORRECTION (a fix that does not change the meaning, such as a typo: same revision, consents and exports untouched).

Because a correction changes the words people see under the SAME consent version, this table is what still shows
exactly what each person saw: every row holds the details and the filled consent words before and after, who
published it, when, and which consent version was served before and after. To know what someone agreed to, take their
consent event's version and time and find the row in force then.

On Postgres, triggers refuse UPDATE, DELETE and TRUNCATE for every role (the consent-event pattern), and the service
key is granted only SELECT and INSERT. Private: RLS on, no anon/authenticated grants.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, DDL, String, Text, event

from database import Base
from .base import generate_uuid


def _now():
    return datetime.now(timezone.utc)


class CompanyDetailsChange(Base):
    __tablename__ = 'company_details_changes'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    doc_version = Column(String(32), nullable=False)           # the Company details version published
    kind = Column(String(16), nullable=False)                  # 'change' or 'correction'
    revision = Column(String(32), nullable=False)              # the consent revision in force after this publish
    legal_name_before = Column(Text, nullable=True)
    legal_name_after = Column(Text, nullable=False)
    privacy_url_before = Column(Text, nullable=True)
    privacy_url_after = Column(Text, nullable=False)
    privacy_contact_before = Column(Text, nullable=True)
    privacy_contact_after = Column(Text, nullable=True)
    consent_version_before = Column(String(64), nullable=True)
    consent_version_after = Column(String(64), nullable=False)
    consent_title_before = Column(Text, nullable=True)        # the filled checkbox label before (advisor: record it too)
    consent_title_after = Column(Text, nullable=True)          # the filled checkbox label after
    consent_text_before = Column(Text, nullable=True)         # the filled words people saw before
    consent_text_after = Column(Text, nullable=False)          # the filled words people see after
    consent_version_changed = Column(Boolean, nullable=False)  # True: everyone is asked again (retention revokes)
    actor_id = Column(String(36), nullable=False)
    at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)


for _statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated, service_role',
    'GRANT SELECT, INSERT ON TABLE %(fullname)s TO service_role',
    "CREATE OR REPLACE FUNCTION company_details_changes_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ "
    "BEGIN RAISE EXCEPTION 'company_details_changes is append-only'; END; $$",
    "CREATE TRIGGER company_details_changes_no_rewrite BEFORE UPDATE OR DELETE ON %(fullname)s "
    "FOR EACH ROW EXECUTE FUNCTION company_details_changes_append_only()",
    "CREATE TRIGGER company_details_changes_no_truncate BEFORE TRUNCATE ON %(fullname)s "
    "FOR EACH STATEMENT EXECUTE FUNCTION company_details_changes_append_only()",
):
    event.listen(CompanyDetailsChange.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
