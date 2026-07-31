"""The pilot rotation starved regions — measured live 2026-07-31, then reproduced here.

WHY THIS FILE EXISTS. `test_pilot_regions.py` already asserted the rotation covers every worldwide
region, and it passed the whole time uk_ireland's GFS marine products were 447.5 h (18.6 DAYS) old.
It feeds `_select_rotating_regions` CONSECUTIVE cycle indices. Production never delivers those:
`cycle_index` quantises wall-clock into 3-HOUR buckets while the only lane that consumes it
(forecast-ingest-pilots.yml) fires 3x/day at 8-HOUR intervals. The function was a correct round-robin
over a counter it does not receive — so the test proved a property of the FUNCTION, not of the SYSTEM.

These tests drive the selection from the REAL cron times instead, which is what makes the starvation
visible at all.
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import scheduler_helpers as sh
from services.weather_pipeline.scheduler_helpers import (
    _select_rotating_regions,
    get_pilot_regions,
    last_run_by_region_for_lane,
    select_stale_first_regions,
    REGIONAL_CONFIGS,
    WORLDWIDE_COASTAL_REGIONS,
)

# forecast-ingest-pilots.yml: cron '45 3,11,19 * * *'. forecast-ingest.yml runs INGEST_PILOTS=skip,
# so this is the ONLY schedule that selects pilot regions.
PILOT_CRON_UTC = [(3, 45), (11, 45), (19, 45)]
PER_CYCLE = 2          # WORLDWIDE_REGIONS_PER_CYCLE in both workflows
DAYS = 30


def _cycle_index(t: datetime) -> int:
    return int(t.timestamp() // (3 * 3600))


def _fire_times(elapsed_min: int):
    """When a lane actually calls get_pilot_regions: cron fire + however long the job took to reach it."""
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    for d in range(DAYS):
        for (h, m) in PILOT_CRON_UTC:
            yield start + timedelta(days=d, hours=h, minutes=m + elapsed_min)


def _ww_items():
    return list(WORLDWIDE_COASTAL_REGIONS.items())


@pytest.mark.parametrize("elapsed_min,starved", [
    (0,   {"hawaii", "iberia_west"}),
    (60,  {"south_africa", "mexico_centralamerica_pac"}),
    (120, {"indonesia", "brazil_east"}),
    (180, {"uk_ireland", "east_australia"}),
])
def test_clock_rotation_starves_exactly_two_regions_under_the_real_cron(elapsed_min, starved):
    """THE DEFECT. 8h cron vs 3h index: cycle_index % 4 takes only 3 of its 4 values per day, so one
    adjacent PAIR is never selected. WHICH pair depends only on how far into the job the lane runs —
    and job duration drifts, so the starved pair moves. The +180 min case is the live failing
    instance: uk_ireland + east_australia measured at 447.5 h against a 12 h design intent."""
    ww = _ww_items()
    hits = {rid: 0 for rid, _ in ww}
    for t in _fire_times(elapsed_min):
        for rid in _select_rotating_regions(REGIONAL_CONFIGS, ww, PER_CYCLE, _cycle_index(t)):
            if rid in hits:
                hits[rid] += 1

    assert {r for r, c in hits.items() if c == 0} == starved
    # Everything else is hit daily — the starvation is total, not merely slow.
    assert all(c == DAYS for r, c in hits.items() if r not in starved)


@pytest.mark.parametrize("elapsed_min", [0, 60, 120, 180, 47, 213])
def test_stale_first_starves_nobody_at_any_job_duration(elapsed_min):
    """THE FIX. Selection reads what was actually ingested, so no region can be skipped by a clock
    coincidence. Bound: with 8 regions, 2 per fire, 3 fires/day, every region must be refreshed
    within ceil(8/2)=4 fires -> at most ~32 h (one fire gap is 8 h; two consecutive same-day gaps
    are shorter)."""
    ww = _ww_items()
    last_run: dict = {}
    hits = {rid: 0 for rid, _ in ww}
    max_gap_h = 0.0
    for t in _fire_times(elapsed_min):
        picked = select_stale_first_regions(REGIONAL_CONFIGS, ww, PER_CYCLE, last_run, _cycle_index(t))
        for rid in picked:
            if rid not in hits:
                continue
            hits[rid] += 1
            if rid in last_run:
                max_gap_h = max(max_gap_h, (t - last_run[rid]).total_seconds() / 3600.0)
            last_run[rid] = t          # the lane ingested it; that is the feedback the clock lacked

    assert min(hits.values()) > 0, f"starved: {[r for r, c in hits.items() if c == 0]}"
    assert max_gap_h <= 32.0, f"max refresh gap {max_gap_h}h"


def test_stale_first_picks_the_live_failing_instance_first():
    """Against the run ages MEASURED live 2026-07-31 19:34Z for the GFS/marine lane, the very next
    selection must be the two starved regions — the fix has to act on the failing instance, not just
    on a synthetic schedule."""
    now = datetime(2026, 7, 31, 19, 34, tzinfo=timezone.utc)
    measured_age_h = {
        "east_australia": 447.5, "uk_ireland": 447.5,       # 18.6 days
        "south_africa": 21.9, "mexico_centralamerica_pac": 21.9,
        "indonesia": 12.1, "brazil_east": 12.1,
        "hawaii": 5.4, "iberia_west": 5.4,
    }
    last_run = {r: now - timedelta(hours=h) for r, h in measured_age_h.items()}
    picked = select_stale_first_regions(
        REGIONAL_CONFIGS, _ww_items(), PER_CYCLE, last_run, _cycle_index(now))
    assert set(picked) - set(REGIONAL_CONFIGS) == {"east_australia", "uk_ireland"}
    assert set(REGIONAL_CONFIGS).issubset(picked)      # flagship is never displaced


def test_never_ingested_region_outranks_every_stale_one():
    """A region with no product at all is the most urgent case (it is why uk_ireland held ONE)."""
    now = datetime(2026, 7, 31, tzinfo=timezone.utc)
    last_run = {r: now - timedelta(hours=900) for r in WORLDWIDE_COASTAL_REGIONS}
    last_run.pop("indonesia")
    picked = set(select_stale_first_regions(
        REGIONAL_CONFIGS, _ww_items(), 1, last_run, 0)) - set(REGIONAL_CONFIGS)
    assert picked == {"indonesia"}


def test_cold_start_still_rotates_instead_of_pinning_the_first_pair():
    """With no history every region ties; the tie-break is the round-robin position, so consecutive
    cycles advance rather than re-picking the same two forever."""
    ww = _ww_items()
    a = set(select_stale_first_regions(REGIONAL_CONFIGS, ww, PER_CYCLE, {}, 0)) - set(REGIONAL_CONFIGS)
    b = set(select_stale_first_regions(REGIONAL_CONFIGS, ww, PER_CYCLE, {}, 1)) - set(REGIONAL_CONFIGS)
    assert a != b and len(a) == len(b) == PER_CYCLE


def test_per_cycle_zero_and_empty_worldwide_are_flagship_only():
    assert set(select_stale_first_regions(REGIONAL_CONFIGS, _ww_items(), 0, {}, 5)) == set(REGIONAL_CONFIGS)
    assert set(select_stale_first_regions(REGIONAL_CONFIGS, [], 2, {}, 5)) == set(REGIONAL_CONFIGS)


# ─────────────────────────── lane scoping: the aggregate trap ───────────────────────────

class _P:
    def __init__(self, model, domain, region_id, run_time):
        self.model, self.domain, self.region_id, self.run_time = model, domain, region_id, run_time


class _Manifest:
    def __init__(self, products):
        self.products = products


def test_last_run_is_lane_scoped_because_the_aggregate_hides_the_defect():
    """ICON/EURO marine ingest EVERY region EVERY cycle (get_all_pilot_regions), so a whole-manifest
    'newest run per region' reads fresh everywhere. Scoped to GFS/marine, uk_ireland's 18.6-day age is
    visible; unscoped it is masked — the same aggregate-hides-the-input trap as the height audit."""
    now = datetime(2026, 7, 31, 19, 34, tzinfo=timezone.utc)
    products = [
        _P("GFS", "marine", "uk_ireland", now - timedelta(hours=447.5)),
        _P("GFS", "marine", "hawaii", now - timedelta(hours=5.4)),
        _P("ICON", "marine", "uk_ireland", now - timedelta(hours=5.1)),   # the masker
        _P("EURO", "marine", "uk_ireland", now - timedelta(hours=5.0)),   # the masker
        _P("GFS", "wind", "uk_ireland", now - timedelta(hours=28.0)),     # different lane
        _P("GFS", "marine", "global_coarse", now),                        # not a worldwide region
    ]
    gfs_marine = last_run_by_region_for_lane(
        _Manifest(products), "GFS", "marine", WORLDWIDE_COASTAL_REGIONS.keys())
    assert (now - gfs_marine["uk_ireland"]).total_seconds() / 3600.0 == pytest.approx(447.5)
    assert "global_coarse" not in gfs_marine

    gfs_wind = last_run_by_region_for_lane(
        _Manifest(products), "GFS", "wind", WORLDWIDE_COASTAL_REGIONS.keys())
    assert (now - gfs_wind["uk_ireland"]).total_seconds() / 3600.0 == pytest.approx(28.0)
    assert "hawaii" not in gfs_wind          # no GFS/wind product for hawaii in this manifest


def test_naive_timestamps_are_treated_as_utc_not_dropped():
    naive = datetime(2026, 7, 31, 12, 0)
    got = last_run_by_region_for_lane(
        _Manifest([_P("GFS", "marine", "hawaii", naive)]), "GFS", "marine",
        WORLDWIDE_COASTAL_REGIONS.keys())
    assert got["hawaii"] == naive.replace(tzinfo=timezone.utc)


def test_non_datetime_run_time_is_skipped_not_crashed():
    got = last_run_by_region_for_lane(
        _Manifest([_P("GFS", "marine", "hawaii", "2026-07-31T12:00:00Z"), _P("GFS", "marine", "hawaii", None)]),
        "GFS", "marine", WORLDWIDE_COASTAL_REGIONS.keys())
    assert got == {}


# ─────────────────────────── get_pilot_regions wiring ───────────────────────────

@pytest.fixture
def _production_like(monkeypatch):
    """get_pilot_regions returns flagship-only under pytest; lift that to exercise the real branch."""
    from services.weather_pipeline import copernicus_validator
    monkeypatch.setattr(copernicus_validator, "is_test_environment", lambda: False)
    monkeypatch.setenv("WORLDWIDE_COASTAL", "1")
    monkeypatch.setenv("WORLDWIDE_REGIONS_PER_CYCLE", "2")


class _Store:
    def __init__(self, manifest_or_exc):
        self._m = manifest_or_exc

    def get_manifest(self):
        if isinstance(self._m, Exception):
            raise self._m
        return self._m


def test_get_pilot_regions_uses_stale_first_when_a_store_is_supplied(_production_like):
    now = datetime.now(timezone.utc)
    products = [_P("GFS", "marine", r, now - timedelta(hours=h))
                for r, h in {"east_australia": 447.5, "uk_ireland": 447.5, "south_africa": 21.9,
                             "mexico_centralamerica_pac": 21.9, "indonesia": 12.1, "brazil_east": 12.1,
                             "hawaii": 5.4, "iberia_west": 5.4}.items()]
    picked = get_pilot_regions(_Store(_Manifest(products)), "GFS", "marine")
    assert set(picked) - set(REGIONAL_CONFIGS) == {"east_australia", "uk_ireland"}


def test_a_broken_manifest_falls_back_to_the_rotation_and_never_blocks_ingestion(_production_like):
    """A freshness heuristic must not be able to stop the pipeline it exists to keep fresh."""
    picked = get_pilot_regions(_Store(RuntimeError("L2 unreachable")), "GFS", "marine")
    assert set(REGIONAL_CONFIGS).issubset(picked)
    assert len(set(picked) - set(REGIONAL_CONFIGS)) == 2


def test_kill_switch_restores_the_clock_rotation(_production_like, monkeypatch):
    monkeypatch.setenv("PILOT_REGION_STALE_FIRST", "0")
    now = datetime.now(timezone.utc)
    store = _Store(_Manifest([_P("GFS", "marine", "uk_ireland", now - timedelta(hours=447.5))]))
    ci = _cycle_index(now)
    assert set(get_pilot_regions(store, "GFS", "marine")) == set(
        _select_rotating_regions(REGIONAL_CONFIGS, _ww_items(), 2, ci))


def test_no_store_keeps_the_legacy_signature_working(_production_like):
    """get_pilot_regions() with no arguments must still behave exactly as before (other callers)."""
    ci = _cycle_index(datetime.now(timezone.utc))
    assert set(get_pilot_regions()) == set(
        _select_rotating_regions(REGIONAL_CONFIGS, _ww_items(), 2, ci))


def test_flagship_regions_are_never_displaced_by_starving_worldwide_ones():
    """FL/SoCal ingest EVERY cycle; the stale-first ranking applies only to the worldwide slice."""
    now = datetime(2026, 7, 31, tzinfo=timezone.utc)
    last_run = {r: now - timedelta(hours=900) for r in WORLDWIDE_COASTAL_REGIONS}
    picked = select_stale_first_regions(REGIONAL_CONFIGS, _ww_items(), PER_CYCLE, last_run, 0)
    assert set(REGIONAL_CONFIGS).issubset(picked)
    assert len(picked) == len(REGIONAL_CONFIGS) + PER_CYCLE


def test_worldwide_region_count_is_what_the_cadence_math_assumes():
    """The 32 h bound in test_stale_first_starves_nobody assumes 8 regions at 2/fire, 3 fires/day.
    Adding regions without revisiting WORLDWIDE_REGIONS_PER_CYCLE silently lengthens the cadence."""
    assert len(WORLDWIDE_COASTAL_REGIONS) == 8


def test_scheduler_helpers_reexports_the_same_objects_not_copies():
    """The selection logic moved to pilot_regions.py under the LOC gate; scheduler_helpers re-exports
    it. Callers import from BOTH paths, so these must be the SAME objects — a copy would let a
    monkeypatch or a config edit apply to one import path and not the other."""
    from services.weather_pipeline import pilot_regions as pr
    for name in ("get_pilot_regions", "get_all_pilot_regions", "select_stale_first_regions",
                 "last_run_by_region_for_lane", "_select_rotating_regions",
                 "is_flagship_pilot_region", "flagship_pilot_days",
                 "REGIONAL_CONFIGS", "WORLDWIDE_COASTAL_REGIONS"):
        assert getattr(sh, name) is getattr(pr, name), name
