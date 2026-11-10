"""The offline harness's REAL FRAMES loaders (split from serve_synthetic.py 2026-11-09, unchanged; it re-exports these names)."""
import json
import math
import sys
from pathlib import Path

from synthetic_constants import BACKEND, COARSE, COARSE_RES, COVERAGE, REGIONAL_RES, RES


# REAL FRAMES (2026-10-22, the mid-zoom instant scrub): `--real-frames <dir>` replaces the synthetic GFS waves global_mid
# products with the REAL published field, decoded from a local copy of the public weather-frames bucket (v1/latest.json, the run
# index it points at, and every frame the index lists). /grid and /grid_series then clip the same numbers the CDN frames carry,
# so a frame cropped in the browser can be compared node by node with the resolver's own clip, and the probe's product ids are
# the real ones. Values are written exactly as the client codec rebuilds them (staticFrameCodec.buildVectors: height 4 dp,
# direction and period 2 dp, confidence 4 dp, u = -h sin d and v = -h cos d at 4 dp for uv convention 0). The 10-deg
# global_coarse is every 5th node of the same field (a lab stand-in, not production's block mean; diagnostics say so).
# Models and layers other than GFS waves stay synthetic.
def _real_vectors(dec, stride=1, north_cap=None):
    """The client codec's node values (staticFrameCodec.buildVectors) for a decoded RSWF frame, every `stride`-th node."""
    cols, rows = dec["cols"], dec["rows"]
    west, south, east, north = dec["bounds"]
    sign = 1.0 if dec["uv_convention"] == 1 else -1.0
    H, D, P, C = (dec["fields"].get(k) for k in (0, 1, 2, 3))
    r2, r4 = (lambda x: round(x + 0.0, 2)), (lambda x: round(x + 0.0, 4))
    vectors = []
    for r in range(0, rows, stride):
        lat = round(south + r * (north - south) / (rows - 1), 6)
        if north_cap is not None and lat > north_cap:
            continue
        for c in range(0, cols, stride):
            i = r * cols + c
            lng = round(west + c * (east - west) / (cols - 1), 6)
            h = H[i]
            d = r2(D[i]) if D and D[i] is not None else 0.0
            p = r2(P[i]) if P and P[i] is not None else None
            q = r4(C[i]) if C and C[i] is not None else None
            if h is None:
                vectors.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": d, "u": 0.0, "v": 0.0, "period": p,
                                "is_valid": False, "dir_confidence": q})
                continue
            s = r4(h)
            rad = math.radians(d)
            vectors.append({"lat": lat, "lng": lng, "speed": s, "direction": d, "u": r4(sign * s * math.sin(rad)),
                            "v": r4(sign * s * math.cos(rad)), "period": p, "is_valid": True, "dir_confidence": q})
    return vectors


def real_regional_products(frames_dir, region_ids):
    """[(region_id, filename, body, resolution)] for every GFS waves REGIONAL set in `frames_dir`'s latest.json whose bundle is on disk
    and whose region is in `region_ids` (2026-10-24, the regional z7-9 instant scrub): each frame is the REAL stored tile, sliced from
    the published bundle (a gzip member, byte for byte the per-frame object) and written as the product the resolver's Step 3 clips,
    so a bundle frame cropped in the browser can be compared node by node with the resolver's own tile clip."""
    sys.path.insert(0, str(BACKEND))
    from services.frame_binary import decode_frame
    root = Path(frames_dir)
    latest = json.loads((root / "v1" / "latest.json").read_text(encoding="utf-8"))
    out = []
    for key, entry in sorted(latest.get("sets", {}).items()):
        parts = key.split("/")
        if len(parts) != 4 or parts[:3] != ["GFS", "marine", "waves"] or parts[3].startswith("global_") or parts[3] not in region_ids:
            continue
        if not entry.get("bundle") or not (root / entry["bundle"]["path"]).exists() or not (root / entry["index"]).exists():
            continue
        index = json.loads((root / entry["index"]).read_text(encoding="utf-8"))
        bundle = (root / entry["bundle"]["path"]).read_bytes()
        common = index.get("common_meta") or {}
        cov = index["grid"]["bounds"]
        for fr in index["frames"]:
            if fr.get("offset") is None:
                continue
            dec = decode_frame(bundle[fr["offset"]:fr["offset"] + fr["length"]])
            meta = {**common, **(fr.get("meta") or {})}
            vectors = _real_vectors(dec)
            lats = sorted({v["lat"] for v in vectors}); lngs = sorted({v["lng"] for v in vectors})
            filename = meta["product_id"]
            body = {
                "model": "GFS", "domain": "marine", "layer": "waves", "run_time": meta.get("run_time"),
                "model_run_time": meta.get("model_run_time"), "model_run_time_status": meta.get("model_run_time_status") or "known",
                "ingested_at": meta.get("ingested_at"), "valid_time": fr["valid_time"],
                "is_forecast_authoritative": bool(meta.get("is_forecast_authoritative", True)), "is_estimated": bool(fr.get("is_estimated")),
                "estimate_basis": meta.get("estimate_basis"), "coverage": dict(cov),
                "grid": {"bounds": {"west": lngs[0], "south": lats[0], "east": lngs[-1], "north": lats[-1]}, "cols": len(lngs),
                         "rows": len(lats), "vectors": vectors, "diagnostics": {"source": "stored"}},
                "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft", "product_id": filename,
                "source_variables": meta.get("source_variables") or ["wave_height"], "freshness_sec": meta.get("freshness_sec") or 3600,
                "region_id": parts[3], "resolution": None, "coverage_mode": "regional_tile",
                "provider": meta.get("provider") or "open-meteo", "upstream_provider": meta.get("upstream_provider") or "noaa",
                "source_dataset": meta.get("source_dataset") or "ncep_gfswave025",
            }
            out.append((parts[3], filename, body, REGIONAL_RES))
    return out


def real_frame_products(frames_dir):
    """[(filename, body, resolution)] for the GFS waves global_mid run in `frames_dir` and its derived global_coarse."""
    sys.path.insert(0, str(BACKEND))
    from services.frame_binary import decode_frame
    root = Path(frames_dir)
    latest = json.loads((root / "v1" / "latest.json").read_text(encoding="utf-8"))
    index = json.loads((root / latest["sets"]["GFS/marine/waves/global_mid"]["index"]).read_text(encoding="utf-8"))
    common = index.get("common_meta") or {}
    r2, r4 = (lambda x: round(x + 0.0, 2)), (lambda x: round(x + 0.0, 4))
    out = []
    for fr in index["frames"]:
        if not fr.get("path"):
            continue
        dec = decode_frame((root / fr["path"]).read_bytes())
        cols, rows = dec["cols"], dec["rows"]
        west, south, east, north = dec["bounds"]
        sign = 1.0 if dec["uv_convention"] == 1 else -1.0
        H, D, P, C = (dec["fields"].get(k) for k in (0, 1, 2, 3))
        meta = {**common, **(fr.get("meta") or {})}
        for region_id, stride, res in (("global_mid", 1, RES), ("global_coarse", 5, COARSE_RES)):
            vectors = []
            for r in range(0, rows, stride):
                lat = round(south + r * (north - south) / (rows - 1), 6)
                if region_id == "global_coarse" and lat > COARSE["north"]:
                    continue
                for c in range(0, cols, stride):
                    i = r * cols + c
                    lng = round(west + c * (east - west) / (cols - 1), 6)
                    h = H[i]
                    d = r2(D[i]) if D and D[i] is not None else 0.0
                    p = r2(P[i]) if P and P[i] is not None else None
                    q = r4(C[i]) if C and C[i] is not None else None
                    if h is None:
                        vectors.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": d, "u": 0.0, "v": 0.0, "period": p,
                                        "is_valid": False, "dir_confidence": q})
                        continue
                    s = r4(h)
                    rad = math.radians(d)
                    vectors.append({"lat": lat, "lng": lng, "speed": s, "direction": d, "u": r4(sign * s * math.sin(rad)),
                                    "v": r4(sign * s * math.cos(rad)), "period": p, "is_valid": True, "dir_confidence": q})
            lats = sorted({v["lat"] for v in vectors})
            lngs = sorted({v["lng"] for v in vectors})
            bounds = {"west": lngs[0], "south": lats[0], "east": lngs[-1], "north": lats[-1]}
            stamp = fr["valid_time"].replace("-", "").replace(":", "")
            filename = (meta.get("product_id") if region_id == "global_mid"
                        else f"gfs_marine_waves_global_coarse_{stamp}.json")
            body = {
                "model": "GFS", "domain": "marine", "layer": "waves", "run_time": meta.get("run_time"),
                "model_run_time": meta.get("model_run_time"), "model_run_time_status": meta.get("model_run_time_status") or "known",
                "ingested_at": meta.get("ingested_at"), "valid_time": fr["valid_time"],
                "is_forecast_authoritative": bool(meta.get("is_forecast_authoritative", True)),
                "is_estimated": bool(fr.get("is_estimated")), "estimate_basis": meta.get("estimate_basis"),
                "coverage": COVERAGE,
                "grid": {"bounds": bounds, "cols": len(lngs), "rows": len(lats), "vectors": vectors,
                         "diagnostics": {"source": "stored" if region_id == "global_mid" else "lab_every_5th_real_node"}},
                "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft", "product_id": filename,
                "source_variables": meta.get("source_variables") or ["wave_height"], "freshness_sec": meta.get("freshness_sec") or 3600,
                "region_id": region_id, "resolution": None, "coverage_mode": "global_tile",
                "provider": meta.get("provider") or "open-meteo", "upstream_provider": meta.get("upstream_provider") or "noaa",
                "source_dataset": meta.get("source_dataset") or "ncep_gfswave025",
            }
            out.append((filename, body, res))
    return out, index
