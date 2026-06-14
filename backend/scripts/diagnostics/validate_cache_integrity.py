#!/usr/bin/env python
import os
import sys
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Ensure project root is in path
sys.path.append(str(Path(__file__).parent.parent.parent))

from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.schemas import NormalizedProduct
from services.weather_pipeline.copernicus_validator import validate_copernicus_product_helper

def print_section(title):
    print(f"\n==================================================")
    print(f" {title}")
    print(f"==================================================")

def validate_cache():
    print_section("CACHE INTEGRITY AND VALIDATION CHECK")
    
    store = ProductStore()
    manifest = store.get_manifest()
    
    if not store.cache_dir.exists():
        print("[X] Cache directory does not exist.")
        return
        
    files = [f for f in os.listdir(store.cache_dir) if f.endswith(".json") and f != "manifest.json" and f != "dynamic_products_index.json" and (f.startswith("gfs_") or f.startswith("icon_") or f.startswith("euro_"))]
    print(f"Scanning {len(files)} cached product files on disk...\n")
    
    validated_count = 0
    invalid_count = 0
    zero_energy_count = 0
    future_dated_count = 0
    contract_mismatches = 0
    
    now = datetime.now(timezone.utc)
    
    for filename in files:
        filepath = store.cache_dir / filename
        try:
            with open(filepath, "r") as f:
                data = json.load(f)
            
            product = NormalizedProduct.model_validate(data)
            
            # Check validation rules
            valid, reason = validate_copernicus_product_helper(store, product, manifest)
            
            # Check for zero energy wave products
            is_marine = product.domain.lower() == "marine" and product.layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
            nonzero_count = 0
            if product.grid and product.grid.diagnostics:
                nonzero_count = product.grid.diagnostics.get("nonzeroCount", 0)
                
            if is_marine and nonzero_count == 0:
                zero_energy_count += 1
                
            # Check for future-dated anomaly
            if (product.valid_time.replace(tzinfo=timezone.utc) if product.valid_time.tzinfo is None else product.valid_time) > now + timedelta(days=30):
                future_dated_count += 1
                print(f"  [FUTURE DATE] {filename}: valid_time is {product.valid_time}")
            
            # Check dimension matches
            if product.grid:
                expected_len = product.grid.cols * product.grid.rows
                actual_len = len(product.grid.vectors)
                if expected_len != actual_len:
                    contract_mismatches += 1
                    print(f"  [CONTRACT MISMATCH] {filename}: expected {expected_len} vectors, got {actual_len}")

            if not valid:
                invalid_count += 1
                print(f"  [INVALID] {filename}: {reason}")
            else:
                validated_count += 1
                
        except Exception as e:
            invalid_count += 1
            print(f"  [PARSE ERROR] {filename}: {e}")

    print_section("CACHE VALIDATION REPORT SUMMARY")
    print(f"  Total cached files scanned:  {len(files)}")
    print(f"  Valid Copernicus products:  {validated_count}")
    print(f"  Invalid / Corrupted files:  {invalid_count}")
    print(f"  Zero-Energy Marine Grids:   {zero_energy_count} [!]")
    print(f"  Future-Dated Anomalies:     {future_dated_count} [!]")
    print(f"  Grid Dimension Mismatches:  {contract_mismatches} [X]")
    
    if invalid_count > 0 or zero_energy_count > 0 or future_dated_count > 0 or contract_mismatches > 0:
        print("\n  [!] WARNING: Anomalies detected in your local cache files. Run a quarantine cleanse.")
    else:
        print("\n  [OK] SUCCESS: Cache integrity verified. All local grid files comply with active contracts.")

if __name__ == "__main__":
    validate_cache()
