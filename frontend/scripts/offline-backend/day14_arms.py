"""day14_arms.py — the day-14 end, measured OFFLINE: what /grid serves for ICON and EURO waves at day 13 and day 14, per arm.

WHY (2026-10-25, the owner's manual test): "the ICON data is showing Saturday 13th day on the Sunday 14th day with holes in Gulf
data". Every stored ICON/EURO lane ends at RUN + 336 h while the scrubber ends at NOW + 336 h, so the last hours are a far-edge
HOLD (far_edge_hold.py). #548 built the dark fixes; the lead asked for evidence per arm before the owner chooses:
  arm 0  today: the hold as it runs now (FAR_EDGE_HOLD_PREFER_MID off -> the 10-deg frame);
  arm 1  FAR_EDGE_HOLD_PREFER_MID=1 (the 2-deg hold, where the targeted Gulf fill runs);
  arm 2  + FRAME_TAIL_DOWNLOAD=1 (the publisher builds the core lane's tails: frames where stored, parity against /grid);
  arm 3  a PROTOTYPE, never shipped from here: past the model's stored tail, the GFS 2-deg frame AT the asked hour, labelled as
         the per-model pressure layer labels its stand-in (estimate_basis.type gfs_estimated_fallback -> "GFS stand-in beyond
         this model's range"). Patched into this process only.

THE DATA IS REAL, THE SERVE IS OFFLINE. `fetch` mirrors a slice of the PUBLIC weather-frames bucket (the CDN the app reads:
latest.json, three run indices, the frames near the tail), serially and cached. `build` turns the decoded frames into stored
products exactly as serve_synthetic.real_frame_products does (the client codec's values; the 10-deg global_coarse is every 5th
node of the same field, a LAB STAND-IN for production's own coarse ingest, labelled so in its diagnostics), then bakes EURO's
estimated tail with the REAL extension job (scheduler_helpers.ingest_euro_marine_extended_estimates_impl) over those real
anchors, because EURO's published tail frames do not exist yet (not_local: the very gap FRAME_TAIL_DOWNLOAD closes). `arm N`
asks the REAL app (server.app through FastAPI's TestClient: no socket, no server) with outbound name lookups blocked, as
serve_synthetic does, one fresh process per arm so no cache crosses arms.

Credentials: none. The bucket base comes from FRAMES_BASE (the public object URL prefix of weather-frames; never committed).

  FRAMES_BASE=<https://.../storage/v1/object/public/weather-frames> python day14_arms.py fetch --copy <dir>
  python day14_arms.py build --copy <dir> --store <dir>
  python day14_arms.py arm 0 --store <dir> --out arm0.json        (1, 2 and 3 likewise; 2 also needs --cdn <dir>)
"""
import argparse
import json
import os
import shutil
import socket
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BACKEND = REPO / "backend"
SETS = {m: f"{m}/marine/waves/global_mid" for m in ("GFS", "ICON", "EURO")}
WORLD_BBOX = "-180,-80,180,85"
GULF = {"west": -98.0, "south": 18.0, "east": -80.0, "north": 31.0}   # the Gulf of Mexico basin, nodes counted inside it
HOURS = (312, 330, 333, 336)                                           # day 13; day 14 (now + 330 .. 336 h)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(ts):
    return datetime.strptime(ts[:19].replace("Z", ""), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


# ── fetch ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def _get(base, rel, dest, pause=0.25):
    """One public object, cached on disk; serial with a pause (the bucket answered 429 to 8 parallel reads on 2026-10-24)."""
    if dest.exists():
        return dest.read_bytes()
    import requests
    for attempt in range(4):
        r = requests.get(f"{base.rstrip('/')}/{rel}", timeout=60)
        if r.status_code == 429:
            time.sleep(2.0 * (attempt + 1))
            continue
        r.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.content)
        time.sleep(pause)
        return r.content
    raise RuntimeError(f"429 x4 for {rel}")


def fetch(args):
    base = os.environ.get("FRAMES_BASE")
    if not base:
        raise SystemExit("FRAMES_BASE (the public weather-frames object prefix) must be set")
    copy = Path(args.copy)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    old = json.loads((copy / "fetch_meta.json").read_text(encoding="utf-8")) if (copy / "fetch_meta.json").exists() else {}
    now = parse(old["now"]) if old.get("now") else now          # a re-fetch adds frames; the measured NOW stays the first one
    (copy / "v1").mkdir(parents=True, exist_ok=True)
    latest_path = copy / "v1" / "latest.json"
    if not old:
        latest_path.unlink(missing_ok=True)             # a first fetch reads the CURRENT pointer; a re-fetch keeps its run
    latest = json.loads(_get(base, "v1/latest.json", latest_path))
    indices = {}
    for model, key in SETS.items():
        entry = latest["sets"][key]
        indices[model] = json.loads(_get(base, entry["index"], copy / entry["index"]))
    # The EURO estimator's anchors: EURO's last NATIVE frame and GFS from there on. ICON: its frames from day 12 on.
    euro_native = [f for f in indices["EURO"]["frames"] if f.get("path") and not f.get("is_estimated")]
    euro_anchor = max(parse(f["valid_time"]) for f in euro_native)
    # ICON's last NATIVE frame (the extension job's persistence anchor) and GFS at that hour: the tail hours the index lists but
    # the CDN does not carry (not_local) are re-baked from them by the real ICON job in `build`.
    icon_native = [f for f in indices["ICON"]["frames"] if f.get("path") and not f.get("is_estimated")]
    icon_anchor = max(parse(f["valid_time"]) for f in icon_native)
    want = {
        # GFS from ICON's last native frame on (2026-10-26, `asks`): the ICON job's targets for the WHOLE tail, not only EURO's.
        "GFS": lambda vt: vt >= min(euro_anchor - timedelta(hours=3), icon_anchor),
        "ICON": lambda vt: vt >= now + timedelta(hours=args.from_hour) or vt == icon_anchor,
        "EURO": lambda vt: vt >= euro_anchor - timedelta(hours=12),
    }
    got = {}
    for model, index in indices.items():
        frames = [f for f in index["frames"] if f.get("path") and want[model](parse(f["valid_time"]))]
        for f in frames:
            _get(base, f["path"], copy / f["path"])
        got[model] = {"frames": len(frames), "first": frames[0]["valid_time"] if frames else None,
                      "last": frames[-1]["valid_time"] if frames else None,
                      "index_last": max(f["valid_time"] for f in index["frames"] if f.get("path")),
                      "unbuilt": sorted({f.get("unbuilt") for f in index["frames"] if not f.get("path")} - {None})}
    meta = {"fetched_at": iso(datetime.now(timezone.utc)), "now": iso(now), "euro_anchor": iso(euro_anchor),
            "icon_anchor": iso(icon_anchor), "sets": got,
            "indices": {m: latest["sets"][k]["index"] for m, k in SETS.items()}}
    (copy / "fetch_meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(json.dumps(meta, indent=1))


def _offline_process():
    """This process becomes the offline backend's twin (serve_synthetic.main): no Supabase variable (L2 off, nothing reaches a
    bucket or database), not a test environment (the mid tier is under study), every non-local name lookup fails at once."""
    for var in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL",
                "GITHUB_RUN_ID", "NODE_ENV", "TESTING", "PYTEST_CURRENT_TEST", "REQUESTS_CA_BUNDLE"):
        os.environ.pop(var, None)
    os.environ.setdefault("SPOT_RATINGS_V2", "0")
    real = socket.getaddrinfo

    def local_only(host, *a, **k):
        if host in (None, "", "127.0.0.1", "localhost", "::1", "testserver"):
            return real(host, *a, **k)
        raise socket.gaierror(socket.EAI_NONAME, f"day14_arms: outbound name lookup blocked ({host})")
    socket.getaddrinfo = local_only
    for p in (str(HERE), str(BACKEND)):
        if p not in sys.path:
            sys.path.insert(0, p)
    os.chdir(BACKEND)


# ── build ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def _products_from_index(copy, model, index_rel):
    """[(filename, body, resolution)]: every fetched frame of the set as its stored global_mid product, plus the lab's 10-deg
    global_coarse (every 5th node of the same field, as serve_synthetic.real_frame_products derives GFS's)."""
    import serve_synthetic as ss
    from services.frame_binary import decode_frame
    index = json.loads((copy / index_rel).read_text(encoding="utf-8"))
    common = index.get("common_meta") or {}
    out = []
    for fr in index["frames"]:
        if not fr.get("path") or not (copy / fr["path"]).exists():
            continue
        dec = decode_frame((copy / fr["path"]).read_bytes())
        meta = {**common, **(fr.get("meta") or {})}
        est = bool(fr.get("is_estimated"))
        stamp = fr["valid_time"].replace("-", "").replace(":", "")
        for region_id, stride, res in (("global_mid", 1, ss.RES), ("global_coarse", 5, ss.COARSE_RES)):
            vectors = ss._real_vectors(dec, stride, ss.COARSE["north"] if region_id == "global_coarse" else None)
            lats, lngs = sorted({v["lat"] for v in vectors}), sorted({v["lng"] for v in vectors})
            filename = (meta.get("product_id") if region_id == "global_mid"
                        else f"{model.lower()}_marine_waves_global_coarse_{stamp}{'_estimated' if est else ''}.json")
            body = {
                "model": model, "domain": "marine", "layer": "waves", "run_time": meta.get("run_time"),
                "model_run_time": meta.get("model_run_time"), "model_run_time_status": meta.get("model_run_time_status") or "known",
                "ingested_at": meta.get("ingested_at"), "valid_time": fr["valid_time"],
                "is_forecast_authoritative": bool(meta.get("is_forecast_authoritative", not est)), "is_estimated": est,
                "estimate_basis": meta.get("estimate_basis"), "coverage": meta.get("coverage") or ss.COVERAGE,
                "grid": {"bounds": {"west": lngs[0], "south": lats[0], "east": lngs[-1], "north": lats[-1]},
                         "cols": len(lngs), "rows": len(lats), "vectors": vectors,
                         "diagnostics": {"source": "stored" if region_id == "global_mid" else "lab_every_5th_real_node"}},
                "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft", "product_id": filename,
                "source_variables": meta.get("source_variables") or ["wave_height"], "freshness_sec": meta.get("freshness_sec") or 3600,
                "region_id": region_id, "resolution": None, "coverage_mode": "global_tile",
                "provider": meta.get("provider") or "open-meteo", "upstream_provider": meta.get("upstream_provider"),
                "source_dataset": meta.get("source_dataset"),
            }
            out.append((filename, body, res))
    return out, index


def _icon_tail_rebake(store, manifest, icon_end):
    """The ICON tail hours the real manifest lists but the CDN does not carry (not_local), re-baked by the REAL ICON job
    (icon_marine_extension) from the real native anchor and real GFS, in a scratch store; only hours past the last published
    tail frame and inside the real lane's end are copied in. Where the re-bake overlaps published tail frames, its heights are
    compared with them: the measure of how faithful the re-baked hours are."""
    import asyncio
    from types import SimpleNamespace
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.icon_marine_extension import ingest_icon_marine_extended_estimates_impl
    scratch = store.parent / (store.name + "_icon_rebake")
    if scratch.exists():
        shutil.rmtree(scratch)
    scratch.mkdir(parents=True)
    keep = [p for p in manifest["products"] if p["model"] == "GFS" or (p["model"] == "ICON" and not p.get("is_estimated"))]
    for p in keep:
        shutil.copyfile(store / p["filename"], scratch / p["filename"])
    (scratch / "manifest.json").write_text(json.dumps({"last_manifest_update": manifest.get("last_manifest_update"), "products": keep}),
                                           encoding="utf-8")
    os.environ["ICON_MARINE_EXTEND"], os.environ["ICON_MARINE_EXTEND_MID"] = "1", "1"
    asyncio.run(ingest_icon_marine_extended_estimates_impl(SimpleNamespace(store=ProductStore(cache_dir=scratch))))
    baked = json.loads((scratch / "manifest.json").read_text(encoding="utf-8"))["products"]
    baked = [p for p in baked if p["model"] == "ICON" and p.get("is_estimated") and p["layer"] == "waves"]
    published = {(p["region_id"], p["valid_time_start"]): p for p in manifest["products"]
                 if p["model"] == "ICON" and p.get("is_estimated") and p["layer"] == "waves"}
    last_pub = max(vt for (_r, vt) in published) if published else ""
    added, diffs = [], []
    for p in baked:
        key = (p["region_id"], p["valid_time_start"])
        if key in published:
            if p["region_id"] == "global_mid":
                a = json.loads((scratch / p["filename"]).read_text(encoding="utf-8"))["grid"]["vectors"]
                b = json.loads((store / published[key]["filename"]).read_text(encoding="utf-8"))["grid"]["vectors"]
                both = [(x["speed"], y["speed"]) for x, y in zip(a, b) if x.get("is_valid") and y.get("is_valid")]
                d = sorted(abs(x - y) for x, y in both)
                diffs.append({"valid_time": p["valid_time_start"], "nodes": len(both),
                              "valid_rebake": sum(1 for x in a if x.get("is_valid")), "valid_published": sum(1 for y in b if y.get("is_valid")),
                              "median_abs_m": round(d[len(d) // 2], 4) if d else None,
                              "p95_abs_m": round(d[int(len(d) * 0.95)], 4) if d else None, "max_abs_m": round(d[-1], 4) if d else None})
            continue
        if last_pub < p["valid_time_start"] <= icon_end:
            shutil.copyfile(scratch / p["filename"], store / p["filename"])
            manifest["products"].append(p)
            added.append((p["region_id"], p["valid_time_start"]))
    return {"rebaked_hours_added": sorted(added), "last_published": last_pub, "real_lane_end": icon_end,
            "rebake_vs_published_global_mid": diffs}


def build(args):
    _offline_process()
    import asyncio
    from types import SimpleNamespace
    import serve_synthetic as ss
    copy, store = Path(args.copy), Path(args.store)
    if (store / "manifest.json").exists():
        raise SystemExit(f"{store} already holds a store; use a fresh directory")
    store.mkdir(parents=True, exist_ok=True)
    fm = json.loads((copy / "fetch_meta.json").read_text(encoding="utf-8"))
    entries, report = [], {}
    for model, rel in fm["indices"].items():
        products, index = _products_from_index(copy, model, rel)
        for filename, body, res in products:
            (store / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
            entries.append(ss.manifest_entry(body, filename, res))
        listed = [f for f in index["frames"]]
        report[model] = {"products": len(products), "index_entries": len(listed),
                         "index_last_entry": max(f["valid_time"] for f in listed),
                         "index_last_built": max(f["valid_time"] for f in listed if f.get("path")),
                         "run": index.get("run")}
    (store / "manifest.json").write_text(json.dumps({"last_manifest_update": iso(datetime.now(timezone.utc)), "products": entries}),
                                         encoding="utf-8")
    # EURO's estimated tail, baked by the REAL core-lane job over the real anchors (its published tail frames do not exist).
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import ingest_euro_marine_extended_estimates_impl
    os.environ["EURO_MARINE_EXTEND"] = "1"
    # The live tails' ceiling (D-053, 2026-10-26: MARINE_EXT_CEILING_MARGIN_H=12 on core + pilots); the trim below still ends the
    # baked lane where the real index's entries end.
    os.environ["MARINE_EXT_CEILING_MARGIN_H"] = args.ceiling_margin
    ok = asyncio.run(ingest_euro_marine_extended_estimates_impl(SimpleNamespace(store=ProductStore(cache_dir=store))))
    manifest = json.loads((store / "manifest.json").read_text(encoding="utf-8"))
    tails = sorted(p["valid_time_start"] for p in manifest["products"]
                   if p["model"] == "EURO" and p.get("is_estimated") and p["region_id"] == "global_mid" and p["layer"] == "waves")
    # The REAL manifest's EURO tail ends where its index lists the last entry: the job's ceiling reads the anchor's run_time, which
    # the lab copies from the frame meta, so trim anything past the real lane's end (the hold starts where the real lane ends).
    euro_end = report["EURO"]["index_last_entry"]
    trimmed = [p for p in manifest["products"] if p["model"] == "EURO" and p.get("is_estimated") and p["valid_time_start"] > euro_end]
    for p in trimmed:
        (store / p["filename"]).unlink(missing_ok=True)
    manifest["products"] = [p for p in manifest["products"] if p not in trimmed]
    tails = [t for t in tails if t <= euro_end]
    report["EURO_tail"] = {"job_ok": bool(ok), "global_mid_estimated": len(tails), "first": tails[0] if tails else None,
                           "last": tails[-1] if tails else None, "trimmed_past_real_end": len(trimmed)}
    report["ICON_tail"] = _icon_tail_rebake(store, manifest, report["ICON"]["index_last_entry"])
    (store / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    report["fetch"] = fm
    (store / "build_meta.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "fetch"}, indent=1))


# ── arms ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ARM_ENV = {   # MARINE_GULF_FILL_MID_TARGETED=1 is the box's live setting (on since 2026-10-24 15:14Z); the hold itself is on by default
    "0": {},
    "1": {"FAR_EDGE_HOLD_PREFER_MID": "1"},
    "1u": {"FAR_EDGE_HOLD_PREFER_MID": "1", "FAR_EDGE_HOLD_BEFORE_UPSTREAM": "1"},
    "2": {"FAR_EDGE_HOLD_PREFER_MID": "1"},           # /grid as arm 1; the publisher builds the tails (FRAME_TAIL_DOWNLOAD=1)
    "3": {"FAR_EDGE_HOLD_PREFER_MID": "1"},           # + the GFS stand-in past the model's tail (prototype, this process only)
}


def _in_gulf(v):
    return GULF["south"] <= v["lat"] <= GULF["north"] and GULF["west"] <= v["lng"] <= GULF["east"]


def _valid(v):
    return bool(v.get("is_valid", True)) and v.get("speed") is not None


def gulf_counts(vectors):
    inside = [v for v in vectors if _in_gulf(v)]
    return {"nodes": len(inside), "valid": sum(1 for v in inside if _valid(v))}


def _stamp_time(filename):
    import re
    m = re.search(r"(\d{8}T\d{6}Z)", filename or "")
    return iso(datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)) if m else None


def install_stand_in():
    """ARM 3, a PROTOTYPE (this process only): past an ICON/EURO marine lane's stored tail, the hold gives way to the GFS 2-deg
    frame AT the asked hour (within 1.5 h), relabelled exactly as the resolver's EURO -> GFS upstream fallback relabels
    (grid_resolver.py: model = the asked model, provider gfs_estimated_fallback, estimated, not authoritative) with the basis key
    the client already words: estimate_basis.type gfs_estimated_fallback -> "GFS stand-in beyond this model's range"."""
    import asyncio
    from services.weather_pipeline import far_edge_hold as feh
    orig = feh.try_far_edge_hold

    async def stand_in(store, model, domain, layer, target_dt):
        if str(domain).lower() == "marine" and str(model).upper() in ("ICON", "EURO"):
            manifest = await asyncio.to_thread(store.get_manifest)
            lane = [p.valid_time_start for p in manifest.products
                    if str(p.model).upper() == str(model).upper() and p.domain == "marine" and p.layer == layer
                    and getattr(p, "coverage_mode", None) == "global_tile" and p.valid_time_start is not None]
            if lane and target_dt > max(lane):
                cands = [p for p in manifest.products
                         if p.model == "GFS" and p.domain == "marine" and p.layer == layer and p.region_id == "global_mid"
                         and abs((p.valid_time_start - target_dt).total_seconds()) <= 1.5 * 3600]
                if cands:
                    best = min(cands, key=lambda p: abs((p.valid_time_start - target_dt).total_seconds()))
                    prod = await asyncio.to_thread(store.load_product, best.filename)
                    if prod is not None and prod.grid and prod.grid.vectors:
                        prod = prod.model_copy(deep=True)          # never relabel a cached GFS product in place
                        prod.product_id = best.filename
                        prod.model = str(model).upper()
                        prod.provider = "gfs_estimated_fallback"
                        prod.is_estimated, prod.is_forecast_authoritative = True, False
                        prod.estimate_basis = {"type": "gfs_estimated_fallback", "method": "gfs_wave_stand_in_past_tail",
                                               "source_model": "ncep_gfswave025", "stand_in_for": str(model).upper(),
                                               "model_tail_end": max(lane).isoformat()}
                        prod.warnings = list(prod.warnings or []) + [f"gfs_stand_in_past_tail:{str(model).upper()}"]
                        return prod
        return await orig(store, model, domain, layer, target_dt)
    feh.try_far_edge_hold = stand_in


def _record(store_dir, manifest_by_file, model, hour, asked, resp):
    if resp.status_code != 200:
        return {"model": model, "hour": hour, "asked": iso(asked), "status": resp.status_code, "body": resp.text[:300]}
    p = resp.json()
    g = p.get("grid") or {}
    vectors = g.get("vectors") or []
    pid = p.get("product_id")
    stored_entry = manifest_by_file.get(pid) or {}
    stored_vt = stored_entry.get("valid_time_start") or _stamp_time(pid)
    stored_path = Path(store_dir) / pid if pid else None
    stored_gulf = (gulf_counts(json.loads(stored_path.read_text(encoding="utf-8"))["grid"]["vectors"])
                   if stored_path and stored_path.exists() else None)
    cf = p.get("coarse_fill") or {}
    basis = p.get("estimate_basis") or {}
    served_gulf = gulf_counts(vectors)
    rec = {
        "model": model, "hour": hour, "asked": iso(asked), "status": 200, "product_id": pid,
        "region_id": stored_entry.get("region_id"), "grid": f"{g.get('cols')}x{g.get('rows')}",
        "stored_valid_time": stored_vt,
        "data_age_h": round((asked - parse(stored_vt)).total_seconds() / 3600.0, 1) if stored_vt else None,
        "served_valid_time": p.get("served_valid_time"), "frame_offset_hours": p.get("frame_offset_hours"),
        "frame_substituted": p.get("frame_substituted"), "valid_time": p.get("valid_time"),
        "is_estimated": p.get("is_estimated"), "is_forecast_authoritative": p.get("is_forecast_authoritative"),
        "provider": p.get("provider"), "basis_type": basis.get("type"), "basis": basis,
        "warnings": [w for w in (p.get("warnings") or []) if "far_edge" in w or "stand_in" in w],
        "fill": {k: cf.get(k) for k in ("mode", "donor_region", "donor", "donor_product", "cells_filled") if k in cf} or None,
        "fill_donor_valid_time": _stamp_time(cf.get("donor_product")) if cf.get("donor_product") else None,
        "gulf": {**served_gulf, "stored_valid": stored_gulf["valid"] if stored_gulf else None,
                 "filled_in_gulf": (served_gulf["valid"] - stored_gulf["valid"]) if stored_gulf else None},
    }
    # The status line's inputs (marineDrawnFrame.publishMarineDrawn): the client tags the drawn grid with the ASKED model
    # (backendWeatherServiceClientHelpers: __sourceModel = model), the served time is the data instant.
    rec["label_inputs"] = {
        "requested": {"model": model, "layer": "waves", "labelMs": int(asked.timestamp() * 1000), "hour": hour},
        "drawn": {"model": model, "layer": "waves",
                  "dataMs": int(parse(p["served_valid_time"]).timestamp() * 1000) if p.get("served_valid_time") else None,
                  "estimated": bool(p.get("is_estimated")), "basisType": basis.get("type")},
    }
    return rec


def run_arm(args):
    _offline_process()
    os.environ["MARINE_GULF_FILL_MID_TARGETED"] = "1"
    for k in ("FAR_EDGE_HOLD_PREFER_MID", "FAR_EDGE_HOLD_BEFORE_UPSTREAM", "FRAME_TAIL_DOWNLOAD"):
        os.environ.pop(k, None)
    os.environ.update(ARM_ENV[args.arm])
    # Each arm reads its OWN copy of the store: whatever the app writes (a cached dynamic product, a manifest touch) cannot reach
    # another arm.
    store_dir = Path(args.store).parent / f"{Path(args.store).name}_arm{args.arm}"
    if store_dir.exists():
        shutil.rmtree(store_dir)
    shutil.copytree(args.store, store_dir)
    if args.arm == "3":
        install_stand_in()
    from fastapi.testclient import TestClient
    from server import app
    from routes import weather
    from services.weather_pipeline.store import ProductStore
    weather.store = ProductStore(cache_dir=store_dir)
    manifest = json.loads((store_dir / "manifest.json").read_text(encoding="utf-8"))
    by_file = {p["filename"]: p for p in manifest["products"]}
    now = parse(json.loads((store_dir / "build_meta.json").read_text(encoding="utf-8"))["fetch"]["now"])
    rows = []
    client = TestClient(app)          # NOT as a context manager: that would run the app's lifespan (schedulers, DB); serve_synthetic
    #                                   runs uvicorn with lifespan="off" for the same reason
    for model in ("ICON", "EURO"):
        for hour in HOURS:
            asked = now + timedelta(hours=hour)
            resp = client.get("/api/weather/grid", params={"model": model, "domain": "marine", "layer": "waves",
                                                           "valid_time": iso(asked), "bbox": WORLD_BBOX})
            rows.append(_record(store_dir, by_file, model, hour, asked, resp))
    # Same-hour reference: what GFS itself holds in the Gulf at each asked hour (the most a fill or a stand-in can show).
    for hour in HOURS:
        asked = now + timedelta(hours=hour)
        resp = client.get("/api/weather/grid", params={"model": "GFS", "domain": "marine", "layer": "waves",
                                                       "valid_time": iso(asked), "bbox": WORLD_BBOX})
        rows.append(_record(store_dir, by_file, "GFS", hour, asked, resp))
    out = {"arm": args.arm, "env": {**ARM_ENV[args.arm], "MARINE_GULF_FILL_MID_TARGETED": "1"}, "now": iso(now), "rows": rows}
    Path(args.out).write_text(json.dumps(out, indent=1), encoding="utf-8")
    keys = ("model", "hour", "status", "region_id", "grid", "stored_valid_time", "data_age_h", "served_valid_time", "basis_type",
            "fill", "fill_donor_valid_time", "gulf")
    for r in rows:
        print(json.dumps({k: r.get(k) for k in keys}))


TAIL_SETS = ("ICON/marine/waves/global_mid", "EURO/marine/waves/global_mid",
             "ICON/marine/waves/global_mid_filled", "EURO/marine/waves/global_mid_filled")


def run_publish(args):
    """ARM 2: the pilots publisher over a 'pilots disk' that lists the core lane's ICON/EURO tails in its manifest but holds none
    of their files (as live: not_local), with --tail-store-dir standing in for the products bucket. FRAME_TAIL_DOWNLOAD off (the
    control) and on; then every built ESTIMATED frame is decoded and compared node by node (frame_binary.parity) with what /grid
    serves at its valid time: a filled frame with the box's targeted fill on, a plain frame with the 2-deg fill off."""
    _offline_process()
    os.environ.update({"MARINE_GULF_FILL_MID_TARGETED": "1", "FAR_EDGE_HOLD_PREFER_MID": "1", "FRAME_SETS": ",".join(TAIL_SETS)})
    store = Path(args.store)
    disk = store.parent / f"{store.name}_pilots_disk"
    if disk.exists():
        shutil.rmtree(disk)
    shutil.copytree(store, disk)
    manifest = json.loads((store / "manifest.json").read_text(encoding="utf-8"))
    tails = [p for p in manifest["products"] if p["model"] in ("ICON", "EURO") and p.get("is_estimated")]
    for p in tails:
        (disk / p["filename"]).unlink(missing_ok=True)
    sys.path.insert(0, str(BACKEND / "scripts"))
    import publish_frame_images as pub
    from services import frame_binary as fb
    out = {"pilots_disk_tail_files_removed": len(tails), "runs": {}, "parity": []}
    for flag in ("0", "1"):
        cdn = store.parent / f"cdn_tail{flag}"
        if cdn.exists():
            shutil.rmtree(cdn)
        os.environ["FRAME_TAIL_DOWNLOAD"] = flag
        pub.main(["--store-dir", str(disk), "--out-dir", str(cdn), "--only", "frames", "--tail-store-dir", str(store)])
        latest = json.loads((cdn / "v1" / "latest.json").read_text(encoding="utf-8"))
        run = {}
        for key in TAIL_SETS:
            entry = (latest.get("sets") or {}).get(key)
            if not entry:
                run[key] = None
                continue
            index = json.loads((cdn / entry["index"]).read_text(encoding="utf-8"))
            frames = index["frames"]
            built = [f for f in frames if f.get("path")]
            run[key] = {"entries": len(frames), "built": len(built),
                        "built_estimated": sum(1 for f in built if f.get("is_estimated")),
                        "unbuilt": {r: sum(1 for f in frames if f.get("unbuilt") == r) for r in {f.get("unbuilt") for f in frames} - {None}},
                        "last_built": max((f["valid_time"] for f in built), default=None)}
            if flag == "1":
                out.setdefault("_indices", {})[key] = (cdn, index)
        out["runs"][f"FRAME_TAIL_DOWNLOAD={flag}"] = run
    from fastapi.testclient import TestClient
    from server import app
    from routes import weather
    from services.weather_pipeline.store import ProductStore
    weather.store = ProductStore(cache_dir=store)
    client = TestClient(app)
    for key, (cdn, index) in out.pop("_indices").items():
        model, filled = key.split("/")[0], key.endswith("_filled")
        os.environ["MARINE_GULF_FILL_MID"] = "1" if filled else "0"
        common = index.get("common_meta") or {}
        for f in index["frames"]:
            if not f.get("path") or not f.get("is_estimated"):
                continue
            dec = fb.decode_frame((cdn / f["path"]).read_bytes())
            resp = client.get("/api/weather/grid", params={"model": model, "domain": "marine", "layer": "waves",
                                                           "valid_time": f["valid_time"], "bbox": WORLD_BBOX})
            body = resp.json()
            chk = fb.parity(body, dec)
            meta = {**common, **(f.get("meta") or {})}
            out["parity"].append({"set": key, "valid_time": f["valid_time"], "served_valid_time": body.get("served_valid_time"),
                                  "frame_meta_valid_time": meta.get("valid_time"), "nodes": chk["nodes"], "bad": chk["bad"],
                                  "max_abs_err": chk["max_abs_err"], "uv_max_err": chk.get("uv_max_err"),
                                  "grid_fill": (body.get("coarse_fill") or {}).get("cells_filled")})
    os.environ.pop("MARINE_GULF_FILL_MID", None)
    summary = {}
    for r in out["parity"]:
        s = summary.setdefault(r["set"], {"frames": 0, "bad_frames": 0, "bad_nodes": 0, "nodes": 0, "time_mismatch": 0})
        s["frames"] += 1
        s["nodes"] += r["nodes"]
        s["bad_nodes"] += r["bad"]
        s["bad_frames"] += 1 if r["bad"] else 0
        s["time_mismatch"] += 1 if (r["served_valid_time"] or "")[:19] != r["valid_time"][:19] else 0
    out["parity_summary"] = summary
    Path(args.out).write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")
    print(json.dumps({"runs": out["runs"], "parity_summary": summary}, indent=1))


def pick_index_frame(frames, ask_s):
    """staticFrameCodec.pickIndexFrame, line for line: authoritative frames first, the nearest within +-3 h (inclusive), the first
    of equal distances in index order; else the estimated frames likewise. `asks` writes every pick to asks_picks.json so
    day14_pick_check.mjs can replay the CLIENT's own function on the same index and show the two agree."""
    for estimated in (False, True):
        best, best_d = None, None
        for f in frames:
            if bool(f.get("is_estimated")) != estimated:
                continue
            d = abs(parse(f["valid_time"]).timestamp() - ask_s)
            if d <= 3 * 3600 and (best_d is None or d < best_d):
                best, best_d = f, d
        if best is not None:
            return best
    return None


def run_asks(args):
    """FRAME_TAIL_DOWNLOAD readiness (2026-10-26, the lead): the CLIENT's view. `publish` grades each built estimated frame
    against /grid at the frame's OWN valid time, so the first EURO tail frame (15Z) read as a mismatch: /grid at 15Z serves the
    native 12Z (authoritative first). The client never shows that frame at 15Z: pickIndexFrame is authoritative-first too.
    What matters is per ASK: at every whole hour across each ICON/EURO world tail (the last native frame - 6 h to the lane's
    end + 3 h), the frame the client picks from the FRAME_TAIL_DOWNLOAD=1 index against what /grid serves for that ask, node
    by node (frame_binary.parity). A pick with no frame (none in the window, or an unbuilt entry) is not compared: the client
    asks /grid for that hour itself. Run after `publish` (it reads <store>/../cdn_tail1)."""
    _offline_process()
    os.environ.update({"MARINE_GULF_FILL_MID_TARGETED": "1", "FAR_EDGE_HOLD_PREFER_MID": "1"})
    store = Path(args.store)
    cdn = store.parent / "cdn_tail1"
    latest = json.loads((cdn / "v1" / "latest.json").read_text(encoding="utf-8"))
    from fastapi.testclient import TestClient
    from server import app
    from routes import weather
    from services import frame_binary as fb
    from services.weather_pipeline.store import ProductStore
    weather.store = ProductStore(cache_dir=store)
    client = TestClient(app)
    out = {"rows": [], "summary": {}, "picks": {}}
    for key in TAIL_SETS:
        entry = (latest.get("sets") or {}).get(key)
        if not entry:
            out["summary"][key] = "no set"
            continue
        index = json.loads((cdn / entry["index"]).read_text(encoding="utf-8"))
        frames = index["frames"]
        model, filled = key.split("/")[0], key.endswith("_filled")
        os.environ["MARINE_GULF_FILL_MID"] = "1" if filled else "0"
        native_end = max(parse(f["valid_time"]) for f in frames if not f.get("is_estimated"))
        lane_end = max(parse(f["valid_time"]) for f in frames)
        s = {"native_end": iso(native_end), "lane_end": iso(lane_end), "asks": 0, "static": 0, "to_grid": {}, "bad_asks": 0,
             "nodes": 0, "bad_nodes": 0, "time_mismatch": 0, "picked_estimated": 0}
        picks = []
        ask = native_end - timedelta(hours=6)
        while ask <= lane_end + timedelta(hours=3):
            s["asks"] += 1
            f = pick_index_frame(frames, ask.timestamp())
            picks.append({"ask": iso(ask), "pick": f["valid_time"] if f else None})
            if f is None or not f.get("path"):
                why = "no_frame" if f is None else f"unbuilt:{f.get('unbuilt')}"
                s["to_grid"][why] = s["to_grid"].get(why, 0) + 1
            else:
                dec = fb.decode_frame((cdn / f["path"]).read_bytes())
                body = client.get("/api/weather/grid", params={"model": model, "domain": "marine", "layer": "waves",
                                                               "valid_time": iso(ask), "bbox": WORLD_BBOX}).json()
                chk = fb.parity(body, dec)
                same_time = (body.get("served_valid_time") or "")[:19] == f["valid_time"][:19]
                s["static"] += 1
                s["nodes"] += chk["nodes"]
                s["bad_nodes"] += chk["bad"]
                s["bad_asks"] += 1 if chk["bad"] else 0
                s["time_mismatch"] += 0 if same_time else 1
                s["picked_estimated"] += 1 if f.get("is_estimated") else 0
                out["rows"].append({"set": key, "ask": iso(ask), "pick": f["valid_time"], "pick_estimated": bool(f.get("is_estimated")),
                                    "served_valid_time": body.get("served_valid_time"), "served_estimated": body.get("is_estimated"),
                                    "nodes": chk["nodes"], "bad": chk["bad"], "max_abs_err": chk["max_abs_err"]})
            ask += timedelta(hours=1)
        out["summary"][key] = s
        out["picks"][key] = {"index": str(cdn / entry["index"]), "picks": picks}
    os.environ.pop("MARINE_GULF_FILL_MID", None)
    Path(args.out).write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")
    (Path(args.out).parent / "asks_picks.json").write_text(json.dumps(out["picks"], indent=1), encoding="utf-8")
    print(json.dumps(out["summary"], indent=1))


def run_seam(args):
    """ARM 3's seam: how a GFS stand-in past the tail sits next to the model's last stored frame, against each model's own
    3-hour step (node by node over nodes valid in both; world and the Gulf box). Height in metres."""
    store = Path(args.store)
    manifest = json.loads((store / "manifest.json").read_text(encoding="utf-8"))

    def field(model, vt):
        for p in manifest["products"]:
            if p["model"] == model and p["region_id"] == "global_mid" and p["layer"] == "waves" and p["valid_time_start"][:19] == vt[:19]:
                return json.loads((store / p["filename"]).read_text(encoding="utf-8"))["grid"]["vectors"]
        return None

    def stats(a, b, gulf_only=False):
        pairs = [(x["speed"], y["speed"]) for x, y in zip(a, b)
                 if _valid(x) and _valid(y) and (not gulf_only or _in_gulf(x))]
        d = sorted(y - x for x, y in pairs)
        ad = sorted(abs(v) for v in d)
        if not d:
            return None
        return {"nodes": len(d), "median_abs_m": round(ad[len(ad) // 2], 3), "p95_abs_m": round(ad[int(len(ad) * 0.95)], 3),
                "mean_m": round(sum(d) / len(d), 3)}

    out = {}
    for model in ("ICON", "EURO"):
        lane = sorted(p["valid_time_start"] for p in manifest["products"]
                      if p["model"] == model and p["region_id"] == "global_mid" and p["layer"] == "waves")
        end = parse(lane[-1])
        t = lambda h: iso(end + timedelta(hours=h))   # noqa: E731
        m_end, m_prev = field(model, t(0)), field(model, t(-3))
        g_end, g_next, g_next2 = field("GFS", t(0)), field("GFS", t(3)), field("GFS", t(6))
        rows = {
            f"{model} own 3-h step ({t(-3)[11:16]} -> {t(0)[11:16]}Z)": (m_prev, m_end),
            f"GFS own 3-h step ({t(0)[11:16]} -> {t(3)[11:16]}Z)": (g_end, g_next),
            f"{model} vs GFS at the same hour ({t(0)[11:16]}Z): the model gap": (m_end, g_end),
            f"THE SEAM: {model} {t(0)[11:16]}Z -> GFS stand-in {t(3)[11:16]}Z": (m_end, g_next),
            f"{model} {t(0)[11:16]}Z held -> GFS stand-in {t(6)[11:16]}Z": (m_end, g_next2),
        }
        out[model] = {"lane_end": lane[-1],
                      "rows": {k: {"world": stats(a, b), "gulf": stats(a, b, True)} if a and b else None for k, (a, b) in rows.items()}}
    Path(args.out).write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--copy", required=True)
    f.add_argument("--from-hour", type=float, default=288.0, help="ICON frames from now + this many hours")
    b = sub.add_parser("build")
    b.add_argument("--copy", required=True)
    b.add_argument("--store", required=True)
    b.add_argument("--ceiling-margin", default="12", help="MARINE_EXT_CEILING_MARGIN_H for the baked tails (live: 12, D-053)")
    a = sub.add_parser("arm")
    a.add_argument("arm", choices=sorted(ARM_ENV))
    a.add_argument("--store", required=True)
    a.add_argument("--out", required=True)
    for name in ("publish", "seam", "asks"):
        s = sub.add_parser(name)
        s.add_argument("--store", required=True)
        s.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    {"fetch": fetch, "build": build, "arm": run_arm, "publish": run_publish, "seam": run_seam, "asks": run_asks}[args.cmd](args)


if __name__ == "__main__":
    main()
