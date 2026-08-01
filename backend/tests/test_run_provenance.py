"""WHICH FORECAST, not just which hour — the run provenance on a spot rating.

`valid_time` says which HOUR a score describes and nothing about which FORECAST OF that hour. The
two are routinely far apart: the point resolver serves REGIONAL products on independent ingest
cadences, so within ONE (model, valid_time) frame the marine run ranged over 17 hours across four
spots when measured live on 2026-07-31 —

    Pipeline         2026-07-31T14:08:04Z   (gfs_marine_waves_hawaii)
    Sebastian Inlet  2026-07-30T21:40:53Z   (gfs_marine_waves_florida_east_coast)   17 h older

That gap is what made 3 of the 4 sim↔glyph LEVEL differences the health probe found look like
composition bugs. Attributing them cost a forced LIVE re-compute (7.5-8.6 s on a 1-CPU box with a
load-shed cap of 2) because nothing in the payload could say which run it came from. Same class as
products carrying no builder SHA.

Three properties this file pins:
  1. ⚠️ TWO fields, not one. Marine and wind are ingested by different jobs and shared a run at 0 of
     4 spots measured — a single `run_time` would describe half the score's inputs.
  2. ★ INTERNED, not repeated. Raw ISO pairs on every spot measured +87 bytes/spot = +23% on the L2
     object, which every client downloads off the CDN on every map load (~+904 KB). Run times are a
     property of the PRODUCT, and a frame holds ~20 products for ~900 spots.
  3. A frame written before this field must still deserialise, and cost nothing.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import spot_ratings as sr                 # noqa: E402

M1, M2 = "2026-07-31T14:08:04.315721Z", "2026-07-30T21:40:53.747305Z"
W1, W2 = "2026-07-31T14:37:09.478313Z", "2026-07-31T08:10:33.597693Z"


def _spot(sid, lat, lng, run=M1, wind_run=W1, **over):
    s = {"spot_id": sid, "name": sid, "latitude": lat, "longitude": lng, "score": 50.0,
         "level": "fair", "run_time": run, "wind_run_time": wind_run}
    s.update(over)
    return s


def _frame(spots, model="GFS", vt="2026-07-31T15:00:00Z"):
    return {"model": model, "valid_time": vt, "spots": spots}


# ── interning ───────────────────────────────────────────────────────────────────────────────────

def test_interning_round_trips_every_spots_runs():
    frame = _frame([_spot("a", 26.0, -80.0), _spot("b", 21.6, -158.0, run=M2, wind_run=W2)])
    sr.intern_frame_runs(frame)
    got = {s["spot_id"]: s for s in sr.expand_frame_runs(frame["spots"], frame)}
    assert (got["a"]["run_time"], got["a"]["wind_run_time"]) == (M1, W1)
    assert (got["b"]["run_time"], got["b"]["wind_run_time"]) == (M2, W2)


def test_interning_stores_each_distinct_pair_ONCE_which_is_the_whole_point():
    """900 spots share ~20 products. Writing the ISO pair on each measured +23% on an object every
    client downloads per map load — the encoding is the reason this is affordable at all."""
    spots = [_spot(f"s{i}", 26.0 + i * 0.01, -80.0) for i in range(50)]
    spots += [_spot(f"t{i}", 21.6 + i * 0.01, -158.0, run=M2, wind_run=W2) for i in range(50)]
    frame = _frame(spots)
    sr.intern_frame_runs(frame)
    assert len(frame["runs"]) == 2, "two distinct products must intern to two rows, not 100"
    assert all("run_time" not in s and "wind_run_time" not in s for s in frame["spots"])
    assert all(isinstance(s["run"], int) for s in frame["spots"])


def test_interning_is_idempotent_because_the_precompute_re_uploads_at_every_checkpoint():
    """The precompute merge-uploads after EVERY model, so an already-encoded frame comes back
    through. Double-encoding would index into a table of indices."""
    frame = _frame([_spot("a", 26.0, -80.0)])
    sr.intern_frame_runs(frame)
    before = (list(frame["runs"]), dict(frame["spots"][0]))
    sr.intern_frame_runs(frame)
    assert (frame["runs"], frame["spots"][0]) == before


def test_a_frame_with_no_run_information_gains_no_table():
    frame = _frame([_spot("a", 26.0, -80.0, run=None, wind_run=None)])
    sr.intern_frame_runs(frame)
    assert "runs" not in frame
    assert "run" not in frame["spots"][0]


def test_expansion_does_NOT_mutate_the_frame_because_the_L2_object_is_process_wide():
    """⚠️ `select_precomputed` reads the TTL-cached L2 object shared by every later request. Writing
    into it is the one-writer violation this repo has already paid for once."""
    frame = _frame([_spot("a", 26.0, -80.0)])
    sr.intern_frame_runs(frame)
    snapshot = {k: (list(v) if isinstance(v, list) else v) for k, v in frame["spots"][0].items()}
    out = sr.expand_frame_runs(frame["spots"], frame)
    assert out[0]["run_time"] == M1
    assert frame["spots"][0] == snapshot, "the cached frame was edited in place"
    assert "run_time" not in frame["spots"][0]


def test_an_out_of_range_index_expands_to_None_rather_than_raising():
    """A truncated or version-skewed object must cost the field, never the response."""
    frame = _frame([_spot("a", 26.0, -80.0)])
    sr.intern_frame_runs(frame)
    frame["spots"][0]["run"] = 99
    assert sr.expand_frame_runs(frame["spots"], frame)[0]["run_time"] is None


# ── backward compatibility: frames written before this field ────────────────────────────────────

def test_an_OLD_frame_without_runs_passes_through_untouched_and_uncopied():
    old = {"model": "GFS", "valid_time": "t", "spots": [
        {"spot_id": "a", "latitude": 26.0, "longitude": -80.0, "score": 50.0, "level": "fair"}]}
    out = sr.expand_frame_runs(old["spots"], old)
    assert out is old["spots"], "no table -> no work at all"


def test_an_OLD_spot_dict_still_deserialises_into_the_endpoint_model():
    """The contract that lets a stale precomputed object keep serving after this deploy."""
    from routes.weather import SpotRatingItem
    item = SpotRatingItem(**{"spot_id": "a", "latitude": 26.0, "longitude": -80.0,
                             "score": 50.0, "level": "fair"})
    assert item.run_time is None and item.wind_run_time is None


def test_a_NEW_spot_dict_carries_both_runs_into_the_endpoint_model():
    from routes.weather import SpotRatingItem
    item = SpotRatingItem(**_spot("a", 26.0, -80.0))
    assert item.run_time == M1 and item.wind_run_time == W1


def test_select_precomputed_hands_the_endpoint_expanded_runs():
    """End to end through the real selector: interned on write, expanded on read."""
    frame = sr.intern_frame_runs(_frame([_spot("in", 26.0, -80.0),
                                         _spot("far", 40.0, -80.0, run=M2, wind_run=W2)]))
    obj = {"version": sr.SPOT_RATINGS_SCHEMA_VERSION, "frames": [frame]}
    sel = sr.select_precomputed(obj, (-82, 24, -79, 28), "GFS", "2026-07-31T15:00:00Z")
    assert [s["spot_id"] for s in sel] == ["in"]
    assert sel[0]["run_time"] == M1 and sel[0]["wind_run_time"] == W1
    assert "run" not in sel[0], "the wire index must not leak into the API payload"


def test_iso_z_matches_the_shape_the_point_api_serves():
    dt = datetime(2026, 7, 31, 14, 8, 4, 315721, tzinfo=timezone.utc)
    assert sr._iso_z(dt) == "2026-07-31T14:08:04.315721Z"
    assert sr._iso_z(dt.replace(tzinfo=None)) == "2026-07-31T14:08:04.315721Z"   # naive => UTC
    assert sr._iso_z(None) is None
    assert sr._iso_z("already a string") == "already a string"


# ── the probe: attribute WITHOUT paying for a live compute ──────────────────────────────────────

def _row(**over):
    r = {"region": "florida", "spot": "Sebastian Inlet", "spot_id": "s1",
         "lat": 27.86, "lng": -80.447, "level_differs": True, "gate_capped": False,
         "glyph_level": "poor", "sim_level": "poor_fair",
         "served_run_time": M2, "served_wind_run_time": W2,
         "sim_run_time": M1, "sim_wind_run_time": W1}
    r.update(over)
    return r


def _probe_or_skip():
    """`scripts.sim_health_probe` imports `weather_sim_mcp`, which imports fastmcp at MODULE level.

    fastmcp cannot be installed alongside this app's pinned stack — every published release needs
    httpx>=0.28.1 against a pinned 0.27.2, and forcing it in lifts starlette until
    `routes/social` dies on `Router.__init__() got an unexpected keyword argument 'on_startup'`
    (measured in CI 2026-08-01; see backend/requirements-dev.txt). So the CI guard suite runs
    without it, while every dev machine has it and runs these for real.

    ★ DECLARED AS A SKIP, NOT LEFT TO FAIL. The six tests below are the probe's own attribution
    guards and they are worth keeping; but a gate that ships six permanent reds teaches people to
    stop reading it, and the module-level exclusion the guard suite uses cannot see a dependency
    imported inside a fixture. A skip is counted, visible in the run summary, and disappears the
    moment the upstream fix lands.
    """
    # ✅ NO LONGER SKIPPED. `weather_sim_mcp` imports through `sim_mcp_shim`, which stands in
    # for FastMCP when the framework is absent, so the probe imports with or without it and
    # these six guards RUN IN CI instead of being counted as skips. The skip was the right
    # call while importing the probe required a server framework; it is now dead weight, and
    # a permanent skip is a guard nobody notices has stopped guarding.
    import scripts.sim_health_probe as probe
    return probe


@pytest.fixture
def no_network(monkeypatch):
    """⛔ A live compute is 7.5-8.6 s on the 1-CPU serve box, load-shed at 2 concurrent. Avoiding it
    when the payload already answers is the entire point of the run_time field."""
    probe = _probe_or_skip()

    def boom(*a, **k):
        raise AssertionError("attribute() dialled the live path when run_time already answered")
    monkeypatch.setattr(probe, "_fetch", boom)
    return probe


def test_a_run_mismatch_is_attributed_provenance_only_without_dialling(no_network):
    rows = no_network.attribute([_row()])
    assert rows[0]["attribution"] == "provenance_only"
    assert "marine" in rows[0]["attribution_note"]


def test_a_WIND_only_run_mismatch_still_counts_as_provenance(no_network):
    """Marine agreeing is not enough — wind moves the score too, and the two never share a run."""
    rows = no_network.attribute([_row(sim_run_time=M2, sim_wind_run_time=W1,
                                      served_run_time=M2, served_wind_run_time=W2)])
    assert rows[0]["attribution"] == "provenance_only"
    assert "wind" in rows[0]["attribution_note"]


def test_identical_runs_in_both_domains_is_a_COMPOSITION_finding_without_dialling(no_network):
    """Same inputs on both sides, different LEVEL — nothing a live re-compute could add."""
    rows = no_network.attribute([_row(sim_run_time=M2, sim_wind_run_time=W2,
                                      served_run_time=M2, served_wind_run_time=W2)])
    assert rows[0]["attribution"] == "composition"


def test_the_gate_still_wins_before_any_run_comparison(no_network):
    rows = no_network.attribute([_row(gate_capped=True)])
    assert rows[0]["attribution"] == "observation_gate"


def test_a_row_that_agrees_is_never_attributed_at_all(no_network):
    rows = no_network.attribute([_row(level_differs=False)])
    assert "attribution" not in rows[0]


def test_an_OLD_frame_with_no_run_time_falls_back_to_the_live_discriminator(monkeypatch):
    """The fallback must survive: objects written before this field are served for up to 6 h by the
    stale ladder, and much longer if the cron is wedged."""
    probe = _probe_or_skip()
    called = {"n": 0}

    def fake_fetch(url, timeout=None):
        called["n"] += 1
        return {"source": "precomputed", "spots": []}      # not live -> unattributed, but it DIALLED
    monkeypatch.setattr(probe, "_fetch", fake_fetch)

    rows = probe.attribute([_row(served_run_time=None, served_wind_run_time=None)])
    assert called["n"] == 1
    assert rows[0]["attribution"] == "unattributed"
