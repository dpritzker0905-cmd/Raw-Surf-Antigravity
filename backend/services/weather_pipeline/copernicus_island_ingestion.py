"""
The 0.083° island ingestion lane — the true fix for the island halo.

WHAT THIS EXISTS TO FIX. At 0.25° (~22.5 km) a small island occupies ONE grid cell, so its cell holds
the MEAN of its ocean neighbours — the sheltered lee averaged together with the exposed windward side —
and bilinear filtering spreads that single value onto both shores. Provably unfixable downstream: at
unit island thickness a Laplace solve returns the neighbour mean to within 0.03 m, and a land-aware
fetch that excludes land texels measured WORSE (it replaces a ramp with a discontinuity).

The Madeira pilot settled it on the live API — 0.083° reads 1.62-1.77 m on the windward shore where
0.25° renders 1.24-1.38, and resolves a sharp 0.59-0.98 m lee eight kilometres away. Land arrives as
`null` rather than 0, so the zero-smear that defeated every previous repair has nothing to act on.

DESIGN, and why it is shaped this way:

  ONE SUBSET PER REGION. copernicus_marine_service._fetch_sync derives a bbox from the coordinate
  arrays and issues a single CMEMS subset, tiling only past 28°x55°. Every region is inside that, and
  a test pins it — tiling would silently turn ~13 s into ~60 slow downloads.

  ⚠️ COST IS PER CALL, NOT PER CELL. Measured on the same bbox: 40 pts -> 12.4 s, 150 pts -> 12.0 s,
  308 pts -> 13.4 s. So 20 regions ≈ ~4.3 min per frame regardless of cell counts. An earlier estimate
  of "0.8 h per frame" came from dividing one call's latency by its cell count and assuming linearity;
  it was wrong by two orders of magnitude. That is why the loop is per-region and not per-cell-budget.

  PER-REGION ISOLATION. Each region is independently try/except'd. With 20 regions, a partial ingest is
  vastly better than none — one CMEMS hiccup must not cost the other nineteen. The job returns True if
  ANY region saved, and logs a per-region roll-call so a silent partial is visible.

  ⛔ IT WRITES PRODUCTS AND NOTHING ELSE. No resolver change lives here. Until a serving tier reads
  region_id `island_*`, this lane is inert by construction — products accumulate and no viewport
  behaviour changes. That is deliberate: the serving switch is the risky half (dropping a fallback tier
  is what has produced marine blanks here before) and it deserves its own gate and its own harness.

Kills: COPERNICUS_ISLAND_INGEST=0 disables the lane. COPERNICUS_ISLAND_REGION_LIMIT=N ingests only the
first N regions (they are ordered by spot count, so a limit degrades gracefully to the highest-value
islands). COPERNICUS_ISLAND_DAYS overrides the horizon.
"""
import os
import logging
from datetime import datetime, timezone

from services.weather_pipeline.copernicus_island_regions import (
    ISLAND_REGIONS, ISLAND_RESOLUTION, region_axes,
)
from services.weather_pipeline.scheduler_helpers import normalize_and_save_loop, get_env_flags

logger = logging.getLogger(__name__)

ISLAND_LAYERS = ["waves", "swell_1", "swell_2", "wind_waves"]

# Fetch-method provenance. The normalizer derives is_estimated / source_dataset itself; this only
# records HOW the data was obtained, mirroring the coarse lane's _cop_basis.
ISLAND_BASIS = {
    "type": "copernicus_native_island_regional",
    "method": "cmems_bbox_subset_0083",
    "source_model": "cmems_mod_glo_wav_anfc_0.083deg",
}


def island_region_id(region: dict) -> str:
    """
    The product's region_id. Prefixed so a serving tier can recognise the lane by id alone, and so it
    can never collide with `global_mid` / `global_coarse` / an existing regional tile.
    """
    return "island_" + region["id"]


def flat_coordinate_pairs(region: dict, resolution: float = ISLAND_RESOLUTION):
    """
    The region's lattice as two parallel flat arrays — the shape fetch_euro_marine expects.

    _fetch_sync returns one point dict per input coordinate, so these arrays define the output grid
    exactly; the bbox it derives from them is only used to bound the CMEMS subset.
    """
    lats, lngs = region_axes(region, resolution)
    flat_lat, flat_lng = [], []
    for la in lats:
        for lo in lngs:
            flat_lat.append(la)
            flat_lng.append(lo)
    return flat_lat, flat_lng


async def ingest_copernicus_island_regions_impl(scheduler) -> bool:
    """
    Ingests the 0.083° CMEMS wave field for each island region, one subset call per region.
    Returns True if any region saved a product.
    """
    if os.environ.get("COPERNICUS_ISLAND_INGEST", "1") == "0":
        logger.info("[Pipeline Scheduler] Copernicus island lane disabled (COPERNICUS_ISLAND_INGEST=0).")
        return False

    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    days = int(os.environ.get("COPERNICUS_ISLAND_DAYS", "2" if env["is_test_env"] else "10"))

    limit = ISLAND_REGIONS
    _lim = os.environ.get("COPERNICUS_ISLAND_REGION_LIMIT")
    if _lim:
        try:
            n = int(_lim)
            if n > 0:
                limit = ISLAND_REGIONS[:n]
        except ValueError:
            logger.warning(f"[Pipeline Scheduler] Ignoring non-integer COPERNICUS_ISLAND_REGION_LIMIT={_lim!r}.")

    logger.info(
        f"[Pipeline Scheduler] Starting Copernicus ISLAND ingestion: {len(limit)} regions, "
        f"{sum(r['cells'] for r in limit)} cells, {days}d, res {ISLAND_RESOLUTION}."
    )

    total_saved = 0
    roll_call = []
    for region in limit:
        rid = island_region_id(region)
        bbox = {"west": region["west"], "south": region["south"],
                "east": region["east"], "north": region["north"]}
        try:
            flat_lat, flat_lng = flat_coordinate_pairs(region)
            from services.copernicus_marine_service import fetch_euro_marine
            results = await fetch_euro_marine(flat_lat, flat_lng, days)
            if not results:
                # Not an exception: CMEMS can answer with nothing. Record it as a MISS rather than
                # letting an empty save look like a success.
                roll_call.append(f"{region['id']}=EMPTY")
                logger.warning(f"[Pipeline Scheduler] Island {region['id']}: Copernicus returned no points.")
                continue

            saved_here = 0
            for layer in ISLAND_LAYERS:
                saved_here += await normalize_and_save_loop(
                    scheduler.normalizer, scheduler.store, results,
                    model="EURO", provider="copernicus", domain="marine", layer=layer,
                    bbox=bbox, resolution=ISLAND_RESOLUTION, run_time=run_time,
                    region_id=rid, coverage_mode="regional_tile",
                    is_test_env=env["is_test_env"],
                    # step=1: CMEMS is natively 3-hourly, so every entry is a real frame. A step of 3
                    # would silently discard two thirds of the horizon.
                    step=1,
                    log_prefix=f"[Pipeline Scheduler] EURO {layer} island/{region['id']}",
                    estimate_basis=ISLAND_BASIS,
                )
            total_saved += saved_here
            roll_call.append(f"{region['id']}={saved_here}")
            logger.info(
                f"[Pipeline Scheduler] Island {region['id']}: {len(results)} pts "
                f"({region['cells']} expected) -> {saved_here} products."
            )
        except Exception as e:
            # One region's failure must not cost the other nineteen.
            roll_call.append(f"{region['id']}=ERR")
            logger.error(
                f"[Pipeline Scheduler] Island {region['id']} ingest failed: {type(e).__name__}: {e}",
                exc_info=True,
            )

    ok = sum(1 for x in roll_call if not x.endswith(("=ERR", "=EMPTY", "=0")))
    logger.info(
        f"[Pipeline Scheduler] Copernicus ISLAND ingestion done: {total_saved} products, "
        f"{ok}/{len(limit)} regions OK. Roll-call: {' '.join(roll_call)}"
    )
    return total_saved > 0
