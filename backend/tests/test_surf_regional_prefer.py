"""Unit tests for pick_surf_regional_override — the surf-RATING regional-tile preference.

Root cause it guards (forensically curl-confirmed 2026-06-30): the surf band is a COASTAL feature, but
select_best_candidate ranks purely by viewport-intersection area, so the global coarse product (which
intersects at the FULL viewport area) wins the moment the frontend-padded viewport pokes just past a
regional tile's offshore edge → coarse extent → surf transform skipped → no band. This override re-selects
the overlapping regional tile for surf requests over a non-wide viewport, fixing every narrow coast.
"""
from collections import namedtuple

from services.weather_pipeline.product_selection import pick_surf_regional_override

Cov = namedtuple("Cov", ["west", "south", "east", "north"])
Item = namedtuple("Item", ["filename", "coverage"])

# Florida east-coast pilot tile (the live flagship) and the global coarse conformed product.
FL = Item("gfs_marine_waves_florida_east_coast.json", Cov(-85.0, 24.0, -79.0, 31.0))
GLOBAL = Item("gfs_marine_waves_global_coarse.json", Cov(-180.0, -90.0, 180.0, 90.0))

# Worldwide coastal pilot tiles — the override is region-AGNOSTIC, so the band must work on every coast,
# not just Florida (curl-confirmed: the poke-past-offshore-edge bug reproduces identically on Hawaii and
# East Australia). These lock that globality in as a regression guard.
HAWAII = Item("gfs_marine_waves_hawaii.json", Cov(-161.0, 18.0, -154.0, 23.0))
EAST_AUS = Item("gfs_marine_waves_east_australia.json", Cov(150.0, -38.0, 156.0, -25.0))


def _auth(*items):
    return [(it, 0.0) for it in items]


def test_contained_viewport_returns_regional():
    # A 2° box fully inside the FL tile — regional must win.
    item = pick_surf_regional_override(_auth(FL, GLOBAL), [], -82.0, 26.0, -80.0, 28.0)
    assert item is FL


def test_poke_east_past_offshore_edge_still_returns_regional():
    # The exact failure: a viewport whose east edge (-77) pokes past the FL tile's -79 offshore edge.
    # select_best_candidate would pick GLOBAL here; the override must keep the overlapping FL tile.
    item = pick_surf_regional_override(_auth(FL, GLOBAL), [], -81.0, 26.0, -77.0, 30.0)
    assert item is FL


def test_wide_viewport_returns_none():
    # A continental view (>15°) should keep the honest global field, not a tiny floating band.
    item = pick_surf_regional_override(_auth(FL, GLOBAL), [], -100.0, 10.0, -78.0, 30.0)
    assert item is None


def test_no_regional_overlap_returns_none():
    # Viewport far from any regional tile (mid-Atlantic) → only global overlaps → None (fall through to global).
    item = pick_surf_regional_override(_auth(FL, GLOBAL), [], -50.0, 20.0, -46.0, 24.0)
    assert item is None


def test_global_only_returns_none():
    # No regional candidate at all → None.
    item = pick_surf_regional_override(_auth(GLOBAL), [], -82.0, 26.0, -80.0, 28.0)
    assert item is None


def test_no_bbox_returns_none():
    assert pick_surf_regional_override(_auth(FL, GLOBAL), [], None, None, None, None) is None


def test_prefers_larger_overlap_among_regionals():
    # Two regional tiles; the override picks the one with the larger viewport overlap.
    socal = Item("gfs_marine_waves_us_west_coast_socal.json", Cov(-125.0, 30.0, -115.0, 38.0))
    # Viewport over Florida overlaps FL fully, SoCal not at all.
    item = pick_surf_regional_override(_auth(FL, socal, GLOBAL), [], -82.0, 26.0, -80.0, 28.0)
    assert item is FL


def test_estimated_regional_used_when_only_estimate_overlaps():
    # EURO >day10 estimated regional tiles are valid surf-band sources (better than global coarse).
    est = Item("euro_marine_waves_florida_est.json", Cov(-85.0, 24.0, -79.0, 31.0))
    item = pick_surf_regional_override([], _auth(est), -82.0, 26.0, -80.0, 28.0)
    assert item is est


# ── Globality regression guard: the SAME poke-past-offshore-edge failure on every coast ──
def test_hawaii_poke_east_returns_regional():
    # Big Island east shore; viewport east (-153.3) pokes past the Hawaii tile's -154 offshore edge.
    item = pick_surf_regional_override(_auth(HAWAII, GLOBAL), [], -156.0, 19.0, -153.3, 21.0)
    assert item is HAWAII


def test_east_australia_poke_east_returns_regional():
    # Gold Coast; viewport east (157.2) pokes past the East-Australia tile's 156 offshore edge.
    item = pick_surf_regional_override(_auth(EAST_AUS, GLOBAL), [], 152.0, -29.0, 157.2, -27.0)
    assert item is EAST_AUS


def test_picks_correct_coast_among_many_worldwide_tiles():
    # With every flagship + worldwide tile in the manifest, a Hawaii viewport selects the Hawaii tile.
    pool = _auth(FL, HAWAII, EAST_AUS, GLOBAL)
    assert pick_surf_regional_override(pool, [], -156.0, 19.0, -153.3, 21.0) is HAWAII
    assert pick_surf_regional_override(pool, [], 152.0, -29.0, 157.2, -27.0) is EAST_AUS
    assert pick_surf_regional_override(pool, [], -81.0, 26.0, -77.0, 30.0) is FL
