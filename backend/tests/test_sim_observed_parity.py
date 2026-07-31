"""The sim checks its QUALITY against the app, not just its HEIGHT.

`services/weather_pipeline/sim_observed.py`. The parity block reported the served breaking height
and was silent on the score — half the answer unverified, and the half where the composition keeps
drifting. Wiring it found a live divergence immediately: Moss Landing served 83.9 `good` against the
sim's 95.9 `epic`, heights agreeing to 0.59%, because the OBSERVATION GATE runs at the three glyph
surfaces and at neither of the two a surfer reads as text.

The rules that must not quietly go wrong:
  1. ★ The gate is detected from the PAYLOAD's own evidence (`raw_score` beside `score`), never from
     a local env read. `RATING_OBS_GATE` has a value PER LANE — '1' on Render, unset in this
     process — so a local read would confidently describe the wrong lane.
  2. It must FAIL OPEN. A self-check that can break the forecast it annotates is worse than no
     self-check, and a hang is worse still: an MCP client reports a timeout indistinguishably from
     "the sim is broken".
  3. It must never re-derive the gate. `confirm` comes from cross-model agreement over the whole
     precomputed blob plus fresh reports; one spot on one model cannot reconstruct it, and a guess
     would be a second opinion wearing the app's clothes.
"""
import json
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import sim_observed                       # noqa: E402

# The live Moss Landing payload, 2026-07-31 GFS 13:00Z — the case that motivated the module.
GATED = {"spot": "Moss Landing", "spot_id": "abc", "score": 83.9, "level": "good",
         "raw_score": 95.9, "confirmed": "good", "geometry_readiness": "full",
         "source": "precomputed", "served_valid_time": None, "frame_offset_hours": None}
AGREED = {"spot": "Mavericks", "spot_id": "def", "score": 59.5, "level": "fair_good",
          "raw_score": 59.5, "confirmed": None, "geometry_readiness": "full",
          "source": "precomputed", "served_valid_time": None, "frame_offset_hours": None}


@pytest.fixture(autouse=True)
def clean_cache():
    sim_observed._cache.clear()
    yield
    sim_observed._cache.clear()


# ── score_parity: naming the cause, not just the number ─────────────────────────────────────────

def test_the_gate_is_read_off_the_PAYLOAD_not_off_this_processs_env(monkeypatch):
    """★ The lane trap. `RATING_OBS_GATE` is '1' where the app serves and unset here, so a local
    read would report 'gate off' about a lane that is gating. `raw_score` beside `score` is
    evidence; an env var in the wrong process is not."""
    monkeypatch.delenv("RATING_OBS_GATE", raising=False)
    out = sim_observed.score_parity(95.9, GATED, "epic")
    assert out["observation_gate"]["active_in_serving_lane"] is True

    monkeypatch.setenv("RATING_OBS_GATE", "0")       # the wrong lane says off — must not matter
    assert sim_observed.score_parity(95.9, GATED, "epic")["observation_gate"]["capped_by"] == 12.0


def test_the_gate_explains_the_delta_only_when_the_sim_matches_the_UNGATED_score():
    """A delta that the gate accounts for and a delta the gate does not are different findings. If
    the sim disagreed with the ungated model score too, something else is also wrong and saying
    'that is just the gate' would bury it."""
    explained = sim_observed.score_parity(95.9, GATED, "epic")
    assert explained["matches_ungated_model_score"] is True
    assert explained["delta"] == 12.0 and explained["level_differs"] is True

    # Same gated payload, but the sim's own composition has drifted as well.
    unexplained = sim_observed.score_parity(88.0, GATED, "epic")
    assert unexplained["observation_gate"]["active_in_serving_lane"] is True
    assert unexplained["matches_ungated_model_score"] is False


def test_an_ungated_payload_carries_no_gate_block():
    out = sim_observed.score_parity(59.5, AGREED, "fair_good")
    assert "observation_gate" not in out
    assert out["delta"] == 0.0 and out["level_differs"] is False


def test_a_carried_served_hour_travels_with_the_comparison():
    """`valid_time` echoes what was ASKED FOR and the stale ladder can serve a frame up to 6 h away
    — a parity number across that gap measures the clock, not the composition."""
    stale = dict(AGREED, served_valid_time="2026-07-31T07:00:00Z", frame_offset_hours=-6.0)
    out = sim_observed.score_parity(59.5, stale, "fair_good")
    assert out["served_valid_time"] == "2026-07-31T07:00:00Z"
    assert out["frame_offset_hours"] == -6.0


def test_nothing_to_compare_gives_nothing_rather_than_a_zero():
    assert sim_observed.score_parity(59.5, None, "fair_good") is None
    assert sim_observed.score_parity(59.5, {"score": None}, "fair_good") is None
    assert sim_observed.score_parity(None, AGREED, None) is None


# ── fetch_served_rating: fail open, always ───────────────────────────────────────────────────────

class _Resp:
    def __init__(self, payload):
        self._p = payload

    def read(self):
        return json.dumps(self._p).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _stub(monkeypatch, payload=None, boom=None):
    def fake_urlopen(req, timeout=None):
        if boom is not None:
            raise boom
        return _Resp(payload)
    monkeypatch.setattr(sim_observed.urllib.request, "urlopen", fake_urlopen)


def test_an_unreachable_app_costs_the_block_and_nothing_else(monkeypatch):
    _stub(monkeypatch, boom=OSError("connection refused"))
    assert sim_observed.fetch_served_rating(37.0, -122.0, "2026-07-31T13:00:00Z") is None


def test_a_malformed_response_is_a_miss_not_a_crash(monkeypatch):
    _stub(monkeypatch, payload={"nonsense": True})
    assert sim_observed.fetch_served_rating(37.0, -122.0, "2026-07-31T13:00:00Z") is None


def test_unrated_rows_are_skipped_rather_than_compared_as_zero(monkeypatch):
    _stub(monkeypatch, payload={"source": "live", "spots": [
        {"spot_id": "x", "name": "Unrated", "latitude": 37.0, "longitude": -122.0, "score": None},
    ]})
    assert sim_observed.fetch_served_rating(37.0, -122.0, "2026-07-31T13:00:00Z") is None


def test_the_spot_id_wins_over_mere_proximity(monkeypatch):
    """Two breaks 200 m apart are ordinary on a dense coast. Matching on the id the caller already
    holds is exact; nearest-wins is a guess that gets the neighbour."""
    _stub(monkeypatch, payload={"source": "precomputed", "spots": [
        {"spot_id": "near", "name": "Neighbour", "latitude": 37.0001, "longitude": -122.0,
         "score": 40.0, "level": "poor_fair"},
        {"spot_id": "mine", "name": "Mine", "latitude": 37.02, "longitude": -122.0,
         "score": 70.0, "level": "good"},
    ]})
    got = sim_observed.fetch_served_rating(37.0, -122.0, "t", spot_id="mine")
    assert got["spot"] == "Mine"

    sim_observed._cache.clear()
    nearest = sim_observed.fetch_served_rating(37.0, -122.0, "t")
    assert nearest["spot"] == "Neighbour"


def test_the_kill_switch_restores_the_height_only_behaviour(monkeypatch):
    monkeypatch.setenv("SIM_OBSERVED", "0")
    _stub(monkeypatch, payload={"source": "live", "spots": [
        {"spot_id": "x", "name": "X", "latitude": 37.0, "longitude": -122.0, "score": 50.0}]})
    assert sim_observed.fetch_served_rating(37.0, -122.0, "t") is None


def test_a_miss_is_cached_so_a_dead_app_is_dialled_once_not_every_call(monkeypatch):
    """A self-check that re-dials a dead app on every forecast turns one outage into N timeouts."""
    calls = {"n": 0}

    def fake_urlopen(req, timeout=None):
        calls["n"] += 1
        raise OSError("down")
    monkeypatch.setattr(sim_observed.urllib.request, "urlopen", fake_urlopen)

    for _ in range(4):
        assert sim_observed.fetch_served_rating(37.0, -122.0, "t") is None
    assert calls["n"] == 1


def test_the_cache_is_a_bounded_FIFO(monkeypatch):
    """Bounded so a long scan cannot grow it without limit. ⚠️ FIFO, oldest-first — NOT an LRU; a
    comment in this repo once claimed LRU for a FIFO and cost a session to disprove."""
    monkeypatch.setattr(sim_observed, "CACHE_MAX", 3)
    for i in range(6):
        sim_observed._remember(("k", i), {"i": i})
    assert len(sim_observed._cache) == 3
    assert sim_observed._recall(("k", 0)) is None      # the oldest went first
    assert sim_observed._recall(("k", 5)) == {"i": 5}


def test_an_expired_entry_is_a_miss_not_a_stale_answer(monkeypatch):
    monkeypatch.setattr(sim_observed, "CACHE_TTL_S", -1.0)
    sim_observed._remember(("k",), {"score": 1})
    assert sim_observed._recall(("k",)) is None
