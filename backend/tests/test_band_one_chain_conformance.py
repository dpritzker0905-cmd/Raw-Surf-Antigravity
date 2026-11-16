"""G1 (rating band SOTA lane, pre-registered 2026-11-15 in docs/weather-program/log/2026-11-15-claude-rating-band-sota.md):
the map's rating BAND goes through the ONE FORECAST COMPOSITION chain.

For coastal cells on the 0.25-deg lattice (the lattice every rated bundle and the client mosaic use), the band's score from
`surf_rating.rating_transform_grid` (with the production depth / coastal / width / shore-normal functions, exactly as
`grid_resolver_surf.apply_surf_overlay` passes them) must equal the chain composed by hand:
    geometry = surf_point.resolve_surf_geometry(lat, lng)
    height   = surf_point.estimate_surf_at(lat, lng, Hs, Tp, swell_from, geometry=geometry, water_level_m=0.0)
    score    = surf_rating.compute_surf_rating(height, Tp, wind, wind_from, geometry.shore_normal_deg, swell_from,
                                               break_depth_m=geometry.break_depth_m)
(the band's DECLARED scope: no tide, no MOP sea, no partitions, no per-spot reference; band_chain.py). Bar: |delta| <= 0.05
points on >= 99 % of rated cells. NULL control: RATING_BAND_ONE_CHAIN=0 (the bare second path) must FAIL the bar. POSITIVE
control: +5 points injected into one expected cell flags exactly that cell.
"""
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import band_chain, bathymetry  # noqa: E402
from services.weather_pipeline import surf_rating as SR  # noqa: E402
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry  # noqa: E402

pytestmark = pytest.mark.skipif(not bathymetry.is_available(), reason="bundled bathymetry unavailable")

# 0.25-deg nodes just off well-known breaks (Florida, SoCal, Hawaii N shore, Portugal, Bali, J-Bay), plus their neighbours.
CENTRES = [(28.25, -80.5), (33.5, -118.0), (21.75, -158.0), (39.5, -9.5), (-8.75, 115.0), (-34.0, 25.0)]
SEAS = [(1.2, 9.0, 90.0), (2.0, 13.0, 300.0), (3.5, 16.0, 225.0), (0.8, 7.0, 0.0)]
WIND = (6.0, 270.0)
BAR_PTS = 0.05
BAR_SHARE = 0.99


def _cells():
    for la0, ln0 in CENTRES:
        for dla in (-0.25, 0.0, 0.25):
            for dln in (-0.25, 0.0, 0.25):
                yield la0 + dla, ln0 + dln


def _vec(lat, lng, hs, tp, d):
    return SimpleNamespace(lat=lat, lng=lng, speed=hs, period=tp, direction=d, is_valid=True, phys_speed=None, rating_level=None)


def _band(seas):
    out = {}
    for hs, tp, d in seas:
        vecs = [_vec(la, ln, hs, tp, d) for la, ln in _cells()]
        SR.rating_transform_grid(vecs, bathymetry.shelf_depth_at, bathymetry.is_coastal, bathymetry.shelf_width_km,
                                 lambda la, ln: WIND, band_chain.shore_normal_at)
        for v in vecs:
            if v.phys_speed is not None and v.is_valid:
                out[(v.lat, v.lng, hs, tp, d)] = v.speed * 10.0
    return out


def _chain(lat, lng, hs, tp, d):
    g = resolve_surf_geometry(lat, lng)
    h, _ = estimate_surf_at(lat, lng, hs, tp, swell_from_deg=d, geometry=g, water_level_m=0.0)
    s, _ = SR.compute_surf_rating(h, tp, WIND[0], wind_from_deg=WIND[1], shore_normal_deg=g.shore_normal_deg, swell_from_deg=d,
                                  break_depth_m=g.break_depth_m)
    return s


def _share_within(band, inject=None):
    ok = 0
    bad = []
    for key, score in band.items():
        want = _chain(*key)
        if inject and key == inject:
            want += 5.0
        if want is not None and abs(round(want, 4) - score) <= BAR_PTS:
            ok += 1
        else:
            bad.append((key, score, want))
    return ok / max(1, len(band)), bad


@pytest.fixture
def one_chain(monkeypatch):
    monkeypatch.setenv(band_chain.FLAG, "1")
    band_chain.clear_cache()
    yield
    band_chain.clear_cache()


def test_band_cells_equal_the_one_chain(one_chain):
    band = _band(SEAS)
    assert len(band) >= 60, f"too few rated cells to grade: {len(band)}"
    share, bad = _share_within(band)
    assert share >= BAR_SHARE, f"{share:.3f} within {BAR_PTS} pts; first misses {bad[:5]}"


def test_null_control_the_bare_second_path_fails_the_bar(monkeypatch):
    monkeypatch.setenv(band_chain.FLAG, "0")
    band_chain.clear_cache()
    try:
        band = _band(SEAS)
        monkeypatch.setenv(band_chain.FLAG, "1")
        band_chain.clear_cache()
        share, _ = _share_within(band)
        assert share < BAR_SHARE, f"the gate cannot see a second path: bare band agrees on {share:.3f}"
    finally:
        band_chain.clear_cache()


def test_positive_control_one_injected_cell_is_the_one_flagged(one_chain):
    band = _band(SEAS[:1])
    target = sorted(band)[len(band) // 2]
    _, bad = _share_within(band, inject=target)
    assert [b[0] for b in bad] == [target]
