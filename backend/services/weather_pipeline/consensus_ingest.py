"""consensus_ingest.py — the equal GFS/EURO/ICON mean as a SHADOW product at ingest (roadmap stage 5, D-009).

WHY A SHADOW. The owner settled the served offshore input on 2026-09-29 (D-006: the equal three-model mean) and then
chose how it enters the pipeline (D-009): as its OWN product set first, model `CONSENSUS`, which the frontend never
requests. Rewriting the GFS tiles in place would have left the flip with only the judge's approximation as
evidence, and the skill ledger and the judge would have lost their GFS baseline (their equal arm would count EURO
and ICON twice). A shadow lets the ledger grade the exact built product on real buoy hours before any user sees it;
the flip later points the served GFS waves at it.

WHAT. After the regional pilots (GFS, then ICON, then EURO), for every GFS marine `waves` regional_tile frame of each
region's latest run: build the equal mean with consensus_product.build_equal_mean_from_choosers, each member
answered at each cell by the product the POINT RESOLVER would answer that cell from
(manifest_point_selection.point_candidates + choose_for_point, then store.load_product: the resolver's own three
steps), so every member value is what /point serves there. Save it as `CONSENSUS` (same region, valid time and grid),
then prune the region's superseded consensus runs.

  * `unblended="mask"`: a cell the members could not all answer is marked invalid rather than left as GFS's, so the
    shadow never serves a GFS-only value under the consensus name. A frame with no blended cell is not saved.
  * Provenance: model CONSENSUS, provider/upstream_provider "raw-surf", upstream_model names the three members,
    source_dataset "consensus:equal_mean", and grid.diagnostics["consensus"] carries the member products each cell
    was answered from, frame offsets, counts and the consensus/primary height ratio.
  * Point resolution for CONSENSUS never reaches an upstream: the resolver's live marine fallback runs only for
    GFS, ICON and EURO, so a CONSENSUS point reads a stored product or answers unavailable.
  * The boot prefetcher skips SHADOW_MODELS, so shadow frames never crowd served ones out of the warm set.

DARK: CONSENSUS_INGEST (default "0") registers the job in the pilots lane (scheduler/forecast.py) and adds the
`raw_surf:CONSENSUS` lane to the skill ledger (forecast_skill.compare_models). Declared in forecast-ingest-pilots.yml,
forecast-ingest.yml and precompute.yml. Changes no served number, on or off.
"""
import logging
import os
from typing import Callable, Dict, List, Optional, Tuple

from services.weather_pipeline.consensus_product import build_equal_mean_from_choosers
from services.weather_pipeline.sampler import PointSampler

logger = logging.getLogger(__name__)

CONSENSUS_MODEL = "CONSENSUS"
SHADOW_MODELS = frozenset({CONSENSUS_MODEL})
MEMBER_MODELS = ("EURO", "ICON")
PROVENANCE = {"provider": "raw-surf", "upstream_provider": "raw-surf",
              "upstream_model": "equal mean of GFS, EURO, ICON", "source_dataset": "consensus:equal_mean"}


def enabled() -> bool:
    return os.environ.get("CONSENSUS_INGEST", "0") == "1"


def primary_frames(manifest) -> Dict[str, list]:
    """{region_id: [GFS marine waves regional_tile manifest items of that region's LATEST run, by valid time]}.
    PURE."""
    from services.weather_pipeline.manifest_view import products_for
    by_region: Dict[str, list] = {}
    for p in products_for(manifest, "GFS", "marine", "waves"):
        if (p.coverage_mode or "") != "regional_tile" or not p.region_id or p.is_test_fixture:
            continue
        by_region.setdefault(p.region_id, []).append(p)
    out = {}
    for rid, items in by_region.items():
        latest = max(i.run_time for i in items)
        out[rid] = sorted((i for i in items if i.run_time == latest), key=lambda i: i.valid_time_start)
    return out


def make_chooser(manifest, model: str, target_dt, load: Callable, cache: dict) -> Callable:
    """(lat, lng) -> the product the point resolver answers that cell from for `model` at `target_dt`, or None.
    The resolver's own steps: point_candidates once per frame, choose_for_point per cell, load by filename (each
    file loaded once per `cache`)."""
    from services.weather_pipeline.manifest_point_selection import choose_for_point, point_candidates
    candidates = point_candidates(manifest, model, "marine", "waves", target_dt)

    def choose(lat, lng):
        item = choose_for_point(candidates, lat, lng)
        if item is None:
            return None
        if item.filename not in cache:
            cache[item.filename] = load(item.filename)
        return cache[item.filename]
    return choose


def as_shadow(built):
    """The built product relabelled as the CONSENSUS shadow (a copy already; mutated in place and returned)."""
    built.model = CONSENSUS_MODEL
    for k, v in PROVENANCE.items():
        setattr(built, k, v)
    built.product_id = None
    return built


def frames_by_time(frames: Dict[str, list]) -> Dict[object, list]:
    """{valid_time: [items of every region at that hour]}. PURE."""
    out: Dict[object, list] = {}
    for items in frames.values():
        for it in items:
            out.setdefault(it.valid_time_start, []).append(it)
    return out


def build_hour(manifest, items: list, load: Callable) -> Tuple[List[Tuple[object, float]], dict]:
    """The shadow frames for every region's item at ONE valid time: [(product, resolution)] and counts.

    ⭐ HOUR-MAJOR, NOT REGION-MAJOR. A frame's members are that hour's products, and the global tiers
    (global_mid, global_coarse) answer many regions at once, so all regions at one hour share one candidate scan
    and one load per member file. Region-major would download each global member file once per region, the
    fan-out that drew Supabase's 429s on 2026-09-29, and would hold a whole region's hours in memory. The cache and
    the memoized sampler live for this hour only. Synchronous (the ingest runs it in a thread). A frame whose GFS
    product cannot be loaded, whose inputs are refused, or which blends no cell is skipped and counted."""
    stats = {"frames": len(items), "built": 0, "no_blend": 0, "unloadable": 0, "refused": 0}
    if not items:
        return [], stats
    cache: dict = {}
    sampler = PointSampler(memoize=True)          # short-lived: dropped with this hour (sampler.py's rule)
    vt = items[0].valid_time_start
    choosers = {m: make_chooser(manifest, m, vt, load, cache) for m in MEMBER_MODELS}
    out = []
    for item in items:
        gfs = load(item.filename)
        if gfs is None:
            stats["unloadable"] += 1
            continue
        try:
            built = build_equal_mean_from_choosers(gfs, choosers, sampler=sampler, unblended="mask")
        except ValueError as e:
            stats["refused"] += 1
            logger.warning(f"[Consensus] {item.filename}: refused ({e})")
            continue
        if built.grid.diagnostics["consensus"]["cells"]["blended"] == 0:
            stats["no_blend"] += 1
            continue
        out.append((as_shadow(built), float(item.resolution)))
        stats["built"] += 1
    return out, stats


async def ingest_consensus_shadow_impl(scheduler) -> int:
    """The pilots-lane job: build and save every region's shadow frames, hour by hour, then prune each region's
    superseded consensus runs. Returns the number saved."""
    import asyncio
    if not enabled():
        logger.info("[Consensus] CONSENSUS_INGEST is off; skipping the shadow build.")
        return 0
    store = scheduler.store
    manifest = await asyncio.to_thread(store.get_manifest)
    frames = primary_frames(manifest)
    saved = 0
    totals = {"frames": 0, "built": 0, "no_blend": 0, "unloadable": 0, "refused": 0}
    regions_saved = set()
    for vt, items in sorted(frames_by_time(frames).items()):
        batch, stats = await asyncio.to_thread(build_hour, manifest, items, store.load_product)
        for k in totals:
            totals[k] += stats[k]
        if batch:
            saved += await asyncio.to_thread(store.save_products_batch, batch) or 0
            regions_saved.update(prod.region_id for prod, _ in batch)
    for region_id in sorted(regions_saved):
        store.prune_superseded_products(CONSENSUS_MODEL, "marine", "waves", region_id, frames[region_id][0].run_time)
    logger.info(f"[Consensus] shadow build complete: {saved} frames saved across {len(regions_saved)} regions "
                f"{totals}")
    return saved


def is_shadow(model: Optional[str]) -> bool:
    return (model or "").upper() in SHADOW_MODELS
