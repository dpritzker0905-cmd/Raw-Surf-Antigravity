"""
The 0.083° island region list — invariants that would otherwise break SILENTLY.

Every assertion here corresponds to a way this lane can fail without raising:
a region too wide for one subset call (silently tiles, ~60 slow downloads), a declared cell count
that no longer matches the lattice (a published cost figure becomes a lie), a partially-overlapping
region served as if it covered the viewport (a visible seam), or a duplicate id (one region's product
overwrites another's).
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.weather_pipeline.copernicus_island_regions import (  # noqa: E402
    ISLAND_REGIONS, ISLAND_RESOLUTION,
    SINGLE_REQUEST_MAX_LAT_SPAN, SINGLE_REQUEST_MAX_LON_SPAN,
    region_by_id, regions_covering, region_containing_bbox, region_axes,
)


class TestRegionListIntegrity:
    def test_ids_are_unique(self):
        # A duplicate id means one region's product silently overwrites another's: same region_id,
        # same layer, same valid_time -> the second save wins and one island quietly loses its data.
        ids = [r["id"] for r in ISLAND_REGIONS]
        assert len(ids) == len(set(ids)), f"duplicate region ids: {sorted(set(i for i in ids if ids.count(i) > 1))}"

    def test_bboxes_are_well_formed(self):
        for r in ISLAND_REGIONS:
            assert r["west"] < r["east"], f"{r['id']}: west >= east"
            assert r["south"] < r["north"], f"{r['id']}: south >= north"
            assert -180 <= r["west"] and r["east"] <= 180, f"{r['id']}: lng out of range"
            assert -90 <= r["south"] and r["north"] <= 90, f"{r['id']}: lat out of range"

    def test_every_region_is_a_SINGLE_subset_call(self):
        # copernicus_marine_service._fetch_sync falls back to _fetch_tiled_sync past these spans.
        # Tiling is memory-safe but ~60 slow downloads, and NOTHING RAISES - the ingest just becomes
        # far heavier than the measured ~13 s/region the cost model is built on.
        for r in ISLAND_REGIONS:
            assert (r["north"] - r["south"]) <= SINGLE_REQUEST_MAX_LAT_SPAN, f"{r['id']} would tile (lat)"
            assert (r["east"] - r["west"]) <= SINGLE_REQUEST_MAX_LON_SPAN, f"{r['id']} would tile (lng)"

    def test_declared_cells_MATCH_the_real_lattice(self):
        # The published cost (4.63 MB/frame) is derived from these numbers, so they must come from the
        # code that does the work. The first pass computed them as round(span/res) and understated the
        # total by 3.1%, because region_axes includes BOTH edges.
        for r in ISLAND_REGIONS:
            lats, lngs = region_axes(r)
            assert r["cells"] == len(lats) * len(lngs), (
                f"{r['id']}: declared {r['cells']} but lattice is {len(lngs)}x{len(lats)}={len(lats) * len(lngs)}")

    def test_total_stays_within_the_costed_envelope(self):
        # A guard on scope creep, not a style rule: 232 B/cell/frame measured x 8 frames/day.
        total = sum(r["cells"] for r in ISLAND_REGIONS)
        assert total == 19963, f"cell total moved to {total}; re-cost before widening the list"
        assert total * 232 / 1e6 < 5.0, "payload per frame exceeded 5 MB"


class TestRegionAxes:
    def test_lattice_steps_at_the_native_resolution(self):
        lats, lngs = region_axes(region_by_id("madeira"))
        assert abs((lats[1] - lats[0]) - ISLAND_RESOLUTION) < 1e-9
        assert abs((lngs[1] - lngs[0]) - ISLAND_RESOLUTION) < 1e-9

    def test_lattice_covers_BOTH_edges_of_the_padded_region(self):
        # The 0.45 deg pad exists to supply open water on every side; a half-open range would drop the
        # outermost column, i.e. exactly the water the pad was added for.
        r = region_by_id("madeira")
        lats, lngs = region_axes(r)
        assert lngs[0] == round(r["west"], 4)
        assert lngs[-1] <= r["east"] + 1e-9
        assert r["east"] - lngs[-1] < ISLAND_RESOLUTION
        assert r["north"] - lats[-1] < ISLAND_RESOLUTION

    def test_madeira_reproduces_the_pilot_footprint(self):
        # The pilot that PROVED the fix sampled 0.0833 deg over -17.60..-16.40, 32.40..33.15 = 150 pts.
        # Madeira's region is the padded superset, so it must be larger but the same order.
        lats, lngs = region_axes(region_by_id("madeira"))
        assert 150 <= len(lats) * len(lngs) <= 400


class TestCoverageQueries:
    def test_a_madeira_spot_resolves_to_madeira(self):
        assert [r["id"] for r in regions_covering(32.75, -17.0)] == ["madeira"]

    def test_open_ocean_resolves_to_NOTHING(self):
        # Must be empty, not a nearest-match. Returning a region here would serve a fine grid where no
        # product exists.
        assert regions_covering(40.0, -40.0) == []
        assert regions_covering(0.0, 0.0) == []

    def test_missing_coordinates_do_not_raise(self):
        assert regions_covering(None, -17.0) == []
        assert regions_covering(32.75, None) == []

    def test_smallest_region_wins_when_they_overlap(self):
        overlapping = [r for r in ISLAND_REGIONS
                       if regions_covering((r["south"] + r["north"]) / 2, (r["west"] + r["east"]) / 2)]
        for r in overlapping:
            hits = regions_covering((r["south"] + r["north"]) / 2, (r["west"] + r["east"]) / 2)
            areas = [(h["east"] - h["west"]) * (h["north"] - h["south"]) for h in hits]
            assert areas == sorted(areas), f"{r['id']}: regions_covering not smallest-first"

    def test_bbox_must_be_FULLY_contained(self):
        # Partial overlap has to fall through. Serving a fine grid over part of the viewport leaves the
        # rest to a coarser product -> a seam, which is the box-edge artifact that got an earlier
        # viewport-clip attempt reverted.
        assert region_containing_bbox(-17.3, 32.5, -16.6, 33.0)["id"] == "madeira"
        assert region_containing_bbox(-18.5, 32.5, -16.6, 33.0) is None   # spills west
        assert region_containing_bbox(-17.3, 32.5, -15.0, 33.0) is None   # spills east
        assert region_containing_bbox(-17.3, 31.0, -16.6, 33.0) is None   # spills south

    def test_none_bbox_does_not_raise(self):
        assert region_containing_bbox(None, 32.5, -16.6, 33.0) is None
