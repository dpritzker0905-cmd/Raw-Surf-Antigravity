"""
test_marine_intersect_prefer.py — the min_viewport_frac floor on pick_surf_regional_override.

HISTORY (2026-07-11 eve): apply_marine_intersect_prefer (task #17 first attempt, `6a5f6992`) was
REVERTED same-day — its premise ("manifest regional tiles are fine-resolution") was falsified by
live probes: the FL pilots are 13×9 (0.25°) at every hour and choose_adaptive_resolution floors
the dynamic lane at 0.25° too, so the pass served a coarser-or-equal PARTIAL rect clipped at the
tile edge with no revalidation (a sticky clamped-rectangle regression, user-reported minutes
after deploy). The min_viewport_frac parameter is KEPT (dormant, tested here) for the redesigned
#17 once the fine-grid resolution provenance is mapped.
"""
from collections import namedtuple

from services.weather_pipeline.product_selection import pick_surf_regional_override

Cov = namedtuple("Cov", ["west", "south", "east", "north"])


class Item:
    def __init__(self, name, cov, is_estimated=False):
        self.filename = name
        self.coverage = cov
        self.is_estimated = is_estimated


FL_TILE = Item("gfs_marine_waves_florida_east_coast.json", Cov(-81.88, 27.13, -79.84, 29.15))
GLOBAL = Item("gfs_marine_waves_global.json", Cov(-180.0, -85.0, 180.0, 85.0))
VP_STRADDLE = (-81.88, 27.0, -79.0, 29.15)   # ~0.666 covered by FL_TILE
# FL tile covers only a small slice (<0.6). NARROW on the lng axis (≤ the §0i fullcover span):
# the original 5.4°-wide shape now falls to the WIDE-REQUEST near-full-cover rule (2026-07-15,
# the user's z7.02 dead-strip class) regardless of the frac floor — these tests exercise the
# FRAC FLOOR mechanics, so the viewport must stay in the narrow class where the floor decides.
VP_MINORITY = (-80.4, 27.0, -76.5, 29.15)


def _cands(*items):
    return [(i, 0.0) for i in items]


class TestMinViewportFracFloor:
    def test_straddling_viewport_passes_the_060_floor(self):
        item = pick_surf_regional_override(
            _cands(FL_TILE, GLOBAL), [], *VP_STRADDLE, min_viewport_frac=0.6)
        assert item is FL_TILE

    def test_minority_coverage_fails_the_floor(self):
        item = pick_surf_regional_override(
            _cands(FL_TILE, GLOBAL), [], *VP_MINORITY, min_viewport_frac=0.6)
        assert item is None

    def test_zero_floor_keeps_surf_behavior_any_overlap(self):
        item = pick_surf_regional_override(
            _cands(FL_TILE, GLOBAL), [], *VP_MINORITY, min_viewport_frac=0.0)
        assert item is FL_TILE

    def test_default_is_zero_floor(self):
        # The surf lane calls without the param — byte-identical legacy behavior.
        item = pick_surf_regional_override(_cands(FL_TILE, GLOBAL), [], *VP_MINORITY)
        assert item is FL_TILE

    def test_global_products_never_win(self):
        item = pick_surf_regional_override(
            _cands(GLOBAL), [], *VP_STRADDLE, min_viewport_frac=0.6)
        assert item is None
