"""
test_marine_intersect_prefer.py — task #17 blend-both cold-arrival (2026-07-11).

The z7.8 remainder: select_best_candidate's should_force_global filter makes a straddling
marine viewport unable to receive the INTERSECTING fine tile (it only intersects ~67%, so the
selection force-filters to global and every lane serves coarse ~0.24° crops). The fix:
apply_marine_intersect_prefer re-selects the intersecting regional tile when it covers
≥ MARINE_INTERSECT_MIN_FRAC (default 0.6 — the engine retention floor) of a non-wide viewport.

Pure selection-function tests (no store/network): pick_surf_regional_override's new
min_viewport_frac floor + the apply_marine_intersect_prefer pass end to end.
"""
from collections import namedtuple

from services.weather_pipeline.product_selection import pick_surf_regional_override
from services.weather_pipeline.grid_resolver_selection import apply_marine_intersect_prefer

Cov = namedtuple("Cov", ["west", "south", "east", "north"])


class Item:
    def __init__(self, name, cov, is_estimated=False):
        self.filename = name
        self.coverage = cov
        self.is_estimated = is_estimated


# The live Sebastian geometry (4f60c196 forensics): florida_east_coast tile vs a viewport poking
# ~1° past its east edge — intersection 2.04°×2.02° over a 2.88°×2.15° viewport ≈ 0.666.
FL_TILE = Item("gfs_marine_waves_florida_east_coast.json", Cov(-81.88, 27.13, -79.84, 29.15))
GLOBAL = Item("gfs_marine_waves_global.json", Cov(-180.0, -85.0, 180.0, 85.0))
VP_STRADDLE = (-81.88, 27.0, -79.0, 29.15)   # ~0.666 coverage by FL_TILE
VP_FAR = (-70.0, 27.0, -67.12, 29.15)        # zero overlap with FL_TILE
VP_MINORITY = (-80.4, 27.0, -75.0, 29.15)    # FL tile covers only a small slice (<0.6)
VP_WIDE = (-100.0, 10.0, -60.0, 45.0)        # continental — must stay global


def _cands(*items):
    return [(i, 0.0) for i in items]


def _run_prefer(vp, monkeypatch=None, env=None, layer="waves", domain="marine",
                use_manifest_product=False, cands=None):
    auth = cands if cands is not None else _cands(FL_TILE, GLOBAL)
    return apply_marine_intersect_prefer(
        use_manifest_product=use_manifest_product, domain=domain, layer=layer,
        req_w=vp[0], req_s=vp[1], req_e=vp[2], req_n=vp[3],
        authoritative_candidates=auth, estimated_candidates=[],
        matching_manifest_item=None, manifest_preview_item=None, regional_span_lng=0.0,
    )


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

    def test_global_products_never_win(self):
        item = pick_surf_regional_override(
            _cands(GLOBAL), [], *VP_STRADDLE, min_viewport_frac=0.6)
        assert item is None


class TestApplyMarineIntersectPrefer:
    def test_straddling_marine_viewport_gets_the_fine_tile(self):
        m, preview, use, span, partial = _run_prefer(VP_STRADDLE)
        assert m is FL_TILE
        assert use is True
        assert preview is None
        assert 0 < span < 350.0
        assert partial is True  # Step 3 must stamp regional_partial/partial_coverage honestly

    def test_no_overlap_stays_unserved(self):
        m, _, use, _, partial = _run_prefer(VP_FAR)
        assert m is None
        assert use is False
        assert partial is False

    def test_minority_coverage_stays_unserved(self):
        m, _, use, _, partial = _run_prefer(VP_MINORITY)
        assert m is None
        assert use is False
        assert partial is False

    def test_wide_viewport_stays_global(self):
        m, _, use, _, partial = _run_prefer(VP_WIDE)
        assert m is None
        assert use is False
        assert partial is False

    def test_kill_switch(self, monkeypatch):
        monkeypatch.setenv("MARINE_INTERSECT_PREFER", "0")
        m, _, use, _, partial = _run_prefer(VP_STRADDLE)
        assert m is None
        assert use is False
        assert partial is False

    def test_floor_lever(self, monkeypatch):
        monkeypatch.setenv("MARINE_INTERSECT_MIN_FRAC", "0.9")
        m, _, use, _, partial = _run_prefer(VP_STRADDLE)  # 0.666 < 0.9
        assert m is None
        assert use is False
        assert partial is False

    def test_non_marine_domain_untouched(self):
        m, _, use, _, partial = _run_prefer(VP_STRADDLE, domain="wind", layer="wind")
        assert m is None
        assert use is False
        assert partial is False

    def test_existing_decision_untouched(self):
        # When decide_manifest_product already chose a product, the pass must no-op.
        m, _, use, _, partial = _run_prefer(VP_STRADDLE, use_manifest_product=True)
        assert m is None  # inputs pass through unchanged (matching item stays as given: None)
        assert use is True
        assert partial is False

    def test_estimated_tiles_eligible(self):
        est_tile = Item("est_fl.json", FL_TILE.coverage, is_estimated=True)
        m, _, use, _, _ = _run_prefer(VP_STRADDLE, cands=_cands(GLOBAL)) # no auth regional
        assert m is None
        result = apply_marine_intersect_prefer(
            use_manifest_product=False, domain="marine", layer="waves",
            req_w=VP_STRADDLE[0], req_s=VP_STRADDLE[1], req_e=VP_STRADDLE[2], req_n=VP_STRADDLE[3],
            authoritative_candidates=_cands(GLOBAL), estimated_candidates=_cands(est_tile),
            matching_manifest_item=None, manifest_preview_item=None, regional_span_lng=0.0,
        )
        assert result[0] is est_tile
        assert result[2] is True
        assert result[4] is True
