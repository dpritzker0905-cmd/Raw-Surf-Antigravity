import os
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List

from services.weather_pipeline.store import ProductStore, _get_supabase_storage, WEATHER_BUCKET

logger = logging.getLogger(__name__)

async def prefetch_supabase_products():
    """
    Prefetches conformed products from Supabase Storage (L2) to local disk (L1).
    Runs in the background after startup to ensure that when users view the map or scrub,
    there are no blocking synchronous downloads causing 20-30s delays.
    """
    logger.info("[Prefetcher] Starting background prefetch of conformed products...")
    store = ProductStore()
    
    try:
        manifest = await asyncio.to_thread(store.get_manifest)
    except Exception as e:
        logger.error(f"[Prefetcher] Failed to read manifest: {e}")
        return

    now = datetime.now(timezone.utc)
    # Active forecast window: from 6 hours ago to 8 days in the future
    start_time = now - timedelta(hours=6)
    end_time = now + timedelta(days=8)
    
    # Filter products
    candidates = []
    for p in manifest.products:
        if getattr(p, "is_test_fixture", False):
            continue
        # Check if product start time falls within active window
        p_time = p.valid_time_start
        if start_time <= p_time <= end_time:
            candidates.append(p)
            
    logger.info(f"[Prefetcher] Found {len(candidates)} active candidate products in manifest.")
    
    # Filter out files that already exist locally
    to_download = []
    for p in candidates:
        filepath = store.cache_dir / p.filename
        if not filepath.exists():
            to_download.append(p)
            
    if not to_download:
        logger.info("[Prefetcher] All active products are already present in L1 cache.")
        return

    logger.info(f"[Prefetcher] Need to download {len(to_download)} products from L2 storage.")

    # Prioritize downloads:
    # 1. GFS Marine Waves (critical layer)
    # 2. Other Marine layers
    # 3. Wind layers
    # 4. Other layers
    def get_priority(p) -> int:
        model = p.model.upper()
        domain = p.domain.lower()
        layer = p.layer.lower()
        if model == "GFS" and domain == "marine" and layer == "waves":
            return 0
        elif domain == "marine":
            return 1
        elif domain == "wind":
            return 2
        return 3

    to_download.sort(key=get_priority)

    # Download with a semaphore to prevent memory/port exhaustion
    sem = asyncio.Semaphore(3)
    
    async def download_file(filename: str) -> bool:
        async with sem:
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

    # Create download tasks
    tasks = [download_file(p.filename) for p in to_download]
    
    # Run in background
    results = await asyncio.gather(*tasks, return_exceptions=True)
    success_count = sum(1 for r in results if r is True)
    logger.info(f"[Prefetcher] Background prefetch completed: {success_count}/{len(to_download)} succeeded.")
