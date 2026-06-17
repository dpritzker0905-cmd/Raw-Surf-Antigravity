import os
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List

from services.weather_pipeline.store import ProductStore, _get_supabase_storage, WEATHER_BUCKET

logger = logging.getLogger(__name__)

async def prefetch_supabase_products():
    """
    Prefetches conformed GFS Marine Waves products from Supabase Storage (L2) to local disk (L1) sequentially.
    Runs in the background after startup to ensure that when users view the map or scrub,
    there are no blocking synchronous downloads causing 20-30s delays.
    """
    logger.info("[Prefetcher] Starting background prefetch of conformed GFS Marine Waves products...")
    store = ProductStore()
    
    try:
        manifest = await asyncio.to_thread(store.get_manifest)
    except Exception as e:
        logger.error(f"[Prefetcher] Failed to read manifest: {e}")
        return

    now = datetime.now(timezone.utc)
    is_render = os.environ.get("RENDER") == "true"
    # Active forecast window: from 6 hours ago to 8 days in the future (30 hours on Render to prevent OOM)
    start_time = now - timedelta(hours=6)
    if is_render:
        end_time = now + timedelta(hours=30)
        logger.info("[Prefetcher] Render environment detected. Capping prefetch window to +30h to reduce memory pressure.")
    else:
        end_time = now + timedelta(days=8)
    
    # Filter products: ONLY conformed GFS Marine Waves
    candidates = []
    for p in manifest.products:
        if getattr(p, "is_test_fixture", False):
            continue
        model = p.model.upper()
        domain = p.domain.lower()
        layer = p.layer.lower()
        if model == "GFS" and domain == "marine" and layer == "waves":
            if is_render and getattr(p, "region_id", "") == "global_coarse":
                continue
            p_time = p.valid_time_start
            if start_time <= p_time <= end_time:
                candidates.append(p)
            
    logger.info(f"[Prefetcher] Found {len(candidates)} active candidate GFS Marine Waves products in manifest.")
    
    # Filter out files that already exist locally
    to_download = []
    for p in candidates:
        filepath = store.cache_dir / p.filename
        if not filepath.exists():
            to_download.append(p)
            
    if not to_download:
        logger.info("[Prefetcher] All active GFS Marine Waves products are already present in L1 cache.")
        return

    logger.info(f"[Prefetcher] Need to download {len(to_download)} products from L2 storage.")

    # Prioritize: though all are GFS Marine Waves, we can process them chronological
    to_download.sort(key=lambda p: p.valid_time_start)

    async def download_file(filename: str) -> bool:
        sb = _get_supabase_storage()
        if not sb:
            logger.warning(f"[Prefetcher] Supabase client unavailable for {filename}")
            return False
            
        filepath = store.cache_dir / filename
        temp_filepath = filepath.with_suffix(".tmp")
        
        try:
            # Run the blocking download in a separate worker thread
            logger.debug(f"[Prefetcher] Downloading {filename}...")
            product_bytes = await asyncio.to_thread(
                sb.storage.from_(WEATHER_BUCKET).download, filename
            )
            if product_bytes:
                # Write to a temp file first, then rename atomically
                await asyncio.to_thread(temp_filepath.write_bytes, product_bytes)
                await asyncio.to_thread(temp_filepath.rename, filepath)
                logger.info(f"[Prefetcher] Prefetched {filename} successfully.")
                # Proactively clean up memory
                product_bytes = None
                import gc
                gc.collect()
                return True
            else:
                logger.warning(f"[Prefetcher] Downloaded empty content for {filename}")
                return False
        except Exception as e:
            logger.warning(f"[Prefetcher] Failed to prefetch {filename}: {e}")
            if temp_filepath.exists():
                try:
                    temp_filepath.unlink()
                except Exception:
                    pass
            return False

    success_count = 0
    loop_delay = 1.5 if is_render else 0.05
    for idx, p in enumerate(to_download):
        success = await download_file(p.filename)
        if success:
            success_count += 1
        # Yield control back to the event loop and add a delay to prevent resource spikes
        await asyncio.sleep(loop_delay)
        
    logger.info(f"[Prefetcher] Background prefetch completed: {success_count}/{len(to_download)} succeeded.")
