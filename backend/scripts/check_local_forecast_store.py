"""Validate private conformed files; never reads env files or contacts providers."""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "backend"))
from services.weather_pipeline.schemas import NormalizedProduct


def main(require_complete, require_current_cycle=False):
    folder = root / ".logfire" / "weather_products"
    manifest_bytes = (folder / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    cycle = json.loads((root / ".logfire" / "full-forecast-cycle.json").read_text(encoding="utf-8"))
    cycle_started = datetime.fromisoformat(cycle["started_at"])
    older_products = 0
    groups = defaultdict(lambda: {"products": 0, "non_estimated": 0, "estimated": 0,
                                 "valid_vectors": 0, "first_valid": None, "last_valid": None,
                                 "sources": set(), "regions": defaultdict(int),
                                 "model_run_time_statuses": defaultdict(int), "model_run_times": set()})
    filenames = set()
    content_digest = hashlib.sha256()
    coarse_times = defaultdict(set)
    mid_times = defaultdict(set)
    invalid_products = []
    for row in manifest["products"]:
        try:
            assert row["filename"] not in filenames, "Duplicate manifest filename"
            filenames.add(row["filename"])
            path = (folder / row["filename"]).resolve()
            assert path.parent == folder.resolve(), "Product path escaped isolated store"
            product_bytes = path.read_bytes()
            content_digest.update(row["filename"].encode("utf-8") + b"\0" + hashlib.sha256(product_bytes).digest())
            product = NormalizedProduct.model_validate_json(product_bytes)
            if product.run_time < cycle_started:
                older_products += 1
            assert not product.is_test_fixture, "Fixture product cannot qualify live ingestion"
            assert (product.model, product.domain, product.layer) == (row["model"], row["domain"], row["layer"])
            assert product.grid and product.grid.rows > 0 and product.grid.cols > 0, "Invalid grid dimensions"
            assert len(product.grid.vectors) == product.grid.rows * product.grid.cols, "Grid vector count mismatch"
            valid = [v for v in product.grid.vectors if v.is_valid]
            assert valid, "Product has no valid vectors"
            assert all(all(value is None or math.isfinite(value) for value in
                           (v.lat, v.lng, v.speed, v.direction, v.u, v.v, v.period, v.gust,
                            v.value, v.dir_confidence, v.phys_speed, v.speed_spread))
                       for v in valid), "Non-finite valid vector"
            assert product.valid_time == datetime.fromisoformat(row["valid_time_start"].replace("Z", "+00:00")), "Manifest start time mismatch"
            assert product.valid_time == datetime.fromisoformat(row["valid_time_end"].replace("Z", "+00:00")), "Manifest end time mismatch"
        except Exception as exc:
            invalid_products.append({"filename": row.get("filename"),
                                     "group": "/".join(str(row.get(k, "missing")) for k in ("model", "domain", "layer")),
                                     "region": row.get("region_id"), "valid_time": row.get("valid_time_start"),
                                     "reason": (str(exc) or "Product invariant failed") if isinstance(exc, AssertionError)
                                               else type(exc).__name__})
            continue
        group = groups[(product.model, product.domain, product.layer)]
        group["products"] += 1
        group["estimated" if product.is_estimated else "non_estimated"] += 1
        group["valid_vectors"] += len(valid)
        stamp = product.valid_time.isoformat()
        group["first_valid"] = min(group["first_valid"] or stamp, stamp)
        group["last_valid"] = max(group["last_valid"] or stamp, stamp)
        group["sources"].add(product.source_dataset or "missing")
        group["regions"][product.region_id or "missing"] += 1
        group["model_run_time_statuses"][product.model_run_time_status] += 1
        group["model_run_times"].add(product.model_run_time.isoformat() if product.model_run_time else "missing")
        if product.region_id == "global_coarse":
            coarse_times[(product.model, product.domain, product.layer)].add(product.valid_time)
        if product.region_id == "global_mid":
            mid_times[(product.model, product.domain, product.layer)].add(product.valid_time)
    result = {"cycle_id": cycle["run_id"], "cycle_status": cycle["status"],
              "checked_at": datetime.now(timezone.utc).isoformat(),
              "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
              "product_content_sha256": content_digest.hexdigest(),
              "manifest_stable_during_validation": (folder / "manifest.json").read_bytes() == manifest_bytes,
              "products_checked": len(manifest["products"]),
              "products_validated": len(manifest["products"]) - len(invalid_products),
              "invalid_products": invalid_products, "older_than_current_cycle": older_products, "groups": {
        "/".join(key): {**value, "sources": sorted(value["sources"]),
                        "model_run_times": sorted(value["model_run_times"])}
        for key, value in sorted(groups.items())}}
    required = {(m, d, layer) for m in ("GFS", "EURO", "ICON")
                for d, layer in (("wind", "wind"), ("marine", "waves"), ("weather", "pressure"))}
    result["missing_core_groups"] = ["/".join(key) for key in sorted(required - groups.keys())]
    components = {(m, "marine", layer) for m in ("GFS", "EURO", "ICON")
                  for layer in ("swell_1", "wind_waves")}
    components.add(("GFS", "marine", "swell_2"))
    components.add(("EURO", "marine", "swell_2"))
    result["missing_marine_component_groups"] = ["/".join(key) for key in sorted(components - groups.keys())]
    result["global_coarse_coverage"] = {}
    for key, times in sorted(coarse_times.items()):
        first, last = min(times), max(times)
        expected_times = {first + timedelta(hours=3 * i)
                          for i in range(int((last - first).total_seconds() // 10800) + 1)}
        result["global_coarse_coverage"]["/".join(key)] = {
            "first_valid": first.isoformat(), "last_valid": last.isoformat(),
            "unique_times": len(times),
            "missing_interior_three_hour_slots": [t.isoformat() for t in sorted(expected_times - times)]}
    result["incomplete_coarse_lanes"] = [key for key, value in result["global_coarse_coverage"].items()
                                         if key.split('/')[1] in ('wind', 'marine')
                                         and value["missing_interior_three_hour_slots"]]
    result["global_mid_coverage"] = {}
    for key, times in sorted(mid_times.items()):
        first, last = min(times), max(times)
        expected = {first + timedelta(hours=3*i)
                    for i in range(int((last-first).total_seconds() // 10800)+1)}
        result["global_mid_coverage"]["/".join(key)] = {
            "unique_times": len(times),
            "missing_interior_three_hour_slots": [t.isoformat() for t in sorted(expected-times)]}
    result["incomplete_mid_lanes"] = [key for key, value in result["global_mid_coverage"].items()
                                      if key.split('/')[1] in ('wind', 'marine')
                                      and value["missing_interior_three_hour_slots"]]
    (root / ".logfire" / "conformed-store-validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
    if invalid_products:
        raise SystemExit(1)
    if require_complete and (result["missing_core_groups"] or result["missing_marine_component_groups"]):
        raise SystemExit(1)
    if require_complete and (result["incomplete_coarse_lanes"] or result["incomplete_mid_lanes"]):
        raise SystemExit(1)
    if require_complete and not result["manifest_stable_during_validation"]:
        raise SystemExit(1)
    if require_current_cycle and older_products:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--require-current-cycle", action="store_true")
    args = parser.parse_args()
    main(args.require_complete, args.require_current_cycle)
