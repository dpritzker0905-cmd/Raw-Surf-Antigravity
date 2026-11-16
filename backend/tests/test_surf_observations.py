"""Blind surf-height observations (T1 crowd truth, P1): the server owns every field that makes a row trustworthy.

Proved over real HTTP + JWT against a real SQLite database:
- the scale is stored with the number and converted to face metres by the server (Hawaiian x2), with the region's
  default scale computed server-side (Hawaiian in Hawaii, face elsewhere) and an override recorded;
- `source` and `forecast_shown_before` cannot be sent: unknown fields are refused, and the server's audit of the
  entry screen decides `forecast_shown_before` (the spot page shows a forecast, so its reports are NOT blind);
- the parent report must be the caller's own, fresh, and carry at most one observation;
- GPS distance to the spot, the photo's EXIF position (read from the uploaded bytes, never the client) and duplicate
  photos are checked and flagged;
- the two legacy write routes that 422'd on every call (/check-in, /surf-reports: a required `user_id` query the
  client never sent) now take identity from the JWT, and /condition-reports now requires it.
"""
import io
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (CheckIn, ConditionReport, ObservationMedia, Profile, RoleEnum, SurfObservation, SurfReport,
                    SurfSpot, SurfTruthAnchor, SurfTruthAnchorEvent, UserStreak)
from routes.surf_data import checkins, observations, surf_reports
from services import observation_media
from services.surf_observation_scale import (FT_TO_M, ObservationError, normalise, region_default_scale)

URL = "/api/surf-observations"
NOW = datetime.now(timezone.utc)
PIPE = (21.6650, -158.0538)      # North Shore, Oahu (catalogue pin)
NSB = (29.0258, -80.9270)        # New Smyrna Beach, Florida


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


# ── pure scale conversion ────────────────────────────────────────────────────────────────────────────────────────

def test_face_feet_to_metres_and_hawaiian_doubles():
    assert normalise(scale="face", unit="ft", value=4).face_m == pytest.approx(4 * FT_TO_M, abs=1e-3)
    assert normalise(scale="hawaiian", unit="ft", value=4).face_m == pytest.approx(8 * FT_TO_M, abs=1e-3)
    assert normalise(scale="face", unit="m", value=1.5).face_m == pytest.approx(1.5)


def test_bucket_is_a_range_in_the_chosen_scale():
    b = normalise(scale="face", bucket="2-3ft")
    assert (b.face_m_low, b.face_m_high, b.input_kind) == (pytest.approx(0.61, abs=1e-3), pytest.approx(0.914, abs=1e-3),
                                                           "bucket")
    assert b.face_m_low < b.face_m < b.face_m_high
    h = normalise(scale="hawaiian", bucket="2-3ft")
    assert h.face_m_low == pytest.approx(2 * b.face_m_low, abs=1e-3)
    assert normalise(scale="face", bucket="8ft+").face_m_high is None


@pytest.mark.parametrize("kwargs", [
    dict(scale="face", unit="ft", value=101), dict(scale="face", unit="m", value=-1),
    dict(scale="face", unit="ft", value=float("nan")), dict(scale="feet", unit="ft", value=3),
    dict(scale="face", unit="ft"), dict(scale="face", unit="ft", value=3, bucket="2-3ft"),
    dict(scale="face", bucket="huge"), dict(scale="face", unit="yd", value=3),
])
def test_implausible_or_ambiguous_entries_are_refused(kwargs):
    with pytest.raises(ObservationError):
        normalise(**kwargs)


def test_region_default_is_hawaiian_only_in_hawaii():
    assert region_default_scale(*PIPE) == "hawaiian"
    assert region_default_scale(None, None, state_province="Hawaii") == "hawaiian"
    assert region_default_scale(*NSB, state_province="Florida") == "face"
    assert region_default_scale(-34.05, 23.38, country="South Africa") == "face"  # unconfirmed region stays face


def _jpeg(lat=None, lon=None, when=None):
    img = Image.new("RGB", (8, 8), (10, 120, 200))
    exif = img.getexif()
    if lat is not None:
        def dms(x):
            x = abs(x)
            d = int(x)
            m = int((x - d) * 60)
            return (float(d), float(m), round((x - d - m / 60) * 3600, 4))
        gps = {1: "N" if lat >= 0 else "S", 2: dms(lat), 3: "E" if lon >= 0 else "W", 4: dms(lon)}
        if when is not None:
            gps[29] = when.strftime("%Y:%m:%d")
            gps[7] = (float(when.hour), float(when.minute), float(when.second))
        exif[0x8825] = gps
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def test_inspect_media_reads_gps_and_utc_time_from_bytes():
    when = NOW.replace(microsecond=0)
    facts = observation_media.inspect_media(_jpeg(*PIPE, when=when), is_image=True)
    assert facts.exif_latitude == pytest.approx(PIPE[0], abs=1e-4)
    assert facts.exif_longitude == pytest.approx(PIPE[1], abs=1e-4)
    assert facts.exif_taken_at == when
    assert len(facts.sha256) == 64


def test_inspect_media_without_exif_or_unreadable_is_hash_only():
    assert observation_media.inspect_media(_jpeg(), is_image=True).exif_latitude is None
    junk = observation_media.inspect_media(b"not an image", is_image=True)
    assert junk.exif_latitude is None and len(junk.sha256) == 64
    assert observation_media.inspect_media(b"video bytes", is_image=False).exif_taken_at is None


# ── the route ────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, SurfSpot, CheckIn, UserStreak, ConditionReport, SurfReport, SurfObservation,
                      ObservationMedia, SurfTruthAnchor, SurfTruthAnchorEvent):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        # Taken HERE, not at import: CI's guards lane runs for many minutes before this fixture, and a photo stamped
        # at import time would read as minutes old by then (it failed hosted CI at 620 s against a 120 s check).
        now = datetime.now(timezone.utc)
        for pid in ("surfer", "other", "photog"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                           role=RoleEnum.PHOTOGRAPHER if pid == "photog" else RoleEnum.SURFER))
        db.add(SurfSpot(id="pipe", name="Pipeline", latitude=PIPE[0], longitude=PIPE[1], state_province="Hawaii",
                        country="USA"))
        db.add(SurfSpot(id="nsb", name="New Smyrna", latitude=NSB[0], longitude=NSB[1], state_province="Florida",
                        country="USA"))
        for rid, owner, url in (("cr-1", "photog", "https://cdn.invalid/c1.jpg"),
                                ("cr-2", "photog", "https://cdn.invalid/c2.jpg"),
                                ("cr-other", "other", "https://cdn.invalid/c3.jpg")):
            db.add(ConditionReport(id=rid, photographer_id=owner, spot_id="pipe", media_url=url,
                                   expires_at=now + timedelta(hours=24), created_at=now))
        db.add(ConditionReport(id="cr-old", photographer_id="photog", spot_id="pipe", media_url="https://cdn.invalid/o",
                               expires_at=now + timedelta(hours=24), created_at=now - timedelta(hours=7)))
        db.add(SurfReport(id="sr-1", user_id="surfer", spot_id="nsb", created_at=now))
        db.add(CheckIn(id="ci-1", user_id="surfer", spot_id="nsb", spot_name="New Smyrna", created_at=now))
        same = observation_media.inspect_media(_jpeg(*PIPE, when=now.replace(microsecond=0)), is_image=True)
        for url in ("https://cdn.invalid/c1.jpg", "https://cdn.invalid/c2.jpg"):  # the same photo uploaded twice
            db.add(ObservationMedia(user_id="photog", media_url=url, media_type="image", sha256=same.sha256,
                                    exif_latitude=same.exif_latitude, exif_longitude=same.exif_longitude,
                                    exif_taken_at=same.exif_taken_at))
        await db.commit()

    app = FastAPI()
    for module in (observations, checkins, surf_reports):
        app.include_router(module.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency

    async def rows():
        async with maker() as db:
            return (await db.execute(select(SurfObservation).order_by(SurfObservation.received_at))).scalars().all()

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            yield SimpleNamespace(client=c, rows=rows, maker=maker)
    finally:
        await engine.dispose()


def _checkin(**over):
    body = dict(entry_screen="checkin_modal", ref_id="ci-1", height_value=3, height_unit="ft", height_scale="face",
                set_or_avg="sets", latitude=NSB[0] + 0.001, longitude=NSB[1])
    body.update(over)
    return body


async def test_no_token_is_401_and_writes_nothing(world):
    assert (await world.client.post(URL, json=_checkin())).status_code == 401
    assert await world.rows() == []


async def test_checkin_observation_is_stored_with_server_fields(world):
    r = await world.client.post(URL, json=_checkin(), headers=_token("surfer"))
    assert r.status_code == 200, r.text
    (row,) = await world.rows()
    assert (row.source, row.forecast_shown_before, row.surface, row.spot_id) == ("observed", False, "checkin", "nsb")
    assert row.face_m == pytest.approx(3 * FT_TO_M, abs=1e-3)
    assert (row.height_scale, row.scale_default, row.scale_overridden) == ("face", "face", False)
    assert row.gps_check == "ok" and row.gps_distance_m < 500
    assert row.exif_check == "none"
    assert row.received_at is not None


@pytest.mark.parametrize("forged", [{"source": "forecast"}, {"forecast_shown_before": False}, {"face_m": 9.9},
                                    {"surface": "condition_report"}])
async def test_client_cannot_send_server_owned_fields(world, forged):
    r = await world.client.post(URL, json=_checkin(**forged), headers=_token("surfer"))
    assert r.status_code == 422
    assert await world.rows() == []


async def test_spot_page_report_is_recorded_as_not_blind(world):
    r = await world.client.post(URL, json=dict(entry_screen="spot_report_modal", ref_id="sr-1", height_bucket="2-3ft",
                                                height_scale="face", set_or_avg="typical"), headers=_token("surfer"))
    assert r.status_code == 200, r.text
    (row,) = await world.rows()
    assert row.forecast_shown_before is True
    assert set(row.flags.split(",")) == {"gps_missing", "no_device", "range_only"}


async def test_hawaii_default_and_override(world):
    r = await world.client.post(URL, json=dict(entry_screen="golive_conditions_modal", ref_id="cr-1", height_value=6,
                                                height_unit="ft", height_scale="hawaiian", set_or_avg="sets",
                                                latitude=PIPE[0], longitude=PIPE[1]), headers=_token("photog"))
    assert r.status_code == 200, r.text
    assert r.json()["scale_default"] == "hawaiian"
    (row,) = await world.rows()
    assert row.face_m == pytest.approx(12 * FT_TO_M, abs=1e-3) and row.scale_overridden is False
    assert (row.exif_check, row.flags) == ("ok", "no_device")  # P2: a row without a device id earns no XP
    assert row.media_sha256 and abs(row.exif_age_s) < 120

    # Face in Hawaii is an override; with a verified photo it is not flagged as unsupported.
    r2 = await world.client.post(URL, json=dict(entry_screen="golive_conditions_modal", ref_id="cr-2", height_value=12,
                                                 height_unit="ft", height_scale="face", set_or_avg="sets",
                                                 latitude=PIPE[0], longitude=PIPE[1]), headers=_token("photog"))
    assert r2.status_code == 200
    second = (await world.rows())[1]
    assert second.scale_overridden is True
    assert "duplicate_media" in second.flags and second.duplicate_of == (await world.rows())[0].id
    assert "scale_override_no_photo" not in second.flags


async def test_scale_override_without_photo_is_flagged(world):
    r = await world.client.post(URL, json=_checkin(height_scale="hawaiian"), headers=_token("surfer"))
    assert r.status_code == 200
    assert "scale_override_no_photo" in (await world.rows())[0].flags


async def test_far_gps_is_flagged_not_refused(world):
    r = await world.client.post(URL, json=_checkin(latitude=NSB[0] + 1.0), headers=_token("surfer"))
    assert r.status_code == 200
    assert "gps_far" in (await world.rows())[0].flags


@pytest.mark.parametrize("ref,status", [("cr-other", 404), ("cr-old", 409), ("nope", 404)])
async def test_parent_must_be_own_and_fresh(world, ref, status):
    r = await world.client.post(URL, json=dict(entry_screen="golive_conditions_modal", ref_id=ref, height_value=3,
                                               height_unit="ft", height_scale="face", set_or_avg="sets"),
                                headers=_token("photog"))
    assert r.status_code == status
    assert await world.rows() == []


async def test_one_observation_per_report(world):
    assert (await world.client.post(URL, json=_checkin(), headers=_token("surfer"))).status_code == 200
    assert (await world.client.post(URL, json=_checkin(), headers=_token("surfer"))).status_code == 409


async def test_condition_report_screen_requires_a_report(world):
    r = await world.client.post(URL, json=dict(entry_screen="golive_conditions_modal", spot_id="pipe", height_value=3,
                                               height_unit="ft", height_scale="face", set_or_avg="sets"),
                                headers=_token("photog"))
    assert r.status_code == 422


async def test_checkin_without_ref_needs_a_real_spot(world):
    bad = await world.client.post(URL, json=_checkin(ref_id=None), headers=_token("surfer"))
    assert bad.status_code == 422
    ok = await world.client.post(URL, json=_checkin(ref_id=None, spot_id="nsb"), headers=_token("surfer"))
    assert ok.status_code == 200


async def test_daily_cap(world, monkeypatch):
    monkeypatch.setattr(observations, "DAILY_CAP", 1)
    assert (await world.client.post(URL, json=_checkin(), headers=_token("surfer"))).status_code == 200
    r = await world.client.post(URL, json=_checkin(ref_id=None, spot_id="nsb"), headers=_token("surfer"))
    assert r.status_code == 429


async def test_legacy_checkin_takes_identity_from_jwt(world):
    async with world.maker() as db:
        await db.execute(CheckIn.__table__.delete())
        await db.commit()
    body = {"spot_id": "nsb", "wave_height": "3ft face, sets"}
    assert (await world.client.post("/api/check-in", json=body, headers=_token("surfer"))).status_code == 200
    forged = await world.client.post("/api/check-in", params={"user_id": "other"}, json=body,
                                     headers=_token("surfer"))
    assert forged.status_code == 403


async def test_legacy_surf_report_takes_identity_from_jwt(world):
    r = await world.client.post("/api/surf-reports", json={"spot_id": "nsb"}, headers=_token("surfer"))
    assert r.status_code == 200 and r.json()["id"]
    forged = await world.client.post("/api/surf-reports", params={"user_id": "other"}, json={"spot_id": "nsb"},
                                     headers=_token("surfer"))
    assert forged.status_code == 403


def test_condition_report_create_requires_jwt_identity():
    import inspect
    from routes.condition_reports import crud
    params = inspect.signature(crud.create_condition_report).parameters
    assert "current_user_id" in params
    assert params["current_user_id"].default.dependency is security.get_current_user_id


async def test_scale_default_endpoint_is_the_servers(world):
    assert (await world.client.get("/api/surf-observations/scale-default/pipe")).json()["scale_default"] == "hawaiian"
    assert (await world.client.get("/api/surf-observations/scale-default/nsb")).json()["scale_default"] == "face"
    assert (await world.client.get("/api/surf-observations/scale-default/nope")).status_code == 404


async def test_server_sets_flow_role_and_keeps_device_time_as_a_claim(world, monkeypatch):
    from services import surf_truth_anchors
    async with world.maker() as db:  # an ACTIVE anchor in the anchors table (no longer an env var)
        await surf_truth_anchors.set_status(db, "photog", "active", "admin-x", "trusted photographer")
        await db.commit()
    skewed = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    r = await world.client.post(URL, json=_checkin(observed_at_device=skewed), headers=_token("surfer"))
    assert r.status_code == 200
    r2 = await world.client.post(URL, json=dict(entry_screen="golive_conditions_modal", ref_id="cr-1", height_value=6,
                                                 height_unit="ft", height_scale="hawaiian", set_or_avg="sets"),
                                 headers=_token("photog"))
    assert r2.status_code == 200
    first, second = await world.rows()
    assert (first.observer_role, second.observer_role) == ("surfer", "anchor")
    assert "device_clock_skew" in first.flags
    assert (first.flow, second.flow) == ("blind_v1", "blind_v1")
    assert first.normalization_version == "norm_v1"
    assert first.observed_at_device is not None and first.received_at > first.observed_at_device.replace(
        tzinfo=first.received_at.tzinfo)


@pytest.mark.parametrize("forged", [{"flow": "legacy_report"}, {"observer_role": "anchor"}])
async def test_client_cannot_claim_flow_or_role(world, forged):
    assert (await world.client.post(URL, json=_checkin(**forged), headers=_token("surfer"))).status_code == 422


async def test_reply_reveals_no_check_verdicts(world):
    r = await world.client.post(URL, json=_checkin(latitude=NSB[0] + 1.0), headers=_token("surfer"))
    assert r.status_code == 200
    assert set(r.json()) == {"id", "height_scale", "scale_default"}  # no flags, face_m or provenance verdicts


async def test_parentless_checkin_observation_is_flagged(world):
    with_parent = await world.client.post(URL, json=_checkin(), headers=_token("surfer"))
    without = await world.client.post(URL, json=_checkin(ref_id=None, spot_id="nsb"), headers=_token("surfer"))
    assert with_parent.status_code == 200 and without.status_code == 200
    first, second = await world.rows()
    assert "no_parent" not in first.flags.split(",")
    assert "no_parent" in second.flags.split(",") and second.ref_id is None


async def test_client_build_is_stored_and_shape_checked(world):
    assert (await world.client.post(URL, json=_checkin(client_build="a1b2c3d"), headers=_token("surfer"))).status_code == 200
    assert (await world.rows())[0].client_build == "a1b2c3d"
    bad = await world.client.post(URL, json=_checkin(ref_id=None, spot_id="nsb", client_build="x; drop"),
                                  headers=_token("surfer"))
    assert bad.status_code == 200  # a malformed stamp never costs the observation
    second = (await world.rows())[1]
    assert second.client_build is None and "bad_client_build" in second.flags
