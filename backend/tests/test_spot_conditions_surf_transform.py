"""The SPOT HUB must report the BREAKING height, not the offshore Hs.

MEASURED 2026-07-28 against the live app — the same coordinate and hour, offshore vs breaking:

    Trestles           2.4 ft offshore  ->   4.6 ft breaking   +92.7%
    Teahupo'o          5.0                   7.4               +47.6%
    Cocoa Beach Pier   1.8                   2.6               +41.7%
    Jeffreys Bay      10.3                   8.3               -18.7%

★ The error is signed BOTH ways — shoaling amplifies, a wide shelf damps — so no constant could
correct it and only the geometry can. The hub was showing the offshore number and labelling it with
the size ladder, so "2.4 ft / Waist High" was rendered for chest-high surf.

Same defect class as `cf2efb48` in the weather sim: delegating the FUNCTIONS but not the
COMPOSITION. These pin that the hub now uses the one chain.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.spot_conditions import _breaking_ft, M_TO_FT  # noqa: E402
from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at  # noqa: E402

# A shoaling beach break: Cocoa Beach Pier, where the offshore number under-reads by ~40%.
COCOA = (28.3664, -80.6015)


def test_the_hub_height_equals_the_production_chain_exactly():
    """The whole point: the hub's number must BE the served breaking height, not a second opinion."""
    lat, lng = COCOA
    geo = resolve_surf_geometry(lat, lng)
    for hs, tp, sdir in ((0.55, 9.0, 90.0), (1.2, 12.0, 100.0), (2.5, 16.0, 80.0)):
        expected_m, expected_regime = estimate_surf_at(lat, lng, hs, tp, swell_from_deg=sdir,
                                                      geometry=geo)
        got_ft, got_regime = _breaking_ft(lat, lng, hs, tp, sdir, geo)
        assert got_ft == round(expected_m * M_TO_FT, 1), (hs, tp)
        assert got_regime == expected_regime


def test_the_transform_actually_moves_the_number():
    """A pass-through would satisfy the equality test above while changing nothing, so pin that the
    breaking height genuinely differs from the raw offshore conversion."""
    lat, lng = COCOA
    geo = resolve_surf_geometry(lat, lng)
    hs, tp = 0.55, 9.0
    offshore_ft = round(hs * M_TO_FT, 1)
    breaking_ft, _ = _breaking_ft(lat, lng, hs, tp, 90.0, geo)
    assert breaking_ft != offshore_ft, "the surf transform is a no-op — the hub is still offshore"


def test_flat_is_flat_and_never_crashes():
    for hs in (0.0, None):
        assert _breaking_ft(*COCOA, hs, 10.0, 90.0, None) == (0.0, "calm")


def test_it_fails_OPEN_to_the_offshore_value(monkeypatch):
    """A hub showing a slightly wrong number beats a hub showing nothing — this is an enrichment of
    an already-working read, so a geometry failure must degrade, never raise."""
    import services.weather_pipeline.surf_point as sp

    def boom(*a, **k):
        raise RuntimeError("bathymetry asset unavailable")

    monkeypatch.setattr(sp, "estimate_surf_at", boom)
    ft, regime = _breaking_ft(*COCOA, 1.0, 12.0, 90.0, None)
    assert ft == round(1.0 * M_TO_FT, 1)
    assert regime == "offshore_estimate"      # and it SAYS the number is unimproved


def test_the_kill_switch_is_documented_and_read():
    """SPOT_HUB_SURF_TRANSFORM=0 restores the pre-2026-07-28 offshore behaviour."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "services", "weather_pipeline", "spot_conditions.py"),
               encoding="utf-8").read()
    assert 'os.environ.get("SPOT_HUB_SURF_TRANSFORM", "1") != "0"' in src


@pytest.mark.parametrize("hs,tp", [(0.3, 7.0), (1.0, 11.0), (2.0, 14.0), (4.0, 18.0)])
def test_breaking_height_is_monotonic_in_offshore_height(hs, tp):
    """More swell must never produce less surf at the same spot — the property a hand-rolled
    conversion would not guarantee."""
    lat, lng = COCOA
    geo = resolve_surf_geometry(lat, lng)
    smaller, _ = _breaking_ft(lat, lng, hs, tp, 90.0, geo)
    bigger, _ = _breaking_ft(lat, lng, hs * 1.5, tp, 90.0, geo)
    assert bigger >= smaller, (hs, tp, smaller, bigger)
