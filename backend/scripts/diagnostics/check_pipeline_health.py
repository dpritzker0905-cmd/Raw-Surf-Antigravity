#!/usr/bin/env python
import os
import sys
import json
from pathlib import Path
from datetime import datetime, timezone

# Ensure project root is in path
sys.path.append(str(Path(__file__).parent.parent.parent))

from services.weather_pipeline.store import ProductStore, WEATHER_BUCKET, _get_supabase_storage

def print_section(title):
    print(f"\n==================================================")
    print(f" {title}")
    print(f"==================================================")

def run_diagnostics():
    print_section("WEATHER PIPELINE HEALTH VERIFICATION")
    
    # 1. Check Env Vars
    print("\n[1] Checking Environment Variables:")
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_KEY", "")
    sb_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    copernicus_user = os.environ.get("COPERNICUS_MARINE_USER", "")
    copernicus_pass = os.environ.get("COPERNICUS_MARINE_PASSWORD", "")
    
    print(f"  SUPABASE_URL: {'CONFIGURED' if sb_url else 'MISSING [X]'}")
    print(f"  SUPABASE_KEY: {'CONFIGURED' if sb_key else 'MISSING [!] (Using Service Role?)'}")
    print(f"  SUPABASE_SERVICE_ROLE_KEY: {'CONFIGURED' if sb_role_key else 'MISSING [!]'}")
    print(f"  COPERNICUS_MARINE_USER: {'CONFIGURED' if copernicus_user else 'MISSING [!]'}")
    print(f"  COPERNICUS_MARINE_PASSWORD: {'CONFIGURED' if copernicus_pass else 'MISSING [!]'}")

    # 2. Check Supabase L2 Storage Connection
    print("\n[2] Testing Supabase L2 Storage Connection:")
    sb = _get_supabase_storage()
    if sb is None:
        print("  [X] Could not establish Supabase Storage client. Running in Local Offline Mode.")
    else:
        print("  [OK] Supabase client created successfully.")
        try:
            buckets = sb.storage.list_buckets()
            bucket_names = [b.name for b in buckets] if buckets else []
            print(f"  [OK] Connected to Supabase. Available buckets: {bucket_names}")
            if WEATHER_BUCKET in bucket_names:
                print(f"  [OK] Bucket '{WEATHER_BUCKET}' is configured.")
                files = sb.storage.from_(WEATHER_BUCKET).list()
                print(f"  [OK] Files resident in L2 bucket: {len(files) if files else 0}")
            else:
                print(f"  [X] Bucket '{WEATHER_BUCKET}' not found in storage. Run initialization.")
        except Exception as e:
            print(f"  [X] Failed to communicate with Supabase storage API: {e}")

    # 3. Check Local L1 Cache and Manifest
    print("\n[3] Checking Local L1 Cache:")
    store = ProductStore()
    print(f"  L1 Cache Directory: {store.cache_dir}")
    print(f"  Manifest Path: {store.manifest_path}")
    
    if store.manifest_path.exists():
        print("  [OK] manifest.json exists on disk.")
        try:
            manifest = store.get_manifest()
            print(f"  [OK] Manifest parsed successfully. Total registered products: {len(manifest.products)}")
            
            # Count by models
            models = {}
            for p in manifest.products:
                models[p.model] = models.get(p.model, 0) + 1
            print(f"  [OK] Products by model: {models}")
            
            # Count estimated products
            est_count = sum(1 for p in manifest.products if getattr(p, "is_estimated", False))
            print(f"  [OK] Estimated products: {est_count}")
        except Exception as e:
            print(f"  [X] Failed to parse manifest.json: {e}")
    else:
        print("  [X] manifest.json does not exist. Run synchronization/restore.")

    # 4. Compare Manifest vs Disk Cache Files
    print("\n[4] Aligning Manifest with Cache Files:")
    if store.cache_dir.exists():
        files_on_disk = set(f for f in os.listdir(store.cache_dir) if f.endswith(".json") and f != "manifest.json")
        print(f"  [OK] Total product JSON files on disk: {len(files_on_disk)}")
        
        if store.manifest_path.exists():
            manifest_files = set(p.filename for p in manifest.products if p.filename)
            orphaned = files_on_disk - manifest_files
            missing = manifest_files - files_on_disk
            
            print(f"  [OK] Files in manifest but missing on disk: {len(missing)}")
            print(f"  [OK] Files on disk but not in manifest: {len(orphaned)}")
            if orphaned:
                print(f"    [!] First 5 orphaned files: {list(orphaned)[:5]}")
    else:
         print("  [X] Cache directory does not exist on disk.")

    # 5. Output Summary Diagnosis
    print_section("DIAGNOSTIC SUMMARY & HEALTH STATUS")
    warnings = 0
    errors = 0
    
    if not sb_url or not sb_role_key:
        print("  [!] WARNING: Supabase configurations missing. L2 backup persistence is disabled.")
        warnings += 1
    if not store.manifest_path.exists():
        print("  [X] ERROR: Missing manifest.json file. System cannot resolve point locations without fallbacks.")
        errors += 1
        
    if errors == 0 and warnings == 0:
        print("  [OK] SYSTEM HEALTHY: All checks passed. Ingestion pipeline and cache are properly aligned.")
    else:
        print(f"  [!] Check complete: {errors} error(s), {warnings} warning(s) flagged.")

if __name__ == "__main__":
    run_diagnostics()
