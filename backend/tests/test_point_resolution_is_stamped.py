"""WS-CAN-0014 — `resolution` is declared on the point response and must actually be sent.

THE DEFECT: `NormalizedPointResponse.resolution` has existed since the schema was written and was
NEVER populated. Measured live 2026-08-13 against production, four geographies at one fixed
valid_time: `resolution: null` on all four, INCLUDING two `inside_regional_tile` responses where
the spacing is known to the resolver (audit 12.1, LV-05).

The consumer half shipped anyway — `backendWeatherServiceClientDiag.js:203-210` derives resolution
from served grid bounds and labels it `resolutionSource`, and TruthOverlay's `COARSE n GRID` /
`RESOLUTION UNKNOWN` provenance states depend on that derivation. A good fallback and a bad
permanent contract.

★ 0.0 IS NOT A RESOLUTION. `deduce_grid_resolution` returns 0.0 for "could not tell"; emitting that
would be a fabricated 0-degree grid — the same measure-or-refuse rule as WS-CAN-0010/0063.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest                                                            # noqa: E402
from services.weather_pipeline.sampler import (                          # noqa: E402
    deduce_grid_resolution, resolution_or_none,
)

SAMPLER_SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "services", "weather_pipeline", "sampler.py",
)


class _V:
    def __init__(self, lat, lng):
        self.lat, self.lng = lat, lng


class _G:
    def __init__(self, vectors):
        self.vectors = vectors


def _grid(step, n=3):
    return _G([_V(round(step * i, 4), round(step * j, 4)) for i in range(n) for j in range(n)])


def test_a_real_spacing_is_deduced_and_survives_to_the_wire():
    assert deduce_grid_resolution(_grid(0.25)) == pytest.approx(0.25)
    assert resolution_or_none(_grid(0.25)) == pytest.approx(0.25)


def test_a_coarse_grid_is_distinguishable_from_a_tiled_one():
    # The whole product point of the field: 0.25 tiled vs 10-degree resample must not read alike.
    assert resolution_or_none(_grid(10.0)) == pytest.approx(10.0)
    assert resolution_or_none(_grid(0.25)) != resolution_or_none(_grid(10.0))


def test_undeducible_reaches_the_wire_as_None_NOT_as_a_zero_degree_grid():
    assert deduce_grid_resolution(None) == 0.0            # the internal "could not tell"
    assert resolution_or_none(None) is None               # ...must not be emitted as 0.0
    assert resolution_or_none(_G([])) is None
    assert resolution_or_none(_G([_V(1.0, 2.0)])) is None  # single vector: no spacing exists


def test_the_two_producers_are_one_producer():
    """PointResolutionService kept its own copy of this arithmetic; it must now delegate."""
    from services.weather_pipeline.point_resolution import PointResolutionService
    g = _grid(0.5)
    assert PointResolutionService.deduce_grid_resolution(g) == deduce_grid_resolution(g)


def test_EVERY_point_response_construction_in_the_sampler_stamps_resolution():
    """⛔ The guard that stops the fourth construction site shipping unstamped.

    Three sites exist today (out-of-bounds, unavailable, and the sampled path). Stamping them by
    hand is exactly how a fourth gets added without one, which is how this field stayed null for
    months. POSITIVE CONTROL FIRST: assert the constructions are still findable, or a rename makes
    every assertion below vacuous — `"x" in src` is never a real needle.
    """
    src = open(SAMPLER_SRC, encoding="utf-8").read()
    constructions = re.findall(r"NormalizedPointResponse\(\s*\n(\s*)(\w+)=", src)
    assert len(constructions) >= 3, (
        f"expected at least 3 NormalizedPointResponse constructions, found {len(constructions)} — "
        "the guard has lost its subject and would pass vacuously")
    # Every construction's FIRST keyword must be `resolution`, which is how it is stamped.
    first_kwargs = [c[1] for c in constructions]
    assert set(first_kwargs) == {"resolution"}, (
        f"a NormalizedPointResponse is built without stamping resolution first: {first_kwargs}")
