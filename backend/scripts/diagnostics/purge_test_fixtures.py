import os
import sys
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("purge_test_fixtures")

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))

# Deliberate L2 maintenance tool — designated writer (audit #28 gate in store.py).
os.environ.setdefault("L2_WRITER", "1")

from services.weather_pipeline.store import ProductStore, _manifest_executor

async def main():
    store = ProductStore()
    logger.info(f"Loaded ProductStore with cache_dir: {store.cache_dir}")
    
    # 1. Load manifest
    manifest = store.get_manifest()
    logger.info(f"Total products in manifest before purge: {len(manifest.products)}")
    
    test_fixtures = []
    real_products = []
    
    for p in manifest.products:
        # Check if is_test_fixture is True or filename contains estimated/mock features
        is_tf = getattr(p, "is_test_fixture", False) is True
        if is_tf:
            test_fixtures.append(p)
        else:
            real_products.append(p)
            
    logger.info(f"Identified {len(test_fixtures)} test fixture products to purge.")
    logger.info(f"Retaining {len(real_products)} real products.")
    
    if not test_fixtures:
        logger.info("No test fixtures found to purge. Exiting.")
        return

    # 2. Delete test fixtures locally and on Supabase L2
    purged_count = 0
    for idx, p in enumerate(test_fixtures):
        filename = p.filename
        
        # Local delete
        local_path = store.cache_dir / filename
        if local_path.exists():
            try:
                local_path.unlink()
                logger.info(f"[{idx+1}/{len(test_fixtures)}] Deleted local file: {filename}")
            except Exception as e:
                logger.error(f"Failed to delete local file {filename}: {e}")
        else:
            logger.debug(f"Local file {filename} does not exist.")
            
        # Supabase L2 delete
        try:
            store._delete_from_supabase(filename)
            logger.info(f"[{idx+1}/{len(test_fixtures)}] Deleted from Supabase Storage L2: {filename}")
            purged_count += 1
        except Exception as e:
            logger.error(f"Failed to delete {filename} from Supabase L2: {e}")
            
    # 3. Update manifest and save
    manifest.products = real_products
    manifest.last_manifest_update = datetime.now(timezone.utc)
    
    try:
        # Save manifest locally
        store._save_manifest(manifest)
        logger.info("Saved updated manifest.json registry locally.")
        
        # Upload manifest to Supabase Storage L2
        manifest_json = manifest.model_dump_json(indent=2).encode("utf-8")
        store._upload_to_supabase("manifest.json", manifest_json)
        logger.info("Uploaded purged manifest.json registry to Supabase Storage L2.")
        
    except Exception as e:
        logger.error(f"Failed to update manifest: {e}")
        
    logger.info(f"Purge process complete. Purged: {purged_count} items.")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
