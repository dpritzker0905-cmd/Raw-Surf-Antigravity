"""E#1 — the point endpoint served the per-CELL reference where the glyph used the per-SPOT one.

★★ THE DEFECT, MEASURED RATHER THAN ARGUED. `/api/weather/point` is keyed by a COORDINATE and
carries no spot identity, so it took `grid_size_climatology.reference_for(lat, lng)`. The
justification was a docstring — "band and glyph saturate identically where they overlap" — which is
about the FORMULA (same percentile, min-samples, clamps), **not the VALUES**. A 0.25 deg cell
aggregates many spots. Fitting the reference that reproduces each served score, live, 2026-08-01:

    |cell - spot| reference:  median 21.3%,  max 52.5%,  4 of 10 over 25%
    score impact at the badge: -11.4 to +9.6 points, LEVEL differs at 2 of 6

and it independently reproduced the 25.8% / 53.0% measured in HANDOFF-2026-08-01-E §3. Two
independent measurements of one gap agreeing is what makes it an attribution.

⇒ At a catalogued spot the per-SPOT reference wins — it is the number the glyph rendered beside the
infobox graded with. Away from one the cell value is still right (no glyph to disagree with), so the
fallback is KEPT.

⛔ TWO ROUTES WERE REJECTED, AND THE SECOND IS THE INSTRUCTIVE ONE:
  * a `spot_id` QUERY PARAM — the served number would depend on a caller-supplied key the endpoint
    cannot validate, and threading it needs a file a concurrent session holds uncommitted.
  * PEEKING the resident L2 caches and upgrading only when both happen to be warm. It looked free.
    It is the recorded COVERAGE CLASS: the same coordinate would return 1.86 or 1.931 depending on
    what else had warmed the process — **a served number varying with cache residency, degrading
    silently.** Killed before it was built.
A coordinate index is DETERMINISTIC: the blob either holds a spot within 2 km or it does not.
"""
import math

import pytest

from services.weather_pipeline import spot_size_climatology as SSC

MAV = (37.4915, -122.5083)
VALID_TIME = "2026-08-07T06:00:00Z"


def _point_response():
    """A minimal successful MARINE point — the shape `augment_with_surf` enriches."""
    from datetime import datetime, timezone
    from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
    return NormalizedPointResponse(
        model="EURO", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime(2026, 8, 7, tzinfo=timezone.utc),
        valid_time=datetime(2026, 8, 7, 6, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(
            requested_lat=MAV[0], requested_lng=MAV[1], sampled_lat=MAV[0], sampled_lng=MAV[1],
            speed=2.0, direction=290.0, u=0.4, v=-1.5, period=13.0,
            interpolation_method="exact_match"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800,
    )


def _blob(spots):
    return {"schema_version": SSC.SCHEMA_VERSION, "spots": spots}


def _hist_at(bin_idx, n=40):
    h = SSC.empty_hist()
    h[bin_idx] = n
    return h


@pytest.fixture(autouse=True)
def _clear_memos():
    """⚠️ ASSERTED, not hasattr-guarded. Both memos key on object IDENTITY, and a stale one would
    make a later test read the previous test's index — the recorded silent-no-op trap."""
    assert hasattr(SSC, "_coord_index_memo") and hasattr(SSC, "_ref_map_memo")
    SSC._coord_index_memo["cell"] = (None, [])
    SSC._ref_map_memo["cell"] = (None, {})
    yield
    SSC._coord_index_memo["cell"] = (None, [])
    SSC._ref_map_memo["cell"] = (None, {})


# ── 1. THE PRODUCER carries the coordinate the frames already hold ────────────────────────────

def test_merging_frames_writes_the_coordinate_onto_the_record():
    """`rate_one_spot` already emits latitude/longitude on every frame record, so this is a re-use,
    not a new derivation."""
    frames = [{"spots": [{"spot_id": "s1", "surf_height_m": 1.8,
                          "latitude": MAV[0], "longitude": MAV[1]}]}]
    out = SSC.merge_frames_into_climatology(None, frames)
    rec = out["spots"]["s1"]
    assert rec["lat"] == pytest.approx(MAV[0]) and rec["lng"] == pytest.approx(MAV[1])
    assert rec["n"] > 0, "the histogram must still be built — the coordinate is additive"


def test_a_run_WITHOUT_coordinates_does_not_STRIP_ones_already_stored():
    """⭐ THE SUBTLE ONE. `merge_frames_into_climatology` REBUILDS the record rather than mutating
    it, so anything not explicitly copied is dropped every cycle. A single run whose frames omit
    lat/lng would otherwise silently strip coordinates the blob already had and quietly disable the
    coordinate lane — a regression that looks like nothing at all, because the fallback is silent."""
    first = SSC.merge_frames_into_climatology(
        None, [{"spots": [{"spot_id": "s1", "surf_height_m": 1.8,
                           "latitude": MAV[0], "longitude": MAV[1]}]}])
    assert "lat" in first["spots"]["s1"]
    second = SSC.merge_frames_into_climatology(
        first, [{"spots": [{"spot_id": "s1", "surf_height_m": 1.9}]}])     # no coordinates
    assert second["spots"]["s1"]["lat"] == pytest.approx(MAV[0]), (
        "a coordinate-less run erased the stored coordinate")
    assert second["spots"]["s1"]["lng"] == pytest.approx(MAV[1])


# ── 2. THE ACCESSOR is deterministic, and refuses rather than guessing ────────────────────────

def test_a_coordinate_at_a_catalogued_spot_resolves_that_spot_reference():
    blob = _blob({"s1": {"hist": _hist_at(9), "lat": MAV[0], "lng": MAV[1]}})
    got = SSC.reference_for_coordinate(MAV[0], MAV[1], clim_obj=blob)
    direct = SSC.reference_from_hist(_hist_at(9))
    assert got is not None and got == pytest.approx(direct), (
        "the coordinate lane must return exactly what the spot lane returns — one composition")


def test_the_NEAREST_spot_wins_when_two_are_in_range():
    """A tie-break that picked the first dict key would be arbitrary and order-dependent."""
    near = (MAV[0] + 0.002, MAV[1])          # ~0.22 km
    far = (MAV[0] + 0.015, MAV[1])           # ~1.67 km, still inside 2 km
    blob = _blob({"near": {"hist": _hist_at(4), "lat": near[0], "lng": near[1]},
                  "far": {"hist": _hist_at(20), "lat": far[0], "lng": far[1]}})
    got = SSC.reference_for_coordinate(MAV[0], MAV[1], clim_obj=blob)
    assert got == pytest.approx(SSC.reference_from_hist(_hist_at(4)))


@pytest.mark.parametrize("spots,why", [
    ({}, "empty blob"),
    ({"s1": {"hist": _hist_at(9)}}, "record has no coordinates (written before the key existed)"),
    ({"s1": {"hist": _hist_at(9), "lat": 0.0, "lng": 0.0}}, "nearest spot is far outside 2 km"),
])
def test_it_returns_None_rather_than_guessing(spots, why):
    """★ EVERY None HERE MEANS 'use the cell reference' — the behaviour this lane shipped with. That
    is what lets the change land BEFORE the precompute has written any coordinates: inert until the
    data arrives, never a wrong number in the meantime."""
    assert SSC.reference_for_coordinate(MAV[0], MAV[1], clim_obj=_blob(spots)) is None, why


def test_a_spot_just_OUTSIDE_the_radius_is_refused_and_just_inside_is_accepted():
    """The radius must actually bind. Pinned either side of 2 km rather than at one point, so a
    change to the constant cannot pass by moving in the direction the test does not look."""
    inside = (MAV[0] + 1.7 / 111.0, MAV[1])
    outside = (MAV[0] + 2.6 / 111.0, MAV[1])
    assert SSC.reference_for_coordinate(
        *MAV, clim_obj=_blob({"s": {"hist": _hist_at(9), "lat": inside[0], "lng": inside[1]}}))
    assert SSC.reference_for_coordinate(
        *MAV, clim_obj=_blob({"s": {"hist": _hist_at(9), "lat": outside[0],
                                    "lng": outside[1]}})) is None


def test_the_bounding_box_prefilter_cannot_reject_a_spot_the_haversine_would_accept():
    """⚠️ THE PREFILTER IS AN OPTIMISATION AND MUST NOT CHANGE THE ANSWER. It rejects on latitude
    only (`max_km / 111.0`), which is the WORST case for a degree of latitude — so it can never be
    tighter than the true distance. Pinned at high longitude offset, where degrees of longitude are
    short and a naive symmetric box would have been wrong."""
    # 60 deg N: one degree of longitude is ~55.8 km, so 0.017 deg lng is only ~0.95 km away.
    lat, lng = 60.0, 5.0
    blob = _blob({"s": {"hist": _hist_at(9), "lat": lat, "lng": lng + 0.017}})
    assert SSC._haversine_km(lat, lng, lat, lng + 0.017) < 2.0, "fixture is not inside the radius"
    assert SSC.reference_for_coordinate(lat, lng, clim_obj=blob) is not None, (
        "the latitude prefilter rejected a spot the haversine accepts")


def test_the_index_is_memoised_against_blob_IDENTITY_not_a_timer():
    """Same contract as `_ref_map_memo`: it invalidates exactly when the loader hands over a new
    object, so it can never be staler than the loader."""
    b1 = _blob({"s1": {"hist": _hist_at(9), "lat": MAV[0], "lng": MAV[1]}})
    SSC.reference_for_coordinate(*MAV, clim_obj=b1)
    src, index = SSC._coord_index_memo["cell"]
    assert src is b1 and len(index) == 1
    b2 = _blob({"s1": {"hist": _hist_at(9), "lat": MAV[0], "lng": MAV[1]},
                "s2": {"hist": _hist_at(3), "lat": 10.0, "lng": 10.0}})
    SSC.reference_for_coordinate(*MAV, clim_obj=b2)
    src2, index2 = SSC._coord_index_memo["cell"]
    assert src2 is b2 and len(index2) == 2, "a new object did not rebuild the index"


# ── 3. THE CONSUMER prefers spot, falls back to cell — and NEVER to the global curve ──────────

@pytest.mark.asyncio
async def test_the_point_lane_prefers_the_spot_reference_and_falls_back_to_the_cell(monkeypatch):
    """⭐ REWRITTEN 2026-08-07 FROM A SOURCE ASSERTION TO AN EXECUTION ONE.

    It used to `inspect.getsource` the augment block and `str.index` for
    `reference_for(load_grid_size_climatology_l2_cached(), lat, lng)`, on the stated grounds that
    executing the lane was too expensive. That is the `"x" in src` shape this repo has been bitten
    by before: when the expression was legitimately restructured — to move the loader off the event
    loop while KEEPING its short-circuit — the substring vanished and the test failed on a change
    that altered no behaviour whatsoever. A guard that breaks on formatting is a guard on formatting.

    Executing it is what the test claimed to want and is barely harder. It now pins BOTH halves of
    the precedence AND the short-circuit, which the source scan could never see:
      spot hit  -> that value is served AND the cell loader is never called (no round trip)
      spot miss -> the cell value is served (never None, which would drop the badge to the GLOBAL
                   1.2 m curve — the much larger defect this whole arc closed)
    """
    from services.weather_pipeline import point_surf_augment as PSA
    from services.weather_pipeline import grid_size_climatology as GSC
    from services.weather_pipeline import spot_size_climatology as SSC

    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    loader_calls = []
    monkeypatch.setattr(GSC, "load_grid_size_climatology_l2_cached",
                        lambda *a, **k: (loader_calls.append(1), {"cells": {}})[1])
    monkeypatch.setattr(GSC, "reference_for", lambda clim, la, ln: 2.22)

    async def _no_parts(*a, **k):
        return None

    # 1. SPOT HIT — the spot value wins and the cell loader is never touched.
    monkeypatch.setattr(SSC, "reference_for_coordinate", lambda la, ln, **k: 1.11)
    resp = await PSA.augment_with_surf(_point_response(), "EURO", "marine", "waves",
                                       MAV[0], MAV[1], VALID_TIME, _no_parts)
    assert resp.reference_size_m == 1.11, "the SPOT reference must win when it exists"
    assert loader_calls == [], (
        "the cell climatology was loaded even though the spot reference answered — the `or` "
        "short-circuit is gone, so every point now pays a possible 10 s round trip")

    # 2. SPOT MISS — falls through to the cell, never to None.
    monkeypatch.setattr(SSC, "reference_for_coordinate", lambda la, ln, **k: None)
    resp = await PSA.augment_with_surf(_point_response(), "EURO", "marine", "waves",
                                       MAV[0], MAV[1], VALID_TIME, _no_parts)
    assert resp.reference_size_m == 2.22, "a spot miss must reach the CELL value, never None"
    assert loader_calls == [1], "the cell loader should have run exactly once on the miss"


def test_both_symbols_the_point_lane_imports_actually_exist():
    """⚠️ THE RECORDED LANDMINE, verbatim: a first pass imported a name `spot_size_climatology` does
    not have, and the ImportError would have been swallowed by that block's broad `except`, leaving
    the badge silently on the wrong curve with the fix apparently shipped. Fail-open hides its own
    failure, so verify the symbols exist rather than trusting the import line."""
    from services.weather_pipeline.grid_size_climatology import reference_for  # noqa: F401
    from services.weather_pipeline.spot_size_climatology import (  # noqa: F401
        reference_for_coordinate)
    assert callable(SSC.reference_for_coordinate)
    assert not hasattr(SSC, "reference_for"), (
        "spot_size_climatology gained a `reference_for` — the point lane imports `reference_for` "
        "from grid_size_climatology, and two same-named symbols across the two blobs is exactly "
        "how the wrong one gets imported")
