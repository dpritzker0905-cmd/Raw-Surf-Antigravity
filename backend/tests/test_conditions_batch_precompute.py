"""/conditions/batch serves from the precomputed frames — the WS-CAN-0064 architectural repair.

THE MEASUREMENTS THAT DECIDED THIS DESIGN (all recorded before a line was written):
  * production is PERFECTLY LINEAR at 0.380 s/spot (n=2..87, stdev 0.031), crossing 10 s at ~26
    spots — 11/11 sampled calls in two consecutive audits exceeded 10 s;
  * the declared concurrency of 6 buys nothing, and the owner's Render env read (WS-CAN-0040)
    shows SPOT_RATINGS_CONCURRENCY is NOT SET — the code default runs, so the serialisation is
    the 1-CPU box, not a mis-set knob: the repair is ARCHITECTURAL, not tuning;
  * /spot-ratings survived the same box only via its precompute ladder (melt hardening, 07-13);
    /conditions/batch was the one rating consumer with no such lane.

THE LANE: per-spot, frame-first. A fresh (or bounded-stale) precomputed frame answers every spot
it can — surf_height_m/period_s were already in the frame; swell_from_deg and offshore_hs_m are
now ALWAYS-ON frame fields (two rounded floats; the instrument-tax rule is honoured by measuring
the blob delta below) — and anything the frame cannot answer (unknown id, old-blob entry without
the new fields, stale beyond bound, kill switch) falls through to the EXACT live path that served
before. The per-spot payload is BYTE-SHAPE IDENTICAL either way (six keys; the frozen frontend
spreads these entries — WS-CAN-0039). Disclosure is additive and top-level only.
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from fastapi import FastAPI                     # noqa: E402
from fastapi.testclient import TestClient       # noqa: E402

import routes.surf_data.conditions as C         # noqa: E402


NOW_HOUR = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


def _frame_spot(sid, h=1.2, tp=10.0, swell=245.0, off=0.9):
    return {"spot_id": sid, "name": f"spot {sid}", "latitude": 33.0, "longitude": -118.0,
            "score": 61.0, "level": "fair_good", "surf_height_m": h, "period_s": tp,
            "swell_from_deg": swell, "offshore_hs_m": off, "tide": None, "why": "w"}


def _blob(spots, valid_time=NOW_HOUR, generated_at="2026-08-15T12:00:00Z"):
    return {"generated_at": generated_at,
            "frames": [{"model": "GFS", "valid_time": valid_time, "spots": spots}]}


class _NoDB:
    """A db double that REFUSES: the frame path must not touch the database at all."""
    async def execute(self, *_a, **_k):
        raise AssertionError("the precomputed path reached the database")


class _FakeSpot:
    def __init__(self, sid):
        self.id = sid
        self.latitude = 33.0
        self.longitude = -118.0


class _DBWith:
    def __init__(self, sids):
        self._sids = sids

    async def execute(self, *_a, **_k):
        sids = self._sids

        class _R:
            def scalars(self):
                class _S:
                    def all(self):
                        return [_FakeSpot(s) for s in sids]
                return _S()
        return _R()


@pytest.fixture
def app_client(monkeypatch):
    """TestClient + the three seams: the blob loader, the live resolver (counted), the db."""
    calls = {"live": []}

    async def fake_resolve(model, lat, lng, forecast_days, spot_id):
        calls["live"].append(spot_id)
        return {"current_conditions": {
            "wave_height_ft": 3.9, "wave_direction": 245.0, "wave_period": 10.0,
            "swell_height_ft": 3.0, "label": "Waist High", "updated_at": "live-ts"}}

    monkeypatch.setattr(C.point_resolution_service, "resolve_spot_conditions", fake_resolve,
                        raising=True)

    def make(blob, db):
        monkeypatch.setattr(C, "_load_ratings_blob", lambda: blob, raising=True)
        app = FastAPI()
        app.include_router(C.router)
        from database import get_db
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app), calls
    return make


# ── the lane ────────────────────────────────────────────────────────────────────────────────────

def test_a_fresh_frame_answers_without_touching_resolver_or_db(app_client, monkeypatch):
    monkeypatch.delenv("CONDITIONS_BATCH_PRECOMPUTED", raising=False)
    client, calls = app_client(_blob([_frame_spot("a"), _frame_spot("b", h=2.0, off=1.5)]), _NoDB())
    r = client.get("/conditions/batch", params={"spot_ids": "a,b"})
    assert r.status_code == 200
    body = r.json()
    assert calls["live"] == [], "a fresh frame hit must cost ZERO live resolutions"
    a = body["conditions"]["a"]
    assert set(a) == {"wave_height_ft", "wave_direction", "wave_period", "swell_height_ft",
                      "label", "updated_at"}, "the per-spot shape is frozen (the client spreads it)"
    assert a["wave_height_ft"] == pytest.approx(round(1.2 * 3.28084, 1))
    assert a["wave_direction"] == 245.0 and a["wave_period"] == 10.0
    assert a["swell_height_ft"] == pytest.approx(round(0.9 * 3.28084, 1))
    assert isinstance(a["label"], str) and a["label"]
    src = body.get("conditions_source")
    assert src and src["precomputed"] == 2 and src["live"] == 0
    assert src["source"] in ("precomputed", "precomputed_stale")


def test_a_spot_the_frame_lacks_falls_through_to_live(app_client, monkeypatch):
    monkeypatch.delenv("CONDITIONS_BATCH_PRECOMPUTED", raising=False)
    client, calls = app_client(_blob([_frame_spot("a")]), _DBWith(["b"]))
    body = client.get("/conditions/batch", params={"spot_ids": "a,b"}).json()
    assert calls["live"] == ["b"], "only the frame-miss may live-resolve"
    assert body["conditions"]["a"]["wave_direction"] == 245.0
    assert body["conditions"]["b"]["updated_at"] == "live-ts"
    assert list(body["conditions"]) == ["a", "b"], "input order is part of the contract"
    assert body["conditions_source"]["precomputed"] == 1
    assert body["conditions_source"]["live"] == 1


def test_an_old_blob_entry_without_the_new_fields_goes_live(app_client, monkeypatch):
    """Rollout safety in BOTH orders: a deployed route against a pre-upgrade blob must fall
    through per spot, never serve a partial six-key dict."""
    monkeypatch.delenv("CONDITIONS_BATCH_PRECOMPUTED", raising=False)
    old = _frame_spot("a")
    del old["swell_from_deg"], old["offshore_hs_m"]      # the pre-WS-CAN-0064 frame shape
    client, calls = app_client(_blob([old]), _DBWith(["a"]))
    body = client.get("/conditions/batch", params={"spot_ids": "a"}).json()
    assert calls["live"] == ["a"]
    assert body["conditions"]["a"]["updated_at"] == "live-ts"


def test_the_kill_switch_restores_the_live_path(app_client, monkeypatch):
    monkeypatch.setenv("CONDITIONS_BATCH_PRECOMPUTED", "0")
    client, calls = app_client(_blob([_frame_spot("a")]), _DBWith(["a"]))
    body = client.get("/conditions/batch", params={"spot_ids": "a"}).json()
    assert calls["live"] == ["a"], "the switch must genuinely disable the lane"
    assert "conditions_source" not in body, "disabled = byte-identical legacy payload"


def test_a_frame_for_another_model_does_not_answer(app_client, monkeypatch):
    monkeypatch.delenv("CONDITIONS_BATCH_PRECOMPUTED", raising=False)
    client, calls = app_client(_blob([_frame_spot("a")]), _DBWith(["a"]))
    body = client.get("/conditions/batch", params={"spot_ids": "a", "model": "EURO"}).json()
    assert calls["live"] == ["a"], "a GFS frame must not answer an EURO request"
    assert body["conditions"]["a"]["updated_at"] == "live-ts"


def test_label_comes_from_the_same_ladder_as_the_live_path():
    """The frame path derives `label` with the SAME public function the live producer uses —
    one ladder, or the two paths drift (the one-composition rule applied to a word)."""
    ft = round(1.2 * 3.28084, 1)
    from services.conditions_labels import get_conditions_label
    assert C._frame_conditions_entry(_frame_spot("a"), "u")["label"] == get_conditions_label(ft)


# ── the frame carries what the lane needs ───────────────────────────────────────────────────────

def test_rate_one_spot_always_carries_the_two_batch_fields():
    """swell_from_deg and offshore_hs_m move from the 5%-SAMPLED inputs block to ALWAYS-ON —
    without them a frame can never answer the batch shape and the lane above is dead on arrival."""
    import inspect
    from services.weather_pipeline import spot_ratings as SR
    src = inspect.getsource(SR.rate_one_spot) if hasattr(SR, "rate_one_spot") else ""
    # runtime check via the payload builder: build the dict through the real code path
    # with a stub resolver is heavy here; the structural half asserts the keys are emitted
    # UNCONDITIONALLY (not inside the sampled-inputs block).
    assert '"swell_from_deg_out"' not in src, "rename guard: the field name is part of the contract"
    payload_region = src[src.index("return {"):] if "return {" in src else src
    assert '"swell_from_deg"' in payload_region and '"offshore_hs_m"' in payload_region, (
        "the two batch fields are not in rate_one_spot's payload")
    sampled = payload_region[payload_region.index('"inputs"'):] if '"inputs"' in payload_region else ""
    head = payload_region[:payload_region.index('"inputs"')] if '"inputs"' in payload_region else payload_region
    assert '"swell_from_deg"' in head and '"offshore_hs_m"' in head, (
        "the fields exist only inside the SAMPLED inputs block — 95% of frame entries would "
        "lack them and the lane would silently serve ~nothing")


def test_the_blob_tax_of_the_two_fields_is_measured_and_bounded():
    """The tax rule demands the cost be MEASURED against a REALISTIC entry, not a stub — the
    first version of this test used a minimal fixture, read ~18%, and the author's comment
    claimed 2-3%: both wrong, in opposite directions. Against a realistic entry (the observed
    per-spot baseline is ~470 chars, back-derived from the recorded +42.8% full-inputs measure)
    the two fields cost ~8-10%. That is REAL and it is accepted deliberately: these are
    forecast-bearing PRODUCT fields the batch surface serves to users — the tax rule's target is
    INSTRUMENTS taxing the product, and the trade converts the system's worst route (p50 52-59 s,
    11/11 sampled calls over 10 s) into frame reads. Budget 12%; past it, re-justify or intern."""
    def realistic(i, with_new):
        e = {"spot_id": f"s{i}", "name": "Some Beach Break North Jetty", "latitude": 33.61828,
             "longitude": -117.92938, "score": 61.3, "level": "fair_good", "confidence": "medium",
             "surf_height_m": 1.234, "period_s": 10.4, "tide": {"state": "rising",
             "height_m": 0.42}, "why": "chest-high sets holding shape on the mid tide with light "
             "offshore texture, coarse shore detail", "limiter": "swell_exposure",
             "limiter_f": 0.61, "geometry_readiness": "degraded", "run_time": 3,
             "wind_run_time": 4}
        if with_new:
            e["swell_from_deg"] = 245.5
            e["offshore_hs_m"] = 0.912
        return e
    old = len(json.dumps([realistic(i, False) for i in range(200)], separators=(",", ":")))
    new = len(json.dumps([realistic(i, True) for i in range(200)], separators=(",", ":")))
    tax = (new - old) / old
    assert 0.0 < tax < 0.12, f"the two fields cost {tax:.1%} against a realistic entry"
