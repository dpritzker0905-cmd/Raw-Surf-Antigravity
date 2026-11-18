"""The forecast data consent wording is a legal document (Compliance > Legal documents), with the version rule:
a version names ONE text (people agreed to it, so it never changes under them); any change is a new version, and a
new version asks everyone again (advisor hold on #1026)."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import CompanyDetailsChange, Profile, SurfTruthConsentEvent, TosContent
from models.enums import RoleEnum
from routes.compliance_pkg.tos import TosContentRequest, get_current_tos_content, save_tos_content
from services import surf_truth_consent as stc

T0 = datetime(2026, 11, 18, 2, 0, tzinfo=timezone.utc)
ADMIN = Profile(id="admin")


@pytest.fixture
def maker():
    async def build():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            for model in (Profile, TosContent, SurfTruthConsentEvent, CompanyDetailsChange):
                await conn.run_sync(lambda c, t=model.__table__: t.create(c))
        mk = async_sessionmaker(engine, expire_on_commit=False)
        async with mk() as db:
            for pid in ("ana", "ben", "cy"):
                db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                               role=RoleEnum.SURFER))
            await db.commit()
        return mk
    return asyncio.run(build())


def _publish(db, version, title="Use my reports", body="Off unless you turn it on.", sections=None):
    return save_tos_content(TosContentRequest(doc_type="forecast_consent", version=version,
                                              sections=sections or [{"title": title, "body": body}]),
                            admin=ADMIN, db=db)


def test_default_wording_until_an_admin_publishes(maker):
    async def go():
        async with maker() as db:
            words = await stc.wording(db)
            assert (words["version"], words["title"], words["published"]) == (
                stc.default_served_version(), stc.CONSENT_TITLE, False)
            assert words["version"].startswith(stc.CONSENT_VERSION + "+")    # the version names the FILLED words
            doc = await get_current_tos_content(doc_type="forecast_consent", raw=True, db=db)
            assert doc["sections"] == stc.DEFAULT_SECTIONS                      # the admin edits the template
            await _publish(db, "1.0", title="Share my wave reports")
            words = await stc.wording(db)
            assert (words["version"], words["title"], words["published"]) == ("1.0", "Share my wave reports", True)
    asyncio.run(go())


@pytest.mark.parametrize("sections", [
    [{"title": "a", "body": "b"}, {"title": "c", "body": "d"}],   # two sections
    [{"title": "a", "body": "  "}],                               # no text
    [{"title": "", "body": "b"}],                                 # no label
])
def test_consent_document_must_be_one_label_and_one_text(maker, sections):
    async def go():
        async with maker() as db:
            with pytest.raises(HTTPException) as exc:
                await _publish(db, "1.0", sections=sections)
            assert exc.value.status_code == 400
    asyncio.run(go())


def test_unknown_document_type_is_refused(maker):
    async def go():
        async with maker() as db:
            with pytest.raises(HTTPException):
                await save_tos_content(TosContentRequest(doc_type="cookies", version="1", sections=[]),
                                       admin=ADMIN, db=db)
    asyncio.run(go())


def test_a_version_keeps_its_text_and_a_new_version_asks_again(maker):
    async def go():
        async with maker() as db:
            await _publish(db, "1.0")
            await stc.record(db, "ana", True, "settings", now=T0)
            await stc.record(db, "ben", True, "settings", now=T0)
            await stc.record(db, "cy", False, "settings", now=T0)
            await db.commit()
            assert await stc.granted_now(db, {"ana", "ben", "cy"}) == {"ana", "ben"}

            with pytest.raises(HTTPException) as exc:                                   # text change, same version
                await _publish(db, "1.0", body="Off unless you turn it on (and also used for ads).")
            assert exc.value.status_code == 409
            await _publish(db, "1.0", body="  Off unless you turn it on.  ")              # same text: re-publish is fine
            assert (await stc.current(db, "ana"))["granted"] is True
            assert await stc.granted_now(db, {"ana", "ben"}) == {"ana", "ben"}

            await _publish(db, "2.0", body="Now also used for something new.")          # meaning changed
            state = await stc.current(db, "ana")
            assert state["granted"] is False and state["needs_reconsent"] is True and state["version"] == "1.0"
            assert await stc.granted_now(db, {"ana", "ben"}) == set()
            assert await stc.summary(db) == {"version": "2.0", "opted_in": 0, "awaiting_reconsent": 2,
                                             "opted_out": 1}

            await stc.record(db, "ana", True, "blind_height_input", now=T0 + timedelta(days=1))  # agrees again
            await db.commit()
            assert (await stc.current(db, "ana"))["granted"] is True
            assert (await stc.current(db, "ana"))["version"] == "2.0"
            assert await stc.granted_now(db, {"ana", "ben"}) == {"ana"}
            assert (await stc.summary(db))["opted_in"] == 1
    asyncio.run(go())


def test_the_default_wordings_version_cannot_be_published_with_other_text(maker):
    async def go():
        async with maker() as db:
            await stc.record(db, "ana", True, "settings", now=T0)          # agreed to the built-in default
            await db.commit()
            with pytest.raises(HTTPException) as exc:
                await _publish(db, stc.CONSENT_VERSION, body="Different words under the default's version.")
            assert exc.value.status_code == 409
            assert (await stc.wording(db))["text"] == stc.CONSENT_TEXT.replace(
                "{company}", "Raw Surf Adventures Inc.").replace("{privacy_url}", "/privacy")
            await _publish(db, stc.CONSENT_VERSION, sections=stc.DEFAULT_SECTIONS)   # publishing it unchanged is fine
            assert (await stc.current(db, "ana"))["granted"] is True
    asyncio.run(go())


def test_a_draft_marker_blocks_every_grant_but_never_a_withdrawal(maker):
    """Legal research 2026-11-18: consent must name the controller (GDPR Art. 13(1)(a)). A text that still carries a
    draft marker cannot be made active, and an empty company detail used by a token blocks every grant."""
    async def go():
        async with maker() as db:
            with pytest.raises(HTTPException) as exc:
                await _publish(db, "1.0", body="When on, [COMPANY] uses your reports.")
            assert exc.value.status_code == 400 and "[COMPANY]" in exc.value.detail
            # an admin-published text that uses {privacy_contact} while no contact is set is not final
            await _publish(db, "1.0", body="When on, {company} uses your reports. Ask {privacy_contact}.")
            words = await stc.wording(db)
            assert words["final"] is False
            with pytest.raises(stc.WordingNotFinal):
                await stc.record(db, "ana", True, "settings", now=T0)
            await stc.record(db, "ben", False, "settings", now=T0)              # a withdrawal is always recorded
            await db.commit()
            assert await stc.granted_now(db, {"ana", "ben"}) == set()
            # set the contact in Company details: final, and a grant counts
            await _publish_company(db, "1.1", privacy_contact="privacy@example.invalid")
            assert (await stc.wording(db))["final"] is True
            await stc.record(db, "ana", True, "settings", now=T0 + timedelta(minutes=1))
            await db.commit()
            assert await stc.granted_now(db, {"ana"}) == {"ana"}
    asyncio.run(go())


def _publish_company(db, version, correction=False, **values):
    from services import legal_identity
    fields = {**legal_identity.DEFAULTS, **values}
    return save_tos_content(TosContentRequest(doc_type="company_details", version=version, correction=correction,
                                              sections=[{"title": k, "body": v} for k, v in fields.items()]),
                            admin=ADMIN, db=db)


def test_a_correction_keeps_every_consent_and_records_what_people_saw(maker):
    """Owner, 2026-11-18: "Yes, correction option" / "Only real name changes". A typo fix keeps the consent version;
    the append-only record keeps the old and new words and who published, so what each person saw is still known."""
    from sqlalchemy import select
    from models import CompanyDetailsChange

    async def go():
        async with maker() as db:
            await _publish_company(db, "1.1", legal_name="Raw Surf Adventurs Inc.")       # a CHANGE (the typo)
            typo = await stc.wording(db)
            await stc.record(db, "ana", True, "settings", now=T0)
            await db.commit()
            out = await _publish_company(db, "1.2", correction=True, legal_name="Raw Surf Adventures Inc.")
            fixed = await stc.wording(db)
            assert out["kind"] == "correction" and out["consent_version_changed"] is False
            assert fixed["version"] == typo["version"]                                     # same version ...
            assert "Raw Surf Adventures Inc. uses" in fixed["text"]                        # ... corrected words
            assert (await stc.current(db, "ana"))["granted"] is True                       # ana's consent stands
            assert await stc.granted_now(db, {"ana"}) == {"ana"}
            rows = (await db.execute(select(CompanyDetailsChange).order_by(CompanyDetailsChange.at))).scalars().all()
            assert [(r.kind, r.consent_version_changed) for r in rows] == [("change", True), ("correction", False)]
            last = rows[-1]
            assert (last.legal_name_before, last.legal_name_after) == ("Raw Surf Adventurs Inc.", "Raw Surf Adventures Inc.")
            assert "Raw Surf Adventurs Inc. uses" in last.consent_text_before
            assert "Raw Surf Adventures Inc. uses" in last.consent_text_after
            assert last.consent_version_before == last.consent_version_after == typo["version"]
            assert last.actor_id == "admin" and last.revision == rows[0].revision
    asyncio.run(go())


def test_the_company_details_record_is_append_only_on_postgres():
    ddl = " | ".join(str(getattr(getattr(fn, "__self__", None), "statement", "") or getattr(fn, "statement", ""))
                     for fn in CompanyDetailsChange.__table__.dispatch.after_create)
    for needed in ("company_details_changes_no_rewrite", "company_details_changes_no_truncate", "BEFORE TRUNCATE",
                   "ENABLE ROW LEVEL SECURITY", "GRANT SELECT, INSERT ON TABLE"):
        assert needed in ddl, needed


def test_a_publish_that_leaves_the_consent_words_alone_changes_nothing(maker):
    """The default consent does not use {privacy_contact}: setting one, even as a CHANGE, keeps every consent."""
    async def go():
        async with maker() as db:
            before = (await stc.wording(db))["version"]
            await stc.record(db, "ana", True, "settings", now=T0)
            await db.commit()
            out = await _publish_company(db, "1.1", privacy_contact="privacy@example.invalid")
            assert out["kind"] == "change" and out["consent_version_changed"] is False
            assert (await stc.wording(db))["version"] == before
            assert await stc.granted_now(db, {"ana"}) == {"ana"}
    asyncio.run(go())


def test_the_default_consent_names_raw_surf_adventures_and_links_the_privacy_page(maker):
    """Owner, 2026-11-18: one switch; the entity is Raw Surf Adventures Inc.; the notice is the app's /privacy page."""
    async def go():
        async with maker() as db:
            words = await stc.wording(db)
            assert words["final"] is True and words["privacy_url"] == "/privacy"
            assert "Raw Surf Adventures Inc. uses the wave heights" in words["text"]
            assert words["text"].endswith("Privacy notice: /privacy") and "{" not in words["text"]
            doc = await get_current_tos_content(doc_type="forecast_consent", raw=False, db=db)
            assert doc["version"] == words["version"] and doc["sections"][0]["body"] == words["text"]
    asyncio.run(go())


def test_renaming_the_company_is_a_new_consent_version_that_asks_everyone_again(maker):
    async def go():
        async with maker() as db:
            await stc.record(db, "ana", True, "settings", now=T0)
            await db.commit()
            assert await stc.granted_now(db, {"ana"}) == {"ana"}
            before = (await stc.wording(db))["version"]
            await _publish_company(db, "2.0", legal_name="Raw Surf Holdings LLC")
            words = await stc.wording(db)
            assert words["version"] != before and words["version"].startswith(stc.CONSENT_VERSION + "+")
            assert "Raw Surf Holdings LLC uses" in words["text"]
            state = await stc.current(db, "ana")
            assert state["granted"] is False and state["needs_reconsent"] is True
            assert await stc.granted_now(db, {"ana"}) == set()
    asyncio.run(go())


@pytest.mark.parametrize("values,why", [
    ({"legal_name": ""}, "required"), ({"privacy_url": "javascript:alert(1)"}, "privacy notice link"),
    ({"privacy_contact": "not an email"}, "email"),
])
def test_company_details_are_validated(maker, values, why):
    async def go():
        async with maker() as db:
            with pytest.raises(HTTPException) as exc:
                await _publish_company(db, "1.0", **values)
            assert exc.value.status_code == 400 and why in exc.value.detail
            with pytest.raises(HTTPException):
                await save_tos_content(TosContentRequest(doc_type="company_details", version="1.0",
                                                         sections=[{"title": "ceo", "body": "x"}]), admin=ADMIN, db=db)
    asyncio.run(go())


def test_documents_are_served_filled_but_edited_as_templates(maker):
    """{company} in the Privacy Policy is filled for readers; the admin editor (raw) keeps the token. The privacy
    defaults keep their original sections and gain the appended ones."""
    async def go():
        async with maker() as db:
            served = await get_current_tos_content(doc_type="privacy", raw=False, db=db)
            raw = await get_current_tos_content(doc_type="privacy", raw=True, db=db)
            assert served["company"] == "Raw Surf Adventures Inc."
            assert raw["sections"][:9] == served["sections"][:9]                 # the original nine, unchanged
            assert [s["title"] for s in raw["sections"][9:]] == ["10. Who We Are",
                                                                  "11. Forecast Data From Your Wave Reports"]
            assert "{company}" in raw["sections"][9]["body"]
            assert "Raw Surf Adventures Inc." in served["sections"][9]["body"]
            assert all("{" not in s["body"] for s in served["sections"])
            company = await get_current_tos_content(doc_type="company_details", raw=False, db=db)
            assert {s["title"]: s["body"] for s in company["sections"]}["legal_name"] == "Raw Surf Adventures Inc."
    asyncio.run(go())

