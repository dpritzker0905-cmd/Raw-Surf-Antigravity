import os
import logging
import asyncio
from datetime import datetime, timezone, timedelta

from services.weather_pipeline.store import ProductStore, _get_supabase_storage, WEATHER_BUCKET

logger = logging.getLogger(__name__)

# Layers worth warming on boot — what the map actually renders first + scrubs across. (domain, layer).
# Was GFS/marine/waves ONLY, which left wind (→ ~5min first load), EURO/ICON marine, and the swell /
# wind_waves layers cold → every first request paid the ~45s synchronous L2 download, and non-prewarmed
# layers rendered the stale prior frame ("all marine layers show the same data").
_WARM_LAYERS = {
    ("marine", "waves"),
    ("marine", "swell_1"),
    ("marine", "swell_2"),
    ("marine", "wind_waves"),
    ("wind", "wind"),
    ("weather", "pressure"),
}


def _prefetch_window_days() -> float:
    try:
        return float(os.environ.get("PREFETCH_WINDOW_DAYS", "3"))
    except Exception:
        return 3.0


def _prefetch_concurrency() -> int:
    try:
        return max(1, int(os.environ.get("PREFETCH_CONCURRENCY", "5")))
    except Exception:
        return 5


def _prefetch_max() -> int:
    try:
        return max(0, int(os.environ.get("PREFETCH_MAX", "400")))
    except Exception:
        return 400


async def prefetch_supabase_products():
    """
    Warm the serve box on boot: download the NEAR-TERM forecast products for ALL models and the layers the
    map actually renders/scrubs (marine waves + swell_1/swell_2 + wind_waves, wind, pressure) from Supabase
    Storage L2 to local disk L1, so the first user does not pay the ~45s synchronous L2 download per product.

    This is the cure for serve-only COLD-START: Render's disk is ephemeral, so every restart empties L1 and
    `restore_from_supabase` only restores the manifest (lazy product restore). Previously only GFS/marine/
    waves was prewarmed, so wind took ~5min, EURO/ICON + swell layers loaded cold, scrub froze, and cold
    layers rendered the stale prior frame.

    Priority: nearest-to-now valid_time first (so the default view + first scrub steps land first), with the
    default GFS/marine/waves layer ahead of others at the same time. Parallelized with a small bounded
    semaphore (downloads are network I/O). The lazy on-demand download in ProductStore.load_product remains
    the fallback for anything not prewarmed (e.g. far-future hours beyond the cap). Tunables (serve box):
    PREFETCH_WINDOW_DAYS (default 3), PREFETCH_CONCURRENCY (5), PREFETCH_MAX (400). Kill switch:
    PREFETCH_DISABLED=1 (reverts to fully lazy on-demand, the prior behavior).
    """
    if os.environ.get("PREFETCH_DISABLED") == "1":
        logger.info("[Prefetcher] PREFETCH_DISABLED=1 — skipping boot prewarm (lazy on-demand only).")
        return

    logger.info("[Prefetcher] Starting warm-on-boot prefetch across all models / map layers...")
    store = ProductStore()

    try:
        manifest = await asyncio.to_thread(store.get_manifest)
    except Exception as e:
        logger.error(f"[Prefetcher] Failed to read manifest: {e}")
        return

    now = datetime.now(timezone.utc)
    start_time = now - timedelta(hours=6)
    end_time = now + timedelta(days=_prefetch_window_days())

    candidates = []
    for p in manifest.products:
        if getattr(p, "is_test_fixture", False):
            continue
        if (p.domain.lower(), p.layer.lower()) not in _WARM_LAYERS:
            continue
        # MID-RES EXCLUSION (2026-07-05, the Render dev-deploy MEMORY FAILURES): `global_mid` products
        # are ~15k vectors (~1.5-3 MB JSON) — ~24x the coarse products this 400-product warm budget was
        # tuned for. With GFS 14d x 4 layers + ICON 7d x 3 layers in the manifest, the warm set filled
        # with mid products and the boot burst OOM'd the 512 MB serve box. The resolver's Step 3.6
        # loads mid products lazily per request (one ~2 MB parse on a cold hour) — boot-warming them
        # is unnecessary. Re-enable deliberately with PREFETCH_INCLUDE_MID=1.
        if getattr(p, "region_id", None) == "global_mid" and os.environ.get("PREFETCH_INCLUDE_MID", "0") != "1":
            continue
        if start_time <= p.valid_time_start <= end_time:
            candidates.append(p)

    # Only what is not already on disk L1.
    to_download = [p for p in candidates if not (store.cache_dir / p.filename).exists()]
    if not to_download:
        logger.info("[Prefetcher] All near-term warm-set products already present in L1 cache.")
        return

    def _priority(p):
        dist = abs((p.valid_time_start - now).total_seconds())
        is_default = 0 if (p.model.upper() == "GFS" and p.domain.lower() == "marine" and p.layer.lower() == "waves") else 1
        return (dist, is_default)

    to_download.sort(key=_priority)

    cap = _prefetch_max()
    if cap and len(to_download) > cap:
        logger.info(f"[Prefetcher] Capping warm set {len(to_download)} -> {cap} (nearest-hour-first); rest lazy on demand.")
        to_download = to_download[:cap]

    logger.info(
        f"[Prefetcher] Warm-on-boot: downloading {len(to_download)} near-term products "
        f"({_prefetch_window_days()}d window, conc={_prefetch_concurrency()}) across all models / map layers."
    )

    sem = asyncio.Semaphore(_prefetch_concurrency())
    counters = {"ok": 0, "fail": 0}

    async def _download_one(p):
        filename = p.filename
        filepath = store.cache_dir / filename
        if filepath.exists():
            return
        sb = _get_supabase_storage()
        if not sb:
            return
        temp_filepath = filepath.with_suffix(".tmp")
        async with sem:
            try:
                product_bytes = await asyncio.to_thread(sb.storage.from_(WEATHER_BUCKET).download, filename)
                if product_bytes:
                    await asyncio.to_thread(temp_filepath.write_bytes, product_bytes)
                    await asyncio.to_thread(temp_filepath.rename, filepath)
                    counters["ok"] += 1
                    logger.debug(f"[Prefetcher] Prewarmed {filename}")
                else:
                    counters["fail"] += 1
                    logger.warning(f"[Prefetcher] Empty content for {filename}")
            except Exception as e:
                counters["fail"] += 1
                logger.warning(f"[Prefetcher] Failed to prewarm {filename}: {e}")
                try:
                    if temp_filepath.exists():
                        temp_filepath.unlink()
                except Exception:
                    pass

    await asyncio.gather(*[_download_one(p) for p in to_download], return_exceptions=True)
    logger.info(
        f"[Prefetcher] Warm-on-boot complete: {counters['ok']} ok, {counters['fail']} failed, of {len(to_download)}."
    )
