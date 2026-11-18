"""Company details for the legal documents: who the controller is, and where the privacy notice lives.

Edited by an admin in Compliance > Legal documents > Company details (next to the Terms of Service), stored as a
versioned `tos_content` document of doc_type 'company_details' (so every change keeps its history and its author,
like the other legal documents; no table or migration). Its sections are fixed fields: one section per FIELD, the
section title is the field key and the body its value.

The Terms of Service, the Privacy Policy and the forecast-data consent may use TOKENS that are filled from these
details when the text is served: `{company}` -> the legal entity name, `{privacy_url}` -> the privacy-notice link,
`{privacy_contact}` -> the privacy contact (an email address, optional). Admins see and edit the unfilled template;
people see the filled text. Changing the legal name therefore changes the words of every document that uses the
token, and for the consent that means a NEW consent version (services/surf_truth_consent.wording), so everyone who
opted in is asked again.

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
_URL = re.compile(r"^(/[A-Za-z0-9/_\-]*|https://[^\s<>\"']+)$")
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
