"""The forecast data consent wording is a legal document (Compliance > Legal documents), with the version rule:
a version names ONE text (people agreed to it, so it never changes under them); any change is a new version, and a
new version asks everyone again (advisor hold on #1026)."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import Profile, SurfTruthConsentEvent, TosContent
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
            for model in (Profile, TosContent, SurfTruthConsentEvent):
                await conn.run_sync(lambda c, t=model.__table__: t.create(c))
        mk = async_sessionmaker(engine, expire_on_commit=False)
        async with mk() as db:
            for pid in ("ana", "ben", "cy"):
                db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                               role=RoleEnum.SURFER))
            await db.commit()
        return engine, mk
    engine, mk = asyncio.run(build())
    yield mk
    asyncio.run(engine.dispose())     # the estate lane's SQLite lifetime census fails on an engine left open


def _publish(db, version, title="Use my reports", body="Off unless you turn it on.", sections=None):
    return save_tos_content(TosContentRequest(doc_type="forecast_consent", version=version,
                                              sections=sections or [{"title": title, "body": body}]),
                            admin=ADMIN, db=db)


def test_default_wording_until_an_admin_publishes(maker):
    async def go():
        async with maker() as db:
            words = await stc.wording(db)
            assert (words["version"], words["title"], words["published"]) == (
                stc.CONSENT_VERSION, stc.CONSENT_TITLE, False)
            doc = await get_current_tos_content(doc_type="forecast_consent", db=db)
            assert doc["sections"] == stc.DEFAULT_SECTIONS
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
            assert (await stc.wording(db))["text"] == stc.CONSENT_TEXT
            await _publish(db, stc.CONSENT_VERSION, sections=stc.DEFAULT_SECTIONS)   # publishing it unchanged is fine
            assert (await stc.current(db, "ana"))["granted"] is True
    asyncio.run(go())

