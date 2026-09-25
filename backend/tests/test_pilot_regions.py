"""Unit tests for worldwide coastal pilot-region rotation (the worldwide coastal-resolution follow-up).

The marine + wind pilots ingest the flagship REGIONAL_CONFIGS every cron cycle plus a rotating slice of
WORLDWIDE_COASTAL_REGIONS, so worldwide 0.25° coastal coverage is achieved within the fixed CI budget.
"""
from services.weather_pipeline.scheduler_helpers import (
    _select_rotating_regions,
    get_pilot_regions,
    REGIONAL_CONFIGS,
    WORLDWIDE_COASTAL_REGIONS,
)


def test_rotating_includes_flagship_and_rotates_each_cycle():
    flagship = {"a": {}, "b": {}}
    ww = [("w0", {}), ("w1", {}), ("w2", {}), ("w3", {})]
    assert set(_select_rotating_regions(flagship, ww, 1, 0)) == {"a", "b", "w0"}
    assert set(_select_rotating_regions(flagship, ww, 1, 1)) == {"a", "b", "w1"}


def test_rotation_covers_every_worldwide_region_over_cycles():
    flagship = {"a": {}}
    ww = [("w0", {}), ("w1", {}), ("w2", {}), ("w3", {})]
    covered = set()
    for cycle in range(len(ww)):
        covered |= set(_select_rotating_regions(flagship, ww, 1, cycle)) - set(flagship)
    assert covered == {"w0", "w1", "w2", "w3"}


def test_rotation_window_wraps_and_per_cycle_zero():
    flagship = {"a": {}}
    ww = [("w0", {}), ("w1", {}), ("w2", {})]
    assert set(_select_rotating_regions(flagship, ww, 2, 0)) == {"a", "w0", "w1"}
    assert set(_select_rotating_regions(flagship, ww, 2, 1)) == {"a", "w2", "w0"}  # start=2 wraps
    assert set(_select_rotating_regions(flagship, ww, 0, 9)) == {"a"}             # per_cycle 0 -> flagship only


def test_worldwide_regions_distinct_and_valid():
    assert not (set(WORLDWIDE_COASTAL_REGIONS) & set(REGIONAL_CONFIGS))  # no overlap with flagship
    for rid, cfg in WORLDWIDE_COASTAL_REGIONS.items():
        assert cfg["resolution"] == 0.25, rid
        assert cfg["west"] < cfg["east"], rid
        assert cfg["south"] < cfg["north"], rid


def test_get_pilot_regions_flagship_only_in_test_env():
    # Under pytest is_test_environment() is True, so the pilots get flagship-only -> existing deterministic
    # ingestion tests (marine pilot, etc.) are unaffected by the worldwide rotation.
    assert set(get_pilot_regions()) == set(REGIONAL_CONFIGS)


# ─── THE 2026-08-09 EXPANSION BOXES (census-priced; MASTER-AUDIT-11.0's largest accuracy lever) ──

def test_expansion_boxes_are_well_formed_and_share_edges_without_interior_overlap():
    """The four new regions abut existing boxes ON PURPOSE (31.0N with florida_east_coast, 37.5N
    between the two new US boxes, -6.0E with iberia_west). Shared EDGES are legal; INTERIOR overlap
    would double-ingest the same cells every cycle. Strict inequalities make edge-touch pass."""
    from services.weather_pipeline.pilot_regions import (
        REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS)
    new = ("us_southeast_midatlantic", "azores", "us_northeast", "france_biscay")
    boxes = {**REGIONAL_CONFIGS, **WORLDWIDE_COASTAL_REGIONS}
    for rid in new:
        b = boxes[rid]
        assert b["west"] < b["east"] and b["south"] < b["north"], rid
        assert b["resolution"] == 0.25, rid
        assert -180 <= b["west"] and b["east"] <= 180 and -80 <= b["south"] and b["north"] <= 85
    items = list(boxes.items())
    for i, (ra, a) in enumerate(items):
        for rb, b in items[i + 1:]:
            interior_overlap = (a["west"] < b["east"] and b["west"] < a["east"]
                                and a["south"] < b["north"] and b["south"] < a["north"])
            assert not interior_overlap, (
                f"{ra} and {rb} overlap in the interior — the same cells would ingest twice "
                f"every cycle. Abut on an edge or shrink one.")


# ─── F-08 STAGE A: GFS-MARINE-ONLY EXTRA REGIONS (audit 14.1, 2026-09-25) ──────────────────────

def _prod_env(monkeypatch):
    from services.weather_pipeline import copernicus_validator
    monkeypatch.setattr(copernicus_validator, "is_test_environment", lambda: False)
    monkeypatch.setenv("WORLDWIDE_COASTAL", "1")
    monkeypatch.delenv("GFS_MARINE_EXTRA_REGIONS", raising=False)


def test_gfs_extra_boxes_are_well_formed_and_never_overlap_any_box():
    """Every box the GFS pass slices — flagship, worldwide AND the extras — must be interior-disjoint,
    or the same cells ingest twice per cycle. centralamerica_caribbean was trimmed -85 -> -84 to ABUT
    mexico_centralamerica_pac; widen it back and this fails."""
    from services.weather_pipeline.pilot_regions import (
        REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS, GFS_MARINE_EXTRA_REGIONS)
    assert not (set(GFS_MARINE_EXTRA_REGIONS) & (set(REGIONAL_CONFIGS) | set(WORLDWIDE_COASTAL_REGIONS)))
    boxes = {**REGIONAL_CONFIGS, **WORLDWIDE_COASTAL_REGIONS, **GFS_MARINE_EXTRA_REGIONS}
    for rid, b in GFS_MARINE_EXTRA_REGIONS.items():
        assert b["west"] < b["east"] and b["south"] < b["north"] and b["resolution"] == 0.25, rid
    items = list(boxes.items())
    for i, (ra, a) in enumerate(items):
        for rb, b in items[i + 1:]:
            assert not (a["west"] < b["east"] and b["west"] < a["east"]
                        and a["south"] < b["north"] and b["south"] < a["north"]), (ra, rb)


def test_gfs_extras_reach_only_the_gfs_marine_pass(monkeypatch):
    """⭐ The whole point of a separate dict: get_all_pilot_regions() also feeds ICON/EURO marine, so an
    extra that leaked into it would triple the product cost Stage A was priced at. Positive control:
    the GFS function DOES carry them, so this cannot pass by the extras being empty."""
    from services.weather_pipeline.pilot_regions import (
        GFS_MARINE_EXTRA_REGIONS, get_all_pilot_regions, get_gfs_marine_pilot_regions)
    _prod_env(monkeypatch)
    assert GFS_MARINE_EXTRA_REGIONS
    assert not (set(GFS_MARINE_EXTRA_REGIONS) & set(get_all_pilot_regions())), "extras leaked to ICON/EURO"
    gfs = get_gfs_marine_pilot_regions()
    assert set(GFS_MARINE_EXTRA_REGIONS) <= set(gfs)
    assert set(get_all_pilot_regions()) <= set(gfs), "the GFS pass must not LOSE any existing region"


def test_gfs_extras_kill_switch_and_test_env(monkeypatch):
    from services.weather_pipeline.pilot_regions import (
        REGIONAL_CONFIGS, GFS_MARINE_EXTRA_REGIONS, get_all_pilot_regions, get_gfs_marine_pilot_regions)
    _prod_env(monkeypatch)
    monkeypatch.setenv("GFS_MARINE_EXTRA_REGIONS", "0")
    assert get_gfs_marine_pilot_regions() == get_all_pilot_regions()
    monkeypatch.setenv("GFS_MARINE_EXTRA_REGIONS", "1")
    monkeypatch.setenv("WORLDWIDE_COASTAL", "0")          # the parent gate still wins
    assert set(get_gfs_marine_pilot_regions()) == set(REGIONAL_CONFIGS)
    monkeypatch.undo()                                     # real pytest env -> flagship only
    assert set(get_gfs_marine_pilot_regions()) == set(REGIONAL_CONFIGS)
    assert not (set(GFS_MARINE_EXTRA_REGIONS) & set(get_gfs_marine_pilot_regions()))


def test_census_holds_the_extras_to_the_flagship_cadence():
    """The census keeps region names as literals (runnable without the backend path), so the two
    lists are one fact written twice: a box added to the dict but not the census would be graded
    `worldwide` (72 h) and a dead new lane would hide for three days."""
    from services.weather_pipeline.pilot_regions import GFS_MARINE_EXTRA_REGIONS
    from scripts import product_run_age_census as C
    assert set(C.GFS_MARINE_EXTRA_REGIONS) == set(GFS_MARINE_EXTRA_REGIONS)
    for rid in GFS_MARINE_EXTRA_REGIONS:
        assert C.tier_of(rid, "GFS", "marine") == "flagship", rid
