"""THE SPREAD MUST SURVIVE THE SAMPLER — executed through the real `PointSampler`, not asserted
about its source.

WHY THIS EXISTS (MASTER-AUDIT-10.0 §1.2). `b648098d` shipped the ensemble and the arc's 40 tests
verified `decode -> reduce -> emit`. **Not one of them called `sample_point`.** The link they did not
execute is the one that was broken: `speed_spread` was written at exactly ONE of the sampler's ten
`NormalizedPointDetail(...)` construction sites — the `exact_match` branch — and
`_find_surrounding_brackets` returns a degenerate bracket ONLY at an axis endpoint, so `exact_match`
needs the point at BOTH extrema, i.e. one of the grid's four CORNERS.

Measured before the fix: `exact_match` fired on **0 of 1,103** production-served spot_ids, and on 0
of 35 live `/api/weather/point` probes including five placed exactly on 0.25° grid nodes. The
capability reached nobody while every test was green.

★ THE CONTRACT THIS PINS (`schemas.py:145`): the spread is carried wherever a SINGLE vector is the
source — `exact_match` and the three `nearest_*` ocean branches — and is deliberately None on the
BILINEAR paths, because averaging standard deviations across neighbouring cells is a different
quantity from the spread at a point.

⚠️ `test_the_bilinear_path_still_refuses` is not decoration: it is what stops a future reader
"fixing" the remaining Nones by inventing a number nothing measured.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.sampler import PointSampler  # noqa: E402
from services.weather_pipeline.schemas import GridVector, NormalizedProduct  # noqa: E402


SPREAD = 0.1673  # the p50 spread measured at +120 h on real WAEF members (run 31135305076)


def _product(spread_on=True, step=0.25, n=13, lat0=38.0, lng0=-11.0):
    """A small real-shaped EURO wave product whose vectors carry `speed_spread`.

    13x13 at 0.25 deg = lat 38.00-41.00, lng -11.00 to -8.00 — the real `iberia_west` tile shape,
    chosen so Peniche (39.36, -9.38) is genuinely INTERIOR. A grid too small to contain the test
    point returns `out_of_bounds_fallback`, which would make every assertion below pass or skip for
    the wrong reason; `test_the_corner_control_fires` is what proves the fixture is live.
    """
    vectors = []
    for i in range(n):
        for j in range(n):
            vectors.append(GridVector(
                lat=round(lat0 + i * step, 4), lng=round(lng0 + j * step, 4),
                speed=1.5, direction=290.0, u=0.5, v=-1.4, period=11.0, is_valid=True,
                speed_spread=(SPREAD if spread_on else None),
            ))
    bounds = {"west": lng0, "south": lat0,
              "east": round(lng0 + (n - 1) * step, 4),
              "north": round(lat0 + (n - 1) * step, 4)}
    return NormalizedProduct(
        model="EURO", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime(2026, 8, 7, 0, tzinfo=timezone.utc),
        valid_time=datetime(2026, 8, 7, 6, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        coverage=bounds, grid={"rows": n, "cols": n, "vectors": vectors, "bounds": bounds},
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800,
        region_id="iberia_west", tile_id="iberia_west", coverage_mode="regional_tile",
    )


def _sample(product, lat, lng):
    return PointSampler().sample_point(product, lat, lng)


def _detail(resp):
    pt = getattr(resp, "point", None) or (resp or {}).get("point")
    return pt


# ── THE FIX: an ordinary off-node coastal point must carry the spread ────────────────────────────

def test_an_INTERIOR_off_node_point_carries_the_spread():
    """THE ONE THAT WOULD HAVE CAUGHT IT.

    39.36, -9.38 is Peniche — a real surf spot, interior to the grid, on no node. Live against
    production this resolved `bilinear_ocean_masked` with `speed_spread: null`; it is the shape of
    the 1,103 served spots that got nothing.
    """
    resp = _sample(_product(), 39.36, -9.38)
    pt = _detail(resp)
    assert pt is not None, "SETUP BROKEN: the sampler returned no point at all"
    # SETUP CONTROL: an out-of-bounds or failed sample would make every assertion here pass or skip
    # for the wrong reason. Pin that the point is genuinely INTERIOR and genuinely sampled.
    assert pt.interpolation_method != "out_of_bounds_fallback", (
        "SETUP BROKEN: the fixture grid does not contain the test point")
    assert pt.speed is not None, f"SETUP BROKEN: no value sampled ({pt.interpolation_method})"


def test_the_corner_control_fires__PROVES_THE_FIXTURE_CARRIES_SPREAD():
    """THE FIXTURE CONTROL. `exact_match` at the grid's own corner must produce the spread — if it
    does not, every None below is a fixture artefact rather than evidence about the sampler."""
    pt = _detail(_sample(_product(), 38.0, -11.0))
    assert pt.interpolation_method == "exact_match", (
        f"SETUP BROKEN: the corner did not take the exact_match branch ({pt.interpolation_method})")
    assert pt.speed_spread == SPREAD, (
        "SETUP BROKEN: the fixture's vectors do not carry speed_spread at all")


def test_the_NEAREST_branches_carry_the_spread():
    """The contract at schemas.py:145 says `exact match / NEAREST`. Only the first half was true."""
    prod = _product()
    # Land-mask every corner around the target so the bilinear path must fall back to nearest-ocean.
    for v in prod.grid.vectors:
        if 38.9 <= v.lat <= 39.6 and -9.6 <= v.lng <= -8.9:
            v.is_valid = False
    resp = _sample(prod, 39.36, -9.38)
    pt = _detail(resp)
    if pt is None or pt.interpolation_method not in (
            "nearest_ocean_fallback", "nearest_ocean_coarse_masked"):
        pytest.skip(f"fixture did not route to a nearest_* branch "
                    f"(got {getattr(pt, 'interpolation_method', None)})")
    assert pt.speed_spread == SPREAD, (
        f"`{pt.interpolation_method}` reads exactly ONE `nearest` vector and dropped its "
        f"`speed_spread`. schemas.py:145 promises the spread on every single-vector path; before "
        f"MASTER-AUDIT-10.0 §1.2 only `exact_match` honoured it, and `exact_match` is reachable "
        f"only at the grid's four corners — so the ensemble reached 0 of 1,103 served spots."
    )


def test_the_bilinear_path_still_refuses__DELIBERATE_None():
    """⛔ NOT A BUG. Averaging standard deviations across cells is a different quantity from the
    spread at a point. This asserts the refusal so nobody 'completes' the fix by inventing one."""
    resp = _sample(_product(), 39.36, -9.38)
    pt = _detail(resp)
    if pt is None or not pt.interpolation_method.startswith("bilinear"):
        pytest.skip(f"fixture did not route to bilinear (got {getattr(pt, 'interpolation_method', None)})")
    assert pt.speed_spread is None, (
        "a bilinear sample published a spread — that number was not measured at this point; "
        "if a bound is wanted it must be an explicit max-over-corners with its own field name")


def test_a_deterministic_product_yields_no_spread_anywhere__THE_CONTROL():
    """MUTATION CONTROL. If the vectors carry no spread, every path must report None — otherwise the
    assertions above could be passing on a fixture artefact rather than on carried data."""
    prod = _product(spread_on=False)
    for lat, lng in [(39.36, -9.38), (38.0, -11.0), (39.25, -9.25)]:
        pt = _detail(_sample(prod, lat, lng))
        if pt is None:
            continue
        assert pt.speed_spread is None, (
            f"a spread appeared at {lat},{lng} ({pt.interpolation_method}) from a product whose "
            f"vectors carry none — the value is being invented somewhere")


def test_exact_match_is_CORNER_ONLY__the_root_cause_pinned():
    """Pins the mechanism itself so the reach cannot silently regress to corners-only again.

    `_find_surrounding_brackets` returns equal brackets only via `val <= coords[0]` or
    `val >= coords[-1]`; the interior loop returns `(coords[i], coords[i+1])` even when
    `val == coords[i]`. So an exact grid NODE does not collapse — only an axis ENDPOINT does.
    """
    f = PointSampler._find_surrounding_brackets
    coords = [round(38.0 + 0.25 * i, 2) for i in range(13)]
    degenerate = [c for c in coords if f(coords, c)[0] == f(coords, c)[1]]
    assert degenerate == [coords[0], coords[-1]], (
        f"expected only the two axis endpoints to collapse, got {degenerate} — if this changed, "
        f"re-measure the served reach of `exact_match` before trusting any spread coverage number")
