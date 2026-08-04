"""`/api/conditions/{spot_id}` served TWO DIFFERENT QUANTITIES UNDER ONE FIELD NAME.

MASTER AUDIT 1.0 §3. The route's `current.wave_height_ft` goes through the production chain
(`spot_conditions._breaking_ft` -> `estimate_surf_at`, geometry-corrected). Its `forecast[]` array
did not: it re-fetched a raw point and did `height * 3.28084`, i.e. the OFFSHORE significant wave
height, under the SAME field name, in the SAME payload, with `get_conditions_label` applied to it.

MEASURED LIVE on the shipped endpoint, 2026-08-03:

    spot              current (breaking)   forecast[0] (raw offshore)   labels
    Sebastian Inlet        2.90 ft               1.10 ft  (0.38x)      Knee High | ANKLE HIGH
    Cocoa Beach Pier       2.20 ft               1.40 ft  (0.64x)      Knee High | Ankle High
    Trestles               3.20 ft               2.20 ft  (0.69x)      Waist High | Knee High
    Mavericks              4.80 ft               5.20 ft  (1.08x)      Chest High | HEAD HIGH

⭐ SIGNED BOTH WAYS — 0.38x to 1.08x — so no constant could have reconciled them, which is exactly
why CLAUDE.md's ONE FORECAST COMPOSITION rule says the geometry is the only thing that can.
⭐⭐ AND THE LABELS DISAGREE WITH THEMSELVES: a user reads "Knee High" now and "Ankle High" for the
very next hour, with nothing having changed in the sea.

★★★ THE PROHIBITION IS LITERAL: "Do not add a second forecast path 'just for this screen'." A
CORRECT producer already existed — `resolve_spot_conditions` builds a geometry-corrected forecast
list (geometry resolved ONCE, `_breaking_ft` per frame, `offshore_height_ft` named separately) — and
the route discarded it to build its own.

⚠️ A SECOND, SEPARATE DEFECT found while measuring and NOT fixed here: the route also called
`provider.fetch_point` DIRECTLY instead of the resolution chain, and that direct call returns
literal 0.0 for every hour at Pipeline and Jeffreys Bay while `current` reads 3.9 ft and 6.8 ft at
the same coordinates. Wrong SOURCE, not just wrong quantity. Fixing the quantity cannot fix that;
it is recorded rather than folded in silently.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.spot_conditions import (  # noqa: E402
    M_TO_FT, _breaking_ft, hourly_breaking_forecast,
)
from services.weather_pipeline.surf_point import resolve_surf_geometry  # noqa: E402

# Sebastian Inlet — the measured 0.38x case, and a shoaling site so breaking > offshore.
LAT, LNG = 27.8608, -80.4472


def _hourly(heights, periods=None, dirs=None, n=None):
    n = n if n is not None else len(heights)
    return {
        "time": [f"2026-08-03T{h:02d}:00" for h in range(n)],
        "wave_height": heights,
        "wave_period": periods if periods is not None else [9.0] * n,
        "wave_direction": dirs if dirs is not None else [85.0] * n,
    }


def test_the_hourly_row_carries_the_BREAKING_height_not_the_offshore_one():
    """Pinned against the COMPOSITION, not a magic number: the row must equal what `_breaking_ft`
    produces for that hour — the same helper `current` uses."""
    geom = resolve_surf_geometry(LAT, LNG)
    rows = hourly_breaking_forecast(LAT, LNG, _hourly([1.0, 1.2]), geom, limit=2)
    assert len(rows) == 2

    expect_ft, expect_regime = _breaking_ft(LAT, LNG, 1.0, 9.0, 85.0, geom)
    assert rows[0]["wave_height_ft"] == expect_ft
    assert rows[0]["surf_regime"] == expect_regime

    # ...and it is NOT the raw offshore conversion the route used to serve
    assert rows[0]["wave_height_ft"] != round(1.0 * M_TO_FT, 1), (
        "the row is still the offshore height in feet — the composition was not applied")


def test_the_offshore_height_is_CARRIED_not_discarded():
    """Two quantities, two names. The daily list already does this; the hourly one must too, so the
    number that used to be served under `wave_height_ft` is still available under its true name."""
    geom = resolve_surf_geometry(LAT, LNG)
    row = hourly_breaking_forecast(LAT, LNG, _hourly([1.0]), geom, limit=1)[0]
    assert row["offshore_height_ft"] == round(1.0 * M_TO_FT, 1)
    assert row["wave_height_ft"] != row["offshore_height_ft"]


def test_a_MISSING_height_is_not_a_flat_sea():
    """⛔ `height * 3.28084 if height else 0` mapped None to a real measurement of 0 ft and then
    LABELLED it. A check that cannot tell 'not sampled' from 'flat' must refuse."""
    geom = resolve_surf_geometry(LAT, LNG)
    rows = hourly_breaking_forecast(LAT, LNG, _hourly([None, 1.0]), geom, limit=2)
    assert rows[0]["wave_height_ft"] is None
    assert rows[0]["label"] is None
    assert rows[0]["status"] == "no_data"
    assert rows[1]["wave_height_ft"] is not None       # the good hour still answers


def test_a_GENUINE_zero_is_still_flat_the_control():
    """THE CONTROL for the test above: refusing on None must not suppress a real flat sea, or the
    fix would trade one lie for another."""
    geom = resolve_surf_geometry(LAT, LNG)
    row = hourly_breaking_forecast(LAT, LNG, _hourly([0.0]), geom, limit=1)[0]
    assert row["wave_height_ft"] == 0.0
    assert row["surf_regime"] == "calm"
    assert row["status"] is None                       # a measured calm is not missing data
    assert row["label"] is not None


def test_geometry_is_resolved_ONCE_not_per_hour():
    """⚠️ CLAUDE.md: 'Resolve geometry ONCE per coordinate and reuse it across forecast hours — the
    correction is arithmetic, not I/O.' The helper takes geometry as a PARAMETER; this asserts it
    never reaches for its own, which is how a per-hour DB/grid hit would creep back in."""
    import services.weather_pipeline.surf_point as SP
    calls = []
    orig = SP.resolve_surf_geometry
    SP.resolve_surf_geometry = lambda *a, **k: (calls.append(a), orig(*a, **k))[1]
    try:
        geom = orig(LAT, LNG)
        calls.clear()
        hourly_breaking_forecast(LAT, LNG, _hourly([1.0] * 6), geom, limit=6)
    finally:
        SP.resolve_surf_geometry = orig
    assert calls == [], f"geometry was re-resolved {len(calls)}x inside the hourly loop"


def test_limit_and_ragged_arrays_do_not_fabricate():
    """Upstream arrays can disagree in length. A short period/direction array must not invent a
    value, and `limit` must not read past the times it has."""
    geom = resolve_surf_geometry(LAT, LNG)
    h = {"time": ["t0", "t1", "t2"], "wave_height": [1.0, 1.1], "wave_period": [9.0],
         "wave_direction": []}
    rows = hourly_breaking_forecast(LAT, LNG, h, geom, limit=6)
    assert len(rows) == 3
    assert rows[2]["wave_height_ft"] is None and rows[2]["status"] == "no_data"
    assert rows[0]["wave_height_ft"] is not None       # period+dir present
    assert rows[1]["wave_height_ft"] is not None       # missing period/dir degrades, never invents


def test_empty_input_yields_no_rows_rather_than_a_zero_row():
    geom = resolve_surf_geometry(LAT, LNG)
    assert hourly_breaking_forecast(LAT, LNG, {}, geom) == []
    assert hourly_breaking_forecast(LAT, LNG, None, geom) == []
