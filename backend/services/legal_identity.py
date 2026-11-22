"""Company details for the legal documents: who the controller is, and where the privacy notice lives.

Edited by an admin in Compliance > Legal documents > Company details (next to the Terms of Service), stored as a
versioned `tos_content` document of doc_type 'company_details' (so every change keeps its history and its author,
like the other legal documents; no table or migration). Its sections are fixed fields: one section per FIELD, the
section title is the field key and the body its value.

The Terms of Service, the Privacy Policy and the forecast-data consent may use TOKENS that are filled from these
details when the text is served: `{company}` -> the legal entity name, `{privacy_url}` -> the privacy-notice link,
`{privacy_contact}` -> the privacy contact (an email address, optional). Admins see and edit the unfilled template;
people see the filled text. Changing the legal name therefore changes the words of every document that uses the
token. For the consent, a CHANGE (a different company or privacy notice) starts a new consent REVISION and so a NEW
consent version (services/surf_truth_consent.wording): everyone who opted in is asked again. A CORRECTION (a fix that
does not change the meaning, e.g. a typo) keeps the revision, so consents and exports are untouched (owner,
2026-11-18: "Yes, correction option"; "Only real name changes"). Every publish, either kind, appends a row to
`company_details_changes` (models/company_details_changes.py) with the old and new details and filled consent words,
so the record still shows exactly what each person saw.

Owner, 2026-11-18: the legal entity is "Raw Surf Adventures Inc."; the privacy notice is the app's own /privacy page.
"""
from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import select

DOC_TYPE = "company_details"
FIELDS = {
    "legal_name": "Legal entity name",
    "privacy_url": "Privacy notice link",
    "privacy_contact": "Privacy contact email (optional)",
}
DEFAULTS = {"legal_name": "Raw Surf Adventures Inc.", "privacy_url": "/privacy", "privacy_contact": ""}
DEFAULT_VERSION = "1.0"
TOKENS = {"{company}": "legal_name", "{privacy_url}": "privacy_url", "{privacy_contact}": "privacy_contact"}
REQUIRED = ("legal_name", "privacy_url")
_URL = re.compile(r"^(/|/[A-Za-z0-9_\-][A-Za-z0-9/_\-]*|https://[^\s<>\"']+)$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def default_sections() -> list:
    return [{"title": key, "body": DEFAULTS[key]} for key in FIELDS]


def from_sections(sections: Optional[list]) -> dict:
    """A document's sections -> {field: value}, missing fields falling back to the defaults."""
    values = dict(DEFAULTS)
    for s in sections or []:
        if isinstance(s, dict) and s.get("title") in FIELDS:
            values[s["title"]] = str(s.get("body") or "").strip()
    return values


def validate(sections: list) -> Optional[str]:
    """An admin save of company details: None if fine, else the reason it is refused."""
    if not isinstance(sections, list) or any(not isinstance(s, dict) for s in sections):
        return "Company details are a list of fields"
    keys = [s.get("title") for s in sections]
    unknown = [k for k in keys if k not in FIELDS]
    if unknown or len(set(keys)) != len(keys):
        return "Company details take only these fields, once each: " + ", ".join(FIELDS)
    values = from_sections(sections)
    for key in REQUIRED:
        if not values[key]:
            return f"{FIELDS[key]} is required"
    if not _URL.match(values["privacy_url"]):
        return "The privacy notice link must be an app path like /privacy or an https:// address"
    if values["privacy_contact"] and not _EMAIL.match(values["privacy_contact"]):
        return "The privacy contact must be an email address"
    if len(values["legal_name"]) > 200:
        return "The legal entity name is limited to 200 characters"
    return None


DEFAULT_REVISION = "default"
KINDS = ("change", "correction")


async def current_revision(db) -> str:
    """The consent revision in force: set by the newest Company details CHANGE (a correction keeps the one before);
    'default' before anyone publishes. The consent's served version is derived from it, not from the filled words,
    so a correction keeps every consent (owner, 2026-11-18: "Yes, correction option")."""
    from models import CompanyDetailsChange
    row = (await db.execute(select(CompanyDetailsChange).order_by(CompanyDetailsChange.at.desc(),
                                                                  CompanyDetailsChange.id.desc()).limit(1))
           ).scalar_one_or_none()
    return row.revision if row is not None else DEFAULT_REVISION


async def record_publish(db, *, doc_version: str, kind: str, before: dict, after: dict, consent_before: dict,
                         consent_after: dict, revision: str, actor_id: str):
    """Append one row to the company_details_changes record (append-only). Does not commit."""
    from models import CompanyDetailsChange
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    row = CompanyDetailsChange(
        doc_version=doc_version, kind=kind, revision=revision,
        legal_name_before=before.get("legal_name"), legal_name_after=after["legal_name"],
        privacy_url_before=before.get("privacy_url"), privacy_url_after=after["privacy_url"],
        privacy_contact_before=before.get("privacy_contact"), privacy_contact_after=after.get("privacy_contact"),
        consent_version_before=consent_before.get("version"), consent_version_after=consent_after["version"],
        consent_title_before=consent_before.get("title"), consent_title_after=consent_after.get("title"),
        consent_text_before=consent_before.get("text"), consent_text_after=consent_after["text"],
        consent_version_changed=consent_before.get("version") != consent_after["version"], actor_id=actor_id)
    db.add(row)
    return row


async def current(db) -> dict:
    """The company details in force: the active admin-published document, else the defaults."""
    from models import TosContent
    doc = (await db.execute(select(TosContent).where(TosContent.doc_type == DOC_TYPE, TosContent.is_active.is_(True))
                            .limit(1))).scalar_one_or_none()
    return from_sections(doc.sections if doc is not None else None)


def fill(text: Optional[str], details: dict) -> str:
    """Replace every token in `text` with its value. An empty optional value leaves an empty string."""
    out = text or ""
    for token, key in TOKENS.items():
        out = out.replace(token, details.get(key) or "")
    return out


def fill_sections(sections: Optional[list], details: dict) -> list:
    return [{**s, "title": fill(s.get("title"), details), "body": fill(s.get("body"), details)}
            if isinstance(s, dict) else s for s in (sections or [])]
