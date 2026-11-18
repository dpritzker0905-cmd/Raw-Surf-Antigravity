"""The private surf-truth export (T1 P4): pseudonymized rows only, into private storage, failing closed.

Proves: without the pseudonym key nothing is built or written; no raw id, name, device or photo position, photo URL or
converted height leaves; pseudonyms are stable under one key and differ under another; anchor status is the one in
force at the observation time; only blind_v1 rows go out; the upload is create-only into the private bucket; and the
admin route is admin-only, logs every export and answers 503 when it cannot run safely.
"""
import json
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (TosContent, Profile, RoleEnum, SurfObservation, SurfSpot, SurfTruthAdminAction, SurfTruthAnchor,
                    SurfTruthAnchorEvent, SurfTruthConsentEvent)
from routes.surf_data import surf_truth_admin
from services import surf_truth_consent as stc
from services import surf_truth_export as ste

KEY = "k" * 40
NOW = datetime.now(timezone.utc)
SECRET_VALUES = ("ana-profile-id", "Ana Secret Name", "https://cdn.example.test/photo.jpg", "dev-hash-raw")


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


def _obs(oid, user, *, flow="blind_v1", at=NOW - timedelta(hours=1), device="dev-hash-raw", consent=True):
    return SurfObservation(
        id=oid, user_id=user, spot_id="s0", observer_role="surfer", flow=flow, surface="checkin",
        entry_screen="checkin_modal", height_value=4.0, height_unit="ft", height_scale="face", set_or_avg="sets",
        scale_default="face", scale_overridden=False, normalization_version="norm_v1", face_m=1.219,
        face_m_low=1.219, face_m_high=1.219, input_kind="value", source="observed", forecast_shown_before=False,
        received_at=at, latitude=29.0001, longitude=-80.9001, gps_distance_m=12.0, gps_check="ok",
        media_url="https://cdn.example.test/photo.jpg", exif_check="ok", exif_distance_m=40.0, exif_age_s=60.0,
        flags="range_only", device_hash=device, quality_ok=True, xp_status="granted", corroborated=False,
        audit_selected=False, client_build="a1b2c3d", consent_training=consent,
        consent_version=stc.CONSENT_VERSION if consent else None)


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.setenv(ste.KEY_ENV, KEY)
    # the export mechanics, not the draft placeholders, are under test (see test_a_draft_wording_exports_nothing)
    monkeypatch.setattr(stc, "PLACEHOLDERS", ())
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, TosContent, SurfSpot, SurfObservation, SurfTruthAnchor, SurfTruthAnchorEvent, SurfTruthAdminAction,
                      SurfTruthConsentEvent):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(Profile(id="boss", user_id="boss", email="b@example.invalid", full_name="Boss", role=RoleEnum.SURFER,
                       is_admin=True))
        db.add(Profile(id="ana-profile-id", user_id="a", email="a@example.invalid", full_name="Ana Secret Name",
                       role=RoleEnum.SURFER))
        db.add(SurfSpot(id="s0", name="Pier", latitude=29.0, longitude=-80.9, country="USA", state_province="Florida"))
        db.add_all([_obs("o1", "ana-profile-id", at=NOW - timedelta(hours=3)), _obs("o2", "ana-profile-id"),
                    _obs("o3", "ana-profile-id", flow="legacy_report")])
        # Ana opted in before any of her reports (P3: only consented rows are exported)
        db.add(SurfTruthConsentEvent(profile_id="ana-profile-id", granted=True, version=stc.CONSENT_VERSION,
                                     source="blind_height_input", at=NOW - timedelta(hours=5)))
        # appointed BETWEEN o1 and o2: o1 was filed by an ordinary observer, o2 by an active anchor
        db.add(SurfTruthAnchorEvent(profile_id="ana-profile-id", from_status=None, to_status="active",
                                    actor_id="boss", reason="r", at=NOW - timedelta(hours=2)))
        await db.commit()
    app = FastAPI()
    app.include_router(surf_truth_admin.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            yield SimpleNamespace(client=c, maker=maker)
    finally:
        await engine.dispose()


async def _build(world, key=KEY.encode()):
    async with world.maker() as db:
        return await ste.build_export(db, key)


def test_no_key_no_export(monkeypatch):
    monkeypatch.delenv(ste.KEY_ENV, raising=False)
    with pytest.raises(ste.ExportUnavailable):
        ste.export_key()
    monkeypatch.setenv(ste.KEY_ENV, "short")
    with pytest.raises(ste.ExportUnavailable):
        ste.export_key()


async def test_rows_carry_no_identity_position_url_or_converted_height(world):
    rows, manifest = await _build(world)
    assert manifest["rows"] == 2 and all(tuple(r) == ste.FIELDS for r in rows)   # legacy_report row not exported
    text = json.dumps(rows)
    for secret in SECRET_VALUES + ("29.0001", "-80.9001", "face_m"):
        assert secret not in text, secret
    assert rows[0]["height_value"] == 4.0 and rows[0]["flags"] == ["range_only"]  # the raw entry IS exported


async def test_distances_leave_only_as_bands_of_1km_or_wider(world):
    """Schema 2 (legal research 2026-11-18): California's precise geolocation is a 1,850 ft (~564 m) radius. The
    fixture rows sit 12 m (GPS) and 40 m (photo) from a published spot: neither number, nor the 500 m 'ok' check,
    may leave."""
    rows, manifest = await _build(world)
    assert manifest["schema"] == ste.SCHEMA == "raw-surf/surf-truth-export/2"
    assert manifest["distance_bands"] == ["<1 km", "1-2 km", "2-10 km", ">10 km"]
    for r in rows:
        assert (r["gps_distance_band"], r["exif_distance_band"]) == ("<1 km", "<1 km")
        assert "gps_distance_m" not in r and "exif_distance_m" not in r and "gps_check" not in r
    assert '"12.0"' not in json.dumps(rows) and "12.0" not in json.dumps(rows) and "40.0" not in json.dumps(rows)
    # the narrowest band is wider than the legal circle even when the sea takes half the disc
    narrowest = ste.DISTANCE_BANDS[0][0]
    assert (narrowest ** 2) / 2 > 564.0 ** 2


@pytest.mark.parametrize("metres,band", [(None, None), (0.0, "<1 km"), (999.9, "<1 km"), (1000.0, "1-2 km"),
                                          (2000.0, "1-2 km"), (2000.1, "2-10 km"), (10000.0, "2-10 km"),
                                          (10000.1, ">10 km")])
def test_distance_band_edges(metres, band):
    assert ste.distance_band(metres) == band


async def test_a_draft_wording_exports_nothing(world, monkeypatch):
    """While the consent text still has its [COMPANY] / [PRIVACY NOTICE LINK] markers nobody holds a valid grant."""
    monkeypatch.setattr(stc, "PLACEHOLDERS", (stc.COMPANY_PLACEHOLDER, stc.PRIVACY_NOTICE_PLACEHOLDER))
    rows, manifest = await _build(world)
    assert rows == [] and manifest["excluded_no_consent"] == 2


async def test_pseudonyms_are_stable_per_key_and_differ_across_keys(world):
    rows, _ = await _build(world)
    assert rows[0]["observer_key"] == rows[1]["observer_key"] and rows[0]["row_key"] != rows[1]["row_key"]
    other, _ = await _build(world, key=b"z" * 40)
    assert other[0]["observer_key"] != rows[0]["observer_key"]


async def test_anchor_status_is_the_one_in_force_at_the_observation(world):
    rows, _ = await _build(world)
    by_time = sorted(rows, key=lambda r: r["received_at"])
    assert [r["anchor_status_at_obs"] for r in by_time] == [None, "active"]


async def test_upload_is_create_only_into_the_private_bucket(monkeypatch):
    sent = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, content=None):
            sent.append((url, headers, content))
            return SimpleNamespace(status_code=200)

    monkeypatch.setenv("SUPABASE_URL", "https://project.example.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-key")
    monkeypatch.setattr(ste.httpx, "AsyncClient", FakeClient)
    out = await ste.write_export([{"row_key": "x"}], {"schema": ste.SCHEMA}, now=datetime(2026, 11, 16, tzinfo=timezone.utc))
    assert out["data_object"].startswith("surf-truth/exports/2026-11-16/") and out["rows"] == 1
    assert all(f"/storage/v1/object/{ste.BUCKET}/surf-truth/exports/" in u for u, _, _ in sent) and len(sent) == 2
    assert all(h["x-upsert"] == "false" for _, h, _ in sent)
    assert ste.BUCKET == "weather-products"


async def test_upload_refusal_raises(monkeypatch):
    class Refuse:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return SimpleNamespace(status_code=409)

    monkeypatch.setenv("SUPABASE_URL", "https://project.example.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-key")
    monkeypatch.setattr(ste.httpx, "AsyncClient", Refuse)
    with pytest.raises(ste.ExportUnavailable):
        await ste.write_export([], {})


async def test_route_is_admin_only_logged_and_fails_closed(world, monkeypatch):
    async def fake_write(rows, manifest, now=None):
        return {"run_id": "run123", "data_object": "surf-truth/exports/x.jsonl", "manifest_object": "m", "rows": len(rows)}
    monkeypatch.setattr(ste, "write_export", fake_write)
    assert (await world.client.post("/api/admin/surf-truth/export")).status_code == 401
    ok = await world.client.post("/api/admin/surf-truth/export", headers=_token("boss"))
    assert ok.status_code == 200 and ok.json()["rows"] == 2
    monkeypatch.delenv(ste.KEY_ENV)
    refused = await world.client.post("/api/admin/surf-truth/export", headers=_token("boss"))
    assert refused.status_code == 503
    async with world.maker() as db:
        log = (await db.execute(select(SurfTruthAdminAction))).scalars().all()
    assert [(a.action, a.target_id) for a in log] == [("export", "run123")]   # the refused one logged nothing


async def test_received_at_is_rounded_to_the_minute_and_the_key_is_fingerprinted(world):
    rows, manifest = await _build(world)
    for r in rows:
        stamp = datetime.fromisoformat(r["received_at"])
        assert stamp.second == 0 and stamp.microsecond == 0
    _, other = await _build(world, key=b"z" * 40)
    assert manifest["received_at_resolution"] == "minute"
    assert manifest["key_fingerprint"] != other["key_fingerprint"] and KEY not in json.dumps(manifest)


async def test_since_limits_the_export(world):
    async with world.maker() as db:
        rows, manifest = await ste.build_export(db, KEY.encode(), since=NOW - timedelta(hours=2))
    assert manifest["rows"] == 1 and len(rows) == 1


def test_status_lookup_uses_each_profiles_own_history():
    t0 = datetime(2026, 11, 16, 10, tzinfo=timezone.utc)
    events = [SurfTruthAnchorEvent(profile_id="a", to_status="probation", at=t0),
              SurfTruthAnchorEvent(profile_id="b", to_status="active", at=t0),
              SurfTruthAnchorEvent(profile_id="a", to_status="active", at=t0 + timedelta(hours=2))]
    index = ste.index_events(events)
    assert ste.anchor_status_at(index, "a", t0 - timedelta(minutes=1)) is None
    assert ste.anchor_status_at(index, "a", t0 + timedelta(hours=1)) == "probation"
    assert ste.anchor_status_at(index, "a", t0 + timedelta(hours=3)) == "active"
    assert ste.anchor_status_at(index, "c", t0 + timedelta(hours=3)) is None


async def test_export_needs_consent_when_received_and_at_export(world):
    """P3: a row leaves only if its observer had opted in when it was made AND is still opted in now."""
    async with world.maker() as db:
        db.add(Profile(id="ben", user_id="b", email="ben@example.invalid", full_name="Ben", role=RoleEnum.SURFER))
        db.add(Profile(id="cy", user_id="c", email="cy@example.invalid", full_name="Cy", role=RoleEnum.SURFER))
        db.add_all([_obs("b1", "ben", consent=False),          # made while Ben had not opted in
                    _obs("c1", "cy")])                         # made while Cy had opted in...
        db.add(SurfTruthConsentEvent(profile_id="ben", granted=True, version=stc.CONSENT_VERSION,
                                     source="settings", at=NOW))        # Ben opts in AFTER his report
        db.add(SurfTruthConsentEvent(profile_id="cy", granted=True, version=stc.CONSENT_VERSION,
                                     source="blind_height_input", at=NOW - timedelta(hours=4)))
        db.add(SurfTruthConsentEvent(profile_id="cy", granted=False, version=stc.CONSENT_VERSION,
                                     source="settings", at=NOW - timedelta(minutes=5)))   # ...then withdrew
        await db.commit()
    rows, manifest = await _build(world)
    observers = {r["observer_key"] for r in rows}
    assert observers == {ste.pseudonym(KEY.encode(), "observer", "ana-profile-id")}       # only Ana's rows
    assert manifest["rows"] == 2 and manifest["excluded_no_consent"] == 2
    assert "consent_rule" in manifest
