"""CMP-1 (Fable audit 2026-11-10): the map rating BAND rates through the one chain, so band level == glyph level.

The band (`surf_rating.rating_transform_grid`) used bare `estimate_surf`: no exposure, no break-depth cap, no magnet, and
no `break_depth_m` in the rating. Audit probe: Cocoa 6 m head-on glyph 83.0 good vs band 45.2 fair (-37.8); J-Bay 3 m
+19.5. THE ACCEPTANCE (HANDOFF-FABLE item 3): at every coastal cell holding a rated spot, band level equals glyph level for
the same sea, over the whole spot asset (`shore_normal_asset`: entries + land_present). The "glyph" here is the
reference composition at the spot's coordinate: `estimate_surf_at` on `resolve_surf_geometry`, then `compute_surf_rating`
with the geometry's shore normal and break depth (the quantity #767 / CMP-3 moves `rate_one_spot` onto). Tide and MOP
are held at their band values (eta 0, parametric): the band does not carry them, by design (band_chain docstring).
Every residual is counted by reason; an unexplained one fails.
"""
from types import SimpleNamespace

import pytest

from services.weather_pipeline import band_chain
from services.weather_pipeline import shore_normal_asset as sna
from services.weather_pipeline.bathymetry import is_coastal, shelf_depth_at, shelf_width_km
from services.weather_pipeline.surf_point import chain_shore_normal_at, estimate_surf_at, resolve_surf_geometry
from services.weather_pipeline.surf_rating import compute_surf_rating, rating_transform_grid, score_to_level

SEAS = [(2.5, 13.0, 30.0, 4.0), (6.0, 12.0, 0.0, 2.0), (1.2, 9.0, 70.0, 7.0)]   # (Hs m, Tp s, off-normal deg, wind m/s)


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.delenv("RATING_BAND_ONE_CHAIN", raising=False)
    band_chain.clear_cache()


def _asset_coords():
    if sna._load() is None:
        pytest.skip("shore-normal asset unavailable")
    pts = [(la, ln) for rows in sna._index.values() for (la, ln, *_r) in rows]
    pts += [(la, ln) for rows in (sna._land_index or {}).values() for (la, ln, *_r) in rows]
    return sorted(set(pts))


def _band_one(lat, lng, hs, tp, swell_from, wind):
    v = SimpleNamespace(lat=lat, lng=lng, speed=hs, period=tp, direction=swell_from, u=0.0, v=0.0, is_valid=True,
                        phys_speed=None, rating_level=None)
    rated, masked = rating_transform_grid([v], shelf_depth_at, is_coastal, shelf_width_km, lambda a, b: wind,
                                          chain_shore_normal_at)
    return (v.speed * 10.0, v.rating_level) if rated else ("masked" if masked else None, None)


def _glyph(lat, lng, hs, tp, swell_from, wind):
    g = resolve_surf_geometry(lat, lng)
    h, regime = estimate_surf_at(lat, lng, hs, tp, swell_from_deg=swell_from, geometry=g)
    if h is None or regime in ("open_ocean", "calm", "unknown"):
        return None, None
    return compute_surf_rating(h, tp, wind[0], wind[1], g.shore_normal_deg, swell_from, break_depth_m=g.break_depth_m)


def test_band_level_equals_glyph_level_over_the_spot_asset():
    coords = _asset_coords()
    assert len(coords) > 1000, len(coords)
    equal, residual = 0, {}
    for lat, lng in coords:
        normal = chain_shore_normal_at(lat, lng)
        if normal is None:
            residual["no shore normal (neither path can rate a bearing)"] = residual.get(
                "no shore normal (neither path can rate a bearing)", 0) + 1
            continue
        for hs, tp, off, wspd in SEAS:
            swell_from = (normal + off) % 360
            wind = (wspd, (normal + 180) % 360)               # offshore
            b_score, b_level = _band_one(lat, lng, hs, tp, swell_from, wind)
            g_score, g_level = _glyph(lat, lng, hs, tp, swell_from, wind)
            if b_score == "masked":
                why = "band masks the cell (is_coastal false; the spot's geometry was promoted coastal)"
                if g_level is not None:
                    residual[why] = residual.get(why, 0) + 1
                continue
            if g_level is None and b_level is None:
                equal += 1
                continue
            if b_level == g_level and abs((b_score or 0) - (g_score or 0)) < 0.051:   # band encodes score/10 to 4 dp
                equal += 1
                continue
            residual["UNEXPLAINED"] = residual.get("UNEXPLAINED", 0) + 1
    print(f"\nband vs glyph over {len(coords)} asset coordinates x {len(SEAS)} seas: equal {equal}; residual {residual}")
    assert residual.get("UNEXPLAINED", 0) == 0, residual
    assert equal > 0.9 * len(coords) * len(SEAS) * 0.5, (equal, residual)


@pytest.mark.parametrize("name,lat,lng,hs,tp,off,want_min_move", [
    # The capped spot. The SIGN of the old error depends on the size reference (audit, ref 1.5 m: band 37.8 points
    # LOW; global default, measured here: band 92.0 epic vs glyph 67.1 fair_good, HIGH), so the pin is equality
    # with the glyph plus a material move, never a direction.
    ("Cocoa Beach", 28.3200, -80.6070, 6.0, 12.0, 0.0, 10.0),
])
def test_the_audit_probe_closes(name, lat, lng, hs, tp, off, want_min_move, monkeypatch):
    normal = chain_shore_normal_at(lat, lng)
    if normal is None:
        pytest.skip("geometry assets unavailable")
    wind = (2.0, (normal + 180) % 360)
    on = _band_one(lat, lng, hs, tp, (normal + off) % 360, wind)
    monkeypatch.setenv("RATING_BAND_ONE_CHAIN", "0")
    off_ = _band_one(lat, lng, hs, tp, (normal + off) % 360, wind)
    glyph = _glyph(lat, lng, hs, tp, (normal + off) % 360, wind)
    assert on[1] == glyph[1] and abs(on[0] - glyph[0]) < 0.051, (on, glyph)
    assert abs(on[0] - off_[0]) >= want_min_move, (name, on, off_)


def test_the_kill_switch_is_the_bare_band_byte_for_byte(monkeypatch):
    monkeypatch.setenv("RATING_BAND_ONE_CHAIN", "0")
    calls = []
    monkeypatch.setattr(band_chain, "surf_at", lambda *a, **k: calls.append(a) or (None, "unknown", None))
    v = SimpleNamespace(lat=28.32, lng=-80.607, speed=3.0, period=12.0, direction=90.0, u=0.0, v=0.0, is_valid=True,
                        phys_speed=None, rating_level=None)
    rating_transform_grid([v], shelf_depth_at, is_coastal, shelf_width_km, None, chain_shore_normal_at)
    assert calls == [], "flag off must never touch the chain"


def test_a_chain_failure_leaves_the_cell_unrated_never_the_bare_estimate(monkeypatch):
    monkeypatch.setattr(band_chain, "geometry_at", lambda *a: None)
    v = SimpleNamespace(lat=28.32, lng=-80.607, speed=3.0, period=12.0, direction=90.0, u=0.0, v=0.0, is_valid=True,
                        phys_speed=None, rating_level=None)
    rated, _ = rating_transform_grid([v], shelf_depth_at, is_coastal, shelf_width_km, None, chain_shore_normal_at)
    assert rated == 0 and v.rating_level is None


def test_the_geometry_is_resolved_once_per_cell_across_frames():
    band_chain.clear_cache()
    for _ in range(3):
        band_chain.surf_at(28.32, -80.607, 2.0, 12.0, 90.0)
    info = band_chain._geometry.cache_info()
    assert info.misses == 1 and info.hits == 2


def test_the_band_level_is_the_level_of_its_score():
    """The band stores score/10 and the level separately; they must not disagree."""
    lat, lng = 28.3200, -80.6070
    normal = chain_shore_normal_at(lat, lng)
    if normal is None:
        pytest.skip("geometry assets unavailable")
    score, level = _band_one(lat, lng, 2.5, 13.0, normal, (4.0, (normal + 180) % 360))
    assert level == score_to_level(score)


def test_the_geometry_bearing_is_the_chain_bearing_bit_for_bit():
    """grid_resolver_surf swaps chain_shore_normal_at for band_chain.shore_normal_at under the flag: identical values only."""
    coords = _asset_coords()[::7]
    coords += [(32.0 + 0.0833333 * i, -121.0 + 0.0833333 * j) for i in range(0, 36, 3) for j in range(0, 48, 3)]
    for lat, lng in coords:
        assert band_chain.shore_normal_at(lat, lng) == chain_shore_normal_at(lat, lng), (lat, lng)


def test_the_route_passes_the_geometry_bearing_only_under_the_flag():
    import inspect
    from services.weather_pipeline import grid_resolver_surf
    src = inspect.getsource(grid_resolver_surf)
    assert "_band_chain.shore_normal_at if _band_chain.enabled() else chain_shore_normal_at" in src


def test_a_flag_flip_between_transforms_reaches_the_band(monkeypatch):
    """Verifier (#776 review): the geometry cache was keyed on (lat, lng) for the process's life, so a runtime kill left the
    band on the old normals while the glyph followed. Pipeline's bearing is a hand override (325); with
    SURF_V3_NORMAL_OVERRIDES=0 it falls back to the asset (308.1). Each transform starts with `enabled()`."""
    lat, lng = 21.6650, -158.0533
    band_chain.enabled()
    with_asset = band_chain.shore_normal_at(lat, lng)
    if with_asset is None:
        pytest.skip("geometry assets unavailable")
    assert with_asset == chain_shore_normal_at(lat, lng)
    monkeypatch.setenv("SURF_V3_NORMAL_OVERRIDES", "0")
    band_chain.enabled()                                                  # the next transform
    killed = band_chain.shore_normal_at(lat, lng)
    assert killed == chain_shore_normal_at(lat, lng) and abs(killed - with_asset) > 5.0
    monkeypatch.delenv("SURF_V3_NORMAL_OVERRIDES")
    band_chain.enabled()
    assert band_chain.shore_normal_at(lat, lng) == with_asset


def test_a_runtime_manifest_change_clears_the_geometry_cache(monkeypatch):
    """The guardrail's auto-disable arrives through the manifest, not env: a guarded flag's state change must re-resolve."""
    from services import runtime_flags as rf
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "1")
    monkeypatch.delenv("SURF_TIDE_DEPTH", raising=False)
    doc = {"schema": rf.SCHEMA, "flags": {}}
    rf._reset_for_tests(lambda: doc)
    try:
        band_chain.enabled()
        band_chain.surf_at(28.32, -80.607, 2.0, 12.0, 90.0)
        band_chain.enabled()                                              # same state: the cache survives
        assert band_chain._geometry.cache_info().currsize == 1
        doc["flags"]["SURF_TIDE_DEPTH"] = {"state": "off", "reason": "test"}
        rf._reset_for_tests(lambda: doc)                                  # the manifest re-read the guardrail causes
        band_chain.enabled()
        assert band_chain._geometry.cache_info().currsize == 0
    finally:
        rf._reset_for_tests(None)
