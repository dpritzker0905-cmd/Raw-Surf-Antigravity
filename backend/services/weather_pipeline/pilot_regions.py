"""
pilot_regions.py — WHICH regions the marine + wind pilots ingest this cycle.

Extracted from scheduler_helpers.py 2026-07-31 (LOC gate) at the moment this logic became the
best-covered part of that file: the starvation arc added 46 focused tests, so the extraction is
verified by construction rather than by inspection. `scheduler_helpers` re-exports every name, so
existing `from ...scheduler_helpers import get_pilot_regions` imports keep working unchanged.

The whole point of this module is the SELECTION RULE, and the history is the reason it is one file:
a clock-derived rotation silently starved 2 of 8 regions for months (see get_pilot_regions).
"""
import os
from datetime import datetime, timezone

import logging

logger = logging.getLogger(__name__)


REGIONAL_CONFIGS = {
    "florida_east_coast": {
        "west": -85.0,
        "south": 24.0,
        "east": -79.0,
        "north": 31.0,
        "resolution": 0.25
    },
    "us_west_coast_socal": {
        "west": -125.0,
        "south": 30.0,
        "east": -115.0,
        "north": 38.0,
        "resolution": 0.25
    }
}

# Worldwide coastal surf regions (0.25°), refreshed ROUND-ROBIN across cron cycles (see get_pilot_regions)
# so worldwide coverage fits the fixed ~120min CI budget — ingesting every coast at 0.25° each cycle would
# blow it (marine pilot is ~5-15min PER region). The flagship REGIONAL_CONFIGS (FL, SoCal) ingest EVERY
# cycle (no regression); these rotate WORLDWIDE_REGIONS_PER_CYCLE at a time. Boxes hug the primary surf
# coasts. This is the worldwide half of the coastal-resolution gap (was FL+SoCal only).
WORLDWIDE_COASTAL_REGIONS = {
    "hawaii":                    {"west": -161.0, "south": 18.0,  "east": -154.0, "north": 23.0,  "resolution": 0.25},
    "iberia_west":               {"west": -11.0,  "south": 36.0,  "east": -6.0,   "north": 44.0,  "resolution": 0.25},
    "uk_ireland":                {"west": -11.0,  "south": 49.0,  "east": 1.0,    "north": 59.0,  "resolution": 0.25},
    "east_australia":            {"west": 150.0,  "south": -38.0, "east": 156.0,  "north": -25.0, "resolution": 0.25},
    "indonesia":                 {"west": 98.0,   "south": -11.0, "east": 120.0,  "north": 2.0,   "resolution": 0.25},
    "brazil_east":               {"west": -49.0,  "south": -27.0, "east": -34.0,  "north": -3.0,  "resolution": 0.25},
    "south_africa":              {"west": 17.0,   "south": -35.0, "east": 28.0,   "north": -31.0, "resolution": 0.25},
    "mexico_centralamerica_pac": {"west": -106.0, "south": 8.0,   "east": -84.0,  "north": 21.0,  "resolution": 0.25},
}


def _select_rotating_regions(flagship: dict, worldwide_items: list, per_cycle: int, cycle_index: int) -> dict:
    """Flagship regions always + a rotating window of `per_cycle` worldwide regions (round-robin by cron
    cycle). Pure/deterministic for testing. Over ceil(N/per_cycle) cycles every worldwide region is
    refreshed, keeping per-cycle ingestion cost (and thus CI time) bounded."""
    regions = dict(flagship)
    n = len(worldwide_items)
    if per_cycle > 0 and n > 0:
        start = (cycle_index * per_cycle) % n
        for i in range(min(per_cycle, n)):
            rid, rcfg = worldwide_items[(start + i) % n]
            regions[rid] = rcfg
    return regions


def last_run_by_region_for_lane(manifest, model: str, domain: str, region_ids) -> dict:
    """Newest product run_time per region for ONE (model, domain) lane. Pure; missing region -> absent.

    ⚠️ LANE-SCOPED ON PURPOSE. Aggregating run_time across ALL lanes destroys the signal: ICON/EURO
    marine use get_all_pilot_regions() (every region, every cycle), so a whole-manifest "newest per
    region" reads ~5h fresh EVERYWHERE and would rank GFS marine's 18.6-day-old uk_ireland as current.
    The aggregate hides exactly the defect this selects against.
    """
    wanted = set(region_ids)
    out: dict = {}
    for p in (getattr(manifest, "products", None) or []):
        rid = getattr(p, "region_id", None)
        if rid not in wanted:
            continue
        if str(getattr(p, "model", "")).upper() != model.upper():
            continue
        if str(getattr(p, "domain", "")).lower() != domain.lower():
            continue
        rt = getattr(p, "run_time", None)
        if not isinstance(rt, datetime):
            continue
        rt = rt if rt.tzinfo else rt.replace(tzinfo=timezone.utc)
        if rid not in out or rt > out[rid]:
            out[rid] = rt
    return out


def select_stale_first_regions(flagship: dict, worldwide_items: list, per_cycle: int,
                               last_run: dict, cycle_index: int) -> dict:
    """Flagship always + the `per_cycle` worldwide regions that have gone LONGEST without ingestion.

    Replaces the clock-derived round-robin, which starved regions (see get_pilot_regions). Pure.
    A region with NO recorded run sorts first (never ingested = maximal need). Ties break on the
    round-robin position for this cycle, so a cold start still rotates instead of pinning the first
    two regions forever.

    ★ This is the coverage-class remedy: selection is accountable to what was actually covered, so a
    missed turn moves a region to the FRONT of the queue instead of losing it silently. It cannot be
    desynchronised by cron period, job duration, or CI drift — none of those are inputs.
    """
    regions = dict(flagship)
    n = len(worldwide_items)
    if per_cycle <= 0 or n == 0:
        return regions
    order = {rid: i for i, (rid, _) in enumerate(worldwide_items)}
    start = (cycle_index * per_cycle) % n
    # Round-robin distance from this cycle's start — the deterministic tie-break.
    rr = {rid: (order[rid] - start) % n for rid, _ in worldwide_items}
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    ranked = sorted(worldwide_items, key=lambda kv: (last_run.get(kv[0]) or epoch, rr[kv[0]]))
    for rid, rcfg in ranked[:min(per_cycle, n)]:
        regions[rid] = rcfg
    return regions


def get_pilot_regions(store=None, model: str = None, domain: str = None) -> dict:
    """Regions the marine + wind PILOTS ingest THIS cron cycle: the flagship REGIONAL_CONFIGS (always) plus
    a slice of WORLDWIDE_COASTAL_REGIONS so worldwide coastal 0.25° coverage is achieved within the
    fixed CI budget. Env: WORLDWIDE_COASTAL=0 reverts to flagship-only; WORLDWIDE_REGIONS_PER_CYCLE (default
    1) tunes how many worldwide regions per cycle (raise once CI headroom is confirmed). Test env returns
    flagship-only so deterministic ingestion tests are unaffected.

    ⛔ THE CLOCK ROTATION STARVED REGIONS (measured 2026-07-31, live manifest). `cycle_index` quantises
    wall-clock into 3-HOUR buckets, but the ONLY lane that consumes it is forecast-ingest-pilots.yml,
    which fires 3x/day at 8-HOUR intervals (forecast-ingest.yml runs INGEST_PILOTS=skip). 24h is a
    common multiple of 3h and 8h, so `cycle_index % 4` takes only THREE of its four values every day
    and one adjacent PAIR of regions is never selected at all. Simulated over 30 days of the real cron:
    exactly 2 of 8 regions score ZERO hits, and WHICH two depends only on how many minutes into the job
    the lane happens to run (+0 min starves hawaii+iberia_west; +180 min starves uk_ireland+
    east_australia). Job duration drifts, so the starved pair moves and starvation is intermittent —
    live consequence: GFS marine uk_ireland and east_australia at run age 447.5 h (18.6 DAYS) against a
    12 h design intent, holding 1 and 3 products respectively.
    ★ test_rotation_covers_every_worldwide_region_over_cycles passed throughout: it feeds CONSECUTIVE
      cycle indices, which production never delivers. The function was a correct round-robin over a
      counter it does not receive.
    ⇒ Default is now STALE-FIRST (select_stale_first_regions), which reads what was actually ingested
      instead of guessing from the clock. Kill switch: PILOT_REGION_STALE_FIRST=0 restores the rotation.
      Any failure to read the manifest also falls back to it — a health heuristic must never be able to
      stop ingestion.
    """
    from services.weather_pipeline.copernicus_validator import is_test_environment
    if os.environ.get("WORLDWIDE_COASTAL", "1") == "0" or is_test_environment():
        return dict(REGIONAL_CONFIGS)
    per_cycle = max(0, int(os.environ.get("WORLDWIDE_REGIONS_PER_CYCLE", "1")))
    cycle_index = int(datetime.now(timezone.utc).timestamp() // (3 * 3600))
    ww_items = list(WORLDWIDE_COASTAL_REGIONS.items())

    if store is not None and model and domain and os.environ.get("PILOT_REGION_STALE_FIRST", "1") != "0":
        try:
            last_run = last_run_by_region_for_lane(
                store.get_manifest(), model, domain, WORLDWIDE_COASTAL_REGIONS.keys())
            picked = select_stale_first_regions(
                REGIONAL_CONFIGS, ww_items, per_cycle, last_run, cycle_index)
            now = datetime.now(timezone.utc)
            ages = {r: (round((now - last_run[r]).total_seconds() / 3600.0, 1) if r in last_run else None)
                    for r in picked if r not in REGIONAL_CONFIGS}
            logger.info(f"[Pilot regions] {model}/{domain} stale-first picked {ages} "
                        f"(age_h; None = never ingested)")
            return picked
        except Exception as e:
            logger.warning(f"[Pilot regions] stale-first unavailable for {model}/{domain} "
                           f"({e!r}); falling back to the clock rotation.")
    return _select_rotating_regions(REGIONAL_CONFIGS, ww_items, per_cycle, cycle_index)


def is_flagship_pilot_region(region_id: str) -> bool:
    """A FLAGSHIP pilot region (REGIONAL_CONFIGS = FL / SoCal) ingests EVERY cron cycle, so it can
    afford the full native forecast horizon; the rotating WORLDWIDE regions stay shorter to hold the
    ~165-min CI budget. Used by the flagship-first horizon selection (2026-07-15)."""
    return region_id in REGIONAL_CONFIGS


def flagship_pilot_days(region_id: str, flagship_days: int, worldwide_days: int) -> int:
    """Flagship-first forecast horizon (2026-07-15, the '14-day state-of-the-art fine pilots' arc):
    the ever-present flagship coasts carry the long native horizon; the rotating worldwide regions
    stay at the shorter budget horizon so the CI stays green. Pure — flagship_days if the region is a
    flagship, else worldwide_days."""
    return flagship_days if is_flagship_pilot_region(region_id) else worldwide_days


def get_all_pilot_regions() -> dict:
    """Flagship + ALL worldwide coastal regions — NO rotation (2026-07-13, multi-bbox arc): for the
    single-download-pass fetchers (GWAM/ECMWF wave stream), extra regions cost only in-memory
    sampling + product saves, not downloads, so EVERY region refreshes EVERY cycle instead of every
    ~4 cycles. The rotation (get_pilot_regions) remains for per-region-download lanes (GFS/NOAA
    byte-range, wind pilots). Same gates: WORLDWIDE_COASTAL=0 / test env -> flagship-only."""
    from services.weather_pipeline.copernicus_validator import is_test_environment
    if os.environ.get("WORLDWIDE_COASTAL", "1") == "0" or is_test_environment():
        return dict(REGIONAL_CONFIGS)
    return {**REGIONAL_CONFIGS, **WORLDWIDE_COASTAL_REGIONS}

