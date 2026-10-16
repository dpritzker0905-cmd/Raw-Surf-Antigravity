"""Equipment overlap is a review clue, never a person identity or an entitlement."""
import pytest

from routes.ai.board_clues import compare_saved_boards
from routes.ai.vision_schemas import BoardCluePhotoAnalysis


def candidate(surfer="one", **changes):
    return {"surfer_id": surfer, "full_name": "Surfer " + surfer, "username": surfer,
            "board_id": "board-" + surfer, "brand": "Coastal", "model": "Twin Star",
            "board_type": "fish", "fin_setup": "twin", "tail_shape": "swallow",
            "description": "Blue board with white stripes", **changes}


def observation(**changes):
    return {"person_index": 0, "relationship": "holding", "confidence": "high",
            "colors": ["blue"], "patterns": ["stripes"], "visible_text": ["Coastal"],
            "board_type": "fish", "fin_setup": None, "tail_shape": None, **changes}


def test_links_observed_board_to_saved_details_with_inspectable_evidence_only():
    clues = compare_saved_boards([observation()], [candidate()])
    assert len(clues) == 1
    clue = clues[0]
    assert clue["surfer_id"] == "one" and clue["person_index"] == 0
    assert clue["requires_manual_review"] is True
    assert {e["field"] for e in clue["evidence"]} == {"brand", "board_type", "color", "pattern"}
    assert all(e["observed"] and e["saved"] for e in clue["evidence"])
    assert "probability" not in clue and "is_match" not in clue


@pytest.mark.parametrize("change", [
    {"relationship": "nearby"}, {"relationship": "unknown"}, {"confidence": "low"},
    {"visible_text": [], "colors": [], "patterns": [], "board_type": None},
])
def test_uncertain_or_unassociated_equipment_does_not_suggest_a_person(change):
    assert compare_saved_boards([observation(**change)], [candidate()]) == []


def test_ambiguous_shared_boards_retain_both_candidates_and_conflicting_details():
    clues = compare_saved_boards([observation(tail_shape="round")], [candidate(), candidate("two")])
    assert {c["surfer_id"] for c in clues} == {"one", "two"}
    assert all(c["strength"] == "limited" and c["conflicts"] for c in clues)


def test_generic_board_type_is_explicitly_limited_and_names_are_not_evidence():
    clues = compare_saved_boards([observation(colors=[], patterns=[], visible_text=[])], [candidate()])
    assert clues[0]["strength"] == "limited" and len(clues[0]["evidence"]) == 1
    assert compare_saved_boards([observation(colors=[], patterns=[], visible_text=[], board_type=None)],
                                [candidate(full_name="Blue Coastal Fish")]) == []


def test_brand_requires_legible_whole_phrase_and_negated_notes_are_not_evidence():
    c = candidate(description="Not blue; no stripes", board_type=None)
    assert compare_saved_boards([observation(visible_text=["Coastally"], board_type=None)], [c]) == []


def test_clothing_colors_in_saved_notes_do_not_become_board_evidence():
    c = candidate(description="Rider wearing a blue wetsuit with stripes", brand=None, model=None, board_type=None)
    assert compare_saved_boards([observation(visible_text=[], board_type=None)], [c]) == []


def test_multiple_people_keep_equipment_clues_attached_to_the_observed_position():
    clues = compare_saved_boards([
        observation(person_index=0, colors=[], patterns=[], board_type=None),
        observation(person_index=1, colors=[], patterns=[], board_type=None, visible_text=["Elsewhere"]),
    ], [candidate(), candidate("two", brand="Elsewhere")])
    assert [(c["person_index"], c["surfer_id"]) for c in clues] == [(0, "one"), (1, "two")]


def test_low_observation_never_becomes_strong_from_many_saved_fields():
    assert compare_saved_boards([observation(confidence="low")], [candidate()]) == []


def test_schema_rejects_board_associated_with_nonexistent_person():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        BoardCluePhotoAnalysis.model_validate({
            "people_count": 0, "people": [], "overall_description": "A board alone",
            "visual_tags": [], "conditions": {"wave_size": None, "weather": None, "location_hints": []},
            "board_observations": [observation()],
        })


@pytest.fixture
async def board_db():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from models import (Profile, Gallery, GalleryItem, Surfboard, LiveSession, LiveSessionParticipant,
                        Booking, BookingParticipant, DispatchRequest, DispatchRequestParticipant, RoleEnum)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for cls in (Profile, Gallery, GalleryItem, Surfboard, LiveSession, LiveSessionParticipant,
                    Booking, BookingParticipant, DispatchRequest, DispatchRequestParticipant):
            await connection.run_sync(lambda conn, table=cls.__table__: table.create(conn))
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        for sid in ("caller", "other", "active", "cancelled", "unrelated", "buyer"):
            db.add(Profile(id=sid, user_id=sid, email=sid + "@example.invalid", username=sid,
                           full_name="Surfer " + sid, role=RoleEnum.SURFER))
            db.add(Surfboard(id="board-" + sid, user_id=sid, brand="Coastal", board_type="fish"))
        db.add_all([LiveSession(id="live", photographer_id="caller"),
                    LiveSession(id="foreign", photographer_id="other"),
                    Gallery(id="gallery", photographer_id="caller", title="Fixture", live_session_id="live"),
                    GalleryItem(id="photo", gallery_id="gallery", photographer_id="caller",
                                preview_url="https://example.invalid/owned.jpg", original_url="https://example.invalid/original.jpg")])
        for sid, session, status, role in (("active", "live", "active", "participant"),
                                            ("cancelled", "live", "cancelled", "participant"),
                                            ("buyer", "live", "active", "grom_buyer"),
                                            ("unrelated", "foreign", "active", "participant")):
            from models import LiveSessionParticipant
            db.add(LiveSessionParticipant(photographer_id="caller" if session == "live" else "other",
                                         surfer_id=sid, live_session_id=session, status=status, participant_role=role))
        await db.commit()
        yield db
    await engine.dispose()


async def test_database_membership_excludes_other_sessions_cancelled_and_buyers(board_db):
    from models import GalleryItem
    from routes.ai.board_clues import load_board_candidates
    result = await load_board_candidates(board_db, await board_db.get(GalleryItem, "photo"), "caller")
    assert [c["surfer_id"] for c in result["candidates"]] == ["active"]
    assert result["status"] == "ready"


async def test_foreign_gallery_or_relinked_foreign_session_never_reads_its_boards(board_db):
    from fastapi import HTTPException
    from models import Gallery, GalleryItem
    from routes.ai.board_clues import load_board_candidates
    item = await board_db.get(GalleryItem, "photo")
    with pytest.raises(HTTPException) as error:
        await load_board_candidates(board_db, item, "other")
    assert error.value.status_code == 404
    gallery = await board_db.get(Gallery, "gallery")
    gallery.live_session_id = "foreign"
    await board_db.commit()
    result = await load_board_candidates(board_db, item, "caller")
    assert result["candidates"] == []


@pytest.mark.parametrize("kind", ["booking", "dispatch", "manual"])
async def test_membership_uses_own_linked_booking_or_dispatch_only(board_db, kind):
    from datetime import datetime, timezone
    from models import Gallery, GalleryItem, Booking, BookingParticipant, DispatchRequest, DispatchRequestParticipant
    from routes.ai.board_clues import load_board_candidates
    gallery = await board_db.get(Gallery, "gallery")
    gallery.live_session_id = None
    if kind == "booking":
        gallery.booking_id = "booking"
        board_db.add(Booking(id="booking", photographer_id="caller", location="Fixture",
                             session_date=datetime.now(timezone.utc), total_price=0))
        board_db.add_all([BookingParticipant(booking_id="booking", participant_id="active", status="confirmed"),
                          BookingParticipant(booking_id="booking", participant_id="cancelled", status="cancelled")])
    elif kind == "dispatch":
        gallery.dispatch_id = "dispatch"
        board_db.add(DispatchRequest(id="dispatch", requester_id="active", photographer_id="caller", latitude=0,
                                     longitude=0, hourly_rate=0, estimated_total=0, deposit_amount=0))
        board_db.add_all([DispatchRequestParticipant(dispatch_request_id="dispatch", participant_id="unrelated",
                                                     share_amount=0, status="confirmed"),
                          DispatchRequestParticipant(dispatch_request_id="dispatch", participant_id="cancelled",
                                                     share_amount=0, status="cancelled")])
    await board_db.commit()
    result = await load_board_candidates(board_db, await board_db.get(GalleryItem, "photo"), "caller")
    expected = {"active", "unrelated"} if kind == "dispatch" else {"active"} if kind == "booking" else set()
    assert {c["surfer_id"] for c in result["candidates"]} == expected
    if kind == "manual":
        assert result["status"] == "no_linked_session"


async def test_owned_http_scan_connects_real_saved_board_rows_without_any_tag_writes(board_db, monkeypatch):
    import httpx
    from fastapi import FastAPI
    from sqlalchemy import select, func
    from unittest.mock import AsyncMock
    from database import get_db
    from core.security import create_access_token
    from routes.ai import ai_tagging, ai_vision
    from models import GalleryItem, Surfboard
    analysis = {"people_count": 1, "people": [{"position": "left", "action": "holding a board",
                 "distinctive_features": [], "confidence": "high"}],
                "conditions": {"wave_size": None, "weather": None, "location_hints": []},
                "overall_description": "A surfer holding a fish board", "visual_tags": ["fish board"],
                "board_observations": [observation()]}
    infer = AsyncMock(return_value=analysis)
    monkeypatch.setattr(ai_vision, "_infer", infer)
    app = FastAPI()
    app.include_router(ai_tagging.router, prefix="/api")
    async def database_override():
        yield board_db
    app.dependency_overrides[get_db] = database_override
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://fixture.invalid") as client:
        response = await client.post("/api/ai/suggest-tags", headers={"Authorization": "Bearer " + create_access_token({"sub": "caller"})},
                                     json={"image_url": "https://example.invalid/substituted.jpg",
                                           "gallery_item_id": "photo", "include_board_clues": True})
    assert response.status_code == 200
    assert {c["surfer_id"] for c in response.json()["board_clues"]} == {"active"}
    assert response.json()["suggested_tags"] == []
    assert infer.call_args.args[0] == "https://example.invalid/owned.jpg"
    assert "Surfer active" not in str(infer.call_args)
    assert (await board_db.get(GalleryItem, "photo")).tagged_surfer_ids is None
    assert (await board_db.scalar(select(func.count()).select_from(Surfboard))) == 6
    assert not board_db.new and not board_db.dirty


async def test_candidate_limit_is_bounded_and_reported_instead_of_silently_complete(board_db):
    from models import GalleryItem, Surfboard
    from routes.ai.board_clues import load_board_candidates, MAX_BOARDS
    board_db.add_all([Surfboard(id=f"extra-{i:03}", user_id="active", board_type="fish") for i in range(MAX_BOARDS)])
    await board_db.commit()
    result = await load_board_candidates(board_db, await board_db.get(GalleryItem, "photo"), "caller")
    assert len(result["candidates"]) == MAX_BOARDS and result["truncated"] is True
