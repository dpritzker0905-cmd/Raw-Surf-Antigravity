#!/usr/bin/env python3
"""rework_exposure_run.py - ONE window of the SURF_EXPOSURE_RECONCILED rework (pre-registered:
docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/exposure-partitioned-preregistration.md).

The evaluation harness (eval_harness.run, production parity) with two run-time additions, then three OFFLINE arms:
  1. BHC on EVERY arm: each job's GFS marine crop goes through the production `bight_hs_consensus.compose` with the
     EURO WAM `swh` of ECMWF open data (AWS `ecmwf-forecasts`, 0.25 deg `wave` stream) of the same cycle and step;
     06/18 Z take the previous 00/12 Z run at step + 6. The served replay is therefore served-plus-BHC.
  2. The GFS partitions (SWELL/SWPER/SWDIR 1-2, WVHGT/WVPER/WVDIR, one extra byte range of the same wave file) are
     sampled at every anchor spot with the production PointSampler and kept beside the job.
  Then, per anchor row, the candidate's hs_station = served hs_station x f_cand / f_served (model_hs_at_station is
  linear in the exposure factor; f_served is recomputed from the row and checked against the replayed value):
     E1  sqrt(sum w_i x_i)                 partition-wise, reconciled curve   (candidate)
     E2  sqrt(sum w_i (0.55 + 0.45 x_i)^2)  partition-wise, served curve       (candidate)
     R   sqrt(x_bulk)                       round 7's flag, after BHC          (reference)
  Writes replay_served.json (by the harness), replay_E1.json, replay_E2.json, replay_R.json, rework_exposure.json.
Public data only, no secret, the harness's network guard (one host added here: ECMWF's AWS open-data bucket).

    python scripts/rework_exposure_run.py --stations scripts/eval_harness_stations_ca.json \
        --start 2024-12-01T00:00Z --end 2024-12-28T18:00Z --cache-dir /tmp/c --out /tmp/out_W1
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
from datetime import timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (BACKEND, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import numpy as np  # noqa: E402
import eval_harness as eh  # noqa: E402
from services.weather_pipeline import bight_hs_consensus as B  # noqa: E402
from services.weather_pipeline import eval_gfswave as gw  # noqa: E402
from services.weather_pipeline import eval_grib2 as g2  # noqa: E402
from services.weather_pipeline import eval_provenance as pv  # noqa: E402

EURO_HOST = "ecmwf-forecasts.s3.eu-central-1.amazonaws.com"
EURO_URL = "https://" + EURO_HOST + "/{d}/{hh}z/ifs/0p25/wave/{d}{hh}0000-{step}h-wave-fc.{ext}"
PART_KEYS = ("WVHGT", "SWELL:1", "SWELL:2", "WVPER", "SWPER:1", "SWPER:2", "WVDIR", "SWDIR:1", "SWDIR:2")
PART_LAYERS = (("swell_1", "SWELL:1", "SWPER:1", "SWDIR:1", "swell"), ("swell_2", "SWELL:2", "SWPER:2", "SWDIR:2", "swell"),
               ("wind_waves", "WVHGT", "WVPER", "WVDIR", "windsea"))
COUNT = {}
STATE = {"stations": [], "euro": {}, "parts": {}}


def bump(k, n=1):
    COUNT[k] = COUNT.get(k, 0) + n


def retrying_get(url, rng=None, **kw):
    """pv.http_get with backoff on throttling (S3 SlowDown 503 / 429) and transient network errors."""
    for i in range(6):
        try:
            return pv.http_get(url, rng=rng, **kw)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or i == 5:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if i == 5:
                raise
        bump("http_retry")
        time.sleep(2 ** i)


# ---------------- EURO swh (ECMWF open data on AWS) ----------------
def euro_field(cache, cycle, fh):
    """(values south->north, meta) of EURO swh valid at cycle + fh, or None. 06/18 Z -> previous 00/12 Z, step + 6."""
    c, step = (cycle, fh) if cycle.hour in (0, 12) else (cycle - timedelta(hours=6), fh + 6)
    key = (c, step)
    if key in STATE["euro"]:
        return STATE["euro"][key]
    out = None
    d, hh = f"{c:%Y%m%d}", f"{c:%H}"
    try:
        raw, _ = cache.fetch(f"euro/{d}{hh}/s{step:03d}.index", EURO_URL.format(d=d, hh=hh, step=step, ext="index"),
                             source="ecmwf_open_data_index", parser="json lines", time_standard="UTC (run + step)")
        ent = next(e for e in (json.loads(x) for x in raw.decode("utf-8").splitlines() if x.strip())
                   if e.get("param") == "swh")
        lo, n = int(ent["_offset"]), int(ent["_length"])
        buf, _ = cache.fetch(f"euro/{d}{hh}/s{step:03d}.swh.grib2", EURO_URL.format(d=d, hh=hh, step=step, ext="grib2"),
                             (lo, lo + n - 1), source="ecmwf_open_data_grib2", parser="eval_grib2.decode_span",
                             time_standard="UTC (run + step)")
        arr, meta = g2.decode_span(buf, ["swh"], ["swh"])["swh"]
        arr = np.where(arr > 9000, np.nan, arr)
        out = (arr, meta)
        bump("euro_same_cycle" if c == cycle else "euro_prev_cycle")
    except pv.BudgetExceeded:
        raise
    except Exception as e:                                               # noqa: BLE001 - counted, BHC then no-ops
        bump("euro_missing")
        bump("euro_err_" + type(e).__name__)
    STATE["euro"][key] = out
    return out


def euro_at(field, lat, lng):
    v, m = field
    i = int(round((lat - m["lat_south"]) / m["dlat"]))
    j = int(round(((lng % 360.0) - m["lon_west"]) / m["dlon"])) % m["ni"]
    if not 0 <= i < m["nj"]:
        return None
    x = float(v[i, j])
    return x if math.isfinite(x) else None


def euro_product(m25, field):
    """A EURO 'waves' product on the GFS crop's own nodes (round 7's substitution, w = 0.5: no emulation)."""
    from services.weather_pipeline.schemas import GridVector
    vs = []
    for g in m25.grid.vectors:
        e = euro_at(field, g.lat, g.lng)
        if e is None:
            vs.append(GridVector(lat=g.lat, lng=g.lng, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0,
                                 is_valid=False))
            continue
        k = e / g.speed if g.is_valid and g.speed and g.speed > 0 else 0.0
        vs.append(GridVector(lat=g.lat, lng=g.lng, speed=round(e, 4), direction=g.direction, u=round(g.u * k, 4),
                             v=round(g.v * k, 4), period=g.period or 10.0, is_valid=True))
    return m25.model_copy(update={"model": "EURO", "provider": "ecmwf_open_data", "product_id": "euro-open-data",
                                  "grid": m25.grid.model_copy(update={"vectors": vs})})


# ---------------- GFS partitions ----------------
def fetch_partitions(cache, cycle, fh, decoder):
    backend = g2.select_backend(decoder)
    fields, _ = gw._span(cache, gw.urls(cycle, fh)["wave"], f"gfs/{cycle:%Y%m%d%H}/f{fh:03d}/wave", list(PART_KEYS),
                         list(PART_KEYS), "gfs_wave_grib2", backend)
    return fields


def parts_at(fields, lat, lng, cycle, valid):
    """[{h, tp, dir, kind}] at (lat, lng): the production PointSampler on a per-layer product of a 0.5-deg crop."""
    from services.weather_pipeline.sampler import PointSampler
    from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
    arr, meta = fields["SWELL:1"]
    i0, j0 = g2.index_of(meta, lat, lng)
    rows = [i for i in range(i0 - 1, i0 + 3) if 0 <= i < meta["nj"]]
    cols = list(range(j0 - 1, j0 + 3))
    lats = [round(meta["lat_south"] + i * meta["dlat"], 4) for i in rows]
    lngs = []
    for j in cols:
        x = (meta["lon_west"] + (j % meta["ni"]) * meta["dlon"]) % 360.0
        lngs.append(round(x - 360.0 if x > 180.0 else x, 4))
    bnd = CoverageBounds(west=min(lngs), south=min(lats), east=max(lngs), north=max(lats))
    sampler, out = PointSampler(), []
    for layer, hk, tk, dk, kind in PART_LAYERS:
        vecs = []
        for i, la in zip(rows, lats):
            for j, lo in zip(cols, lngs):
                hs, tp, dr = (g2.value_at(fields[k][0], fields[k][1], i, j) for k in (hk, tk, dk))
                if hs is None or dr is None or not hs > 0:
                    vecs.append(GridVector(lat=la, lng=lo, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0,
                                           is_valid=False))
                    continue
                r = math.radians(dr)
                vecs.append(GridVector(lat=la, lng=lo, speed=round(hs, 4), direction=round(dr, 2),
                                       u=round(-hs * math.sin(r), 4), v=round(-hs * math.cos(r), 4),
                                       period=round(tp, 2) if tp is not None else 0.0, is_valid=True))
        prod = NormalizedProduct(
            domain="marine", layer=layer, value_kind="wave_height", value_unit="m", display_unit_hint="ft",
            source_variables=[hk, tk, dk], grid=NormalizedGrid(bounds=bnd, cols=len(lngs), rows=len(lats), vectors=vecs),
            model="GFS", provider="noaa_gfs_aws_archive", run_time=cycle, model_run_time=cycle,
            model_run_time_status="known", valid_time=valid, is_forecast_authoritative=True, is_estimated=False,
            coverage=bnd, freshness_sec=0, source_dataset="rework replay: gfswave.global.0p25 partitions (AWS)")
        p = getattr(sampler.sample_point(prod, lat, lng), "point", None)
        if p is not None and p.speed and p.speed > 0 and p.period and p.direction is not None:
            out.append({"h": float(p.speed), "tp": float(p.period), "dir": float(p.direction), "kind": kind})
    return out


# ---------------- the harness hooks ----------------
def make_fields_fn(decoder):
    def fields_fn(cache, c, fh, wind_source="auto", decoder=decoder):
        fields, recs, info = gw.fetch_fields(cache, c, fh, wind_source=wind_source, decoder=decoder)
        try:
            pf = fetch_partitions(cache, c, fh, decoder)
            for st in STATE["stations"]:            # sampled now: a global field is never kept past its (cycle, fh)
                if st["role"] != "nearshore":
                    continue
                a = st["anchor_spot"]
                STATE["parts"][(st["id"], f"{c:%Y%m%d%H}", fh)] = parts_at(pf, a["lat"], a["lng"], c,
                                                                           c + timedelta(hours=fh))
            del pf
        except pv.BudgetExceeded:
            raise
        except Exception as e:                                           # noqa: BLE001 - counted
            bump("parts_err_" + type(e).__name__)
        euro_field(cache, c, fh)
        return fields, recs, info
    return fields_fn


_orig_stage = eh.stage_forecast


def stage_forecast(cache, stations, targets, leads, out_dir, fields_fn, wind_source, decoder):
    jobs, fc = _orig_stage(cache, stations, targets, leads, out_dir, fields_fn, wind_source, decoder)
    for j in jobs:
        m = j["products"]["marine"]
        field = STATE["euro"].get((j["cycle"], j["fh"]) if j["cycle"].hour in (0, 12)
                                  else (j["cycle"] - timedelta(hours=6), j["fh"] + 6))
        if field is None:
            bump("jobs_no_euro")
            continue
        out = B.compose(m, lambda la, lo, p=euro_product(m, field): p)
        if out is None:
            bump("jobs_outside_bight")
            continue
        j["products"] = dict(j["products"], marine=out)
        bump("jobs_bhc_composed")
    return jobs, fc


# ---------------- the offline arms ----------------
def x_of(d, sn):
    return min(1.0, max(0.0, 0.10 + 0.90 * max(0.0, math.cos(math.radians(d - sn)))))


def factors(parts, d_bulk, sn, total_h, total_tp):
    """(f_served, {E1, E2, R}) for one row; a candidate equals f_served where the partitions do not represent."""
    from services.weather_pipeline.surf_partitions import partitions_represent, reconcile_partitions
    from services.weather_pipeline.surf_transform import _height_exposure_factor
    f0 = _height_exposure_factor(d_bulk, sn)
    xb = x_of(d_bulk, sn) if d_bulk is not None and sn is not None else None
    out = {"R": math.sqrt(xb) if xb is not None else f0, "E1": f0, "E2": f0}
    if sn is None or not parts or not partitions_represent(parts, total_h, total_tp):
        return f0, out, False
    rp = reconcile_partitions(parts, total_h)
    e = [p["h"] ** 2 for p in rp]
    s = sum(e)
    if not s > 0:
        return f0, out, False
    w = [x / s for x in e]
    xs = [x_of(p["dir"], sn) for p in rp]
    out["E1"] = math.sqrt(sum(wi * xi for wi, xi in zip(w, xs)))
    out["E2"] = math.sqrt(sum(wi * (0.55 + 0.45 * xi) ** 2 for wi, xi in zip(w, xs)))
    return f0, out, True


def offline_arms(out_dir, stations):
    from services.weather_pipeline.nearshore_validation import model_hs_at_station
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    served = json.load(open(os.path.join(out_dir, "replay_served.json"), encoding="utf-8"))
    by_id = {s["id"]: s for s in stations}
    geo = {s["id"]: resolve_surf_geometry(float(s["lat"]), float(s["lng"])) for s in stations if s["role"] == "nearshore"}
    arms = {a: [] for a in ("E1", "E2", "R")}
    stats = {"rows": 0, "anchor": 0, "represented": 0, "recompute_max_abs_m": 0.0, "breaking_rows": 0}
    for r in served["rows"]:
        stats["rows"] += 1
        new = {a: dict(r) for a in arms}
        g = geo.get(r["station"])
        inp = r.get("inputs") or {}
        if r.get("anchor") and g is not None and r.get("hs_station_m") is not None and inp.get("offshore_hs_m"):
            stats["anchor"] += 1
            parts = STATE["parts"].get((r["station"], r["cycle"][:13].replace("-", "").replace("T", ""), r["fh"]))
            f0, fc, rep = factors(parts, inp.get("swell_from_deg"), g.shore_normal_deg, inp["offshore_hs_m"],
                                  inp.get("tp_s"))
            stats["represented"] += rep
            chk = model_hs_at_station(inp["offshore_hs_m"], inp["tp_s"], inp.get("swell_from_deg"), g.shore_normal_deg,
                                      float(by_id[r["station"]].get("depth_m") or 20.0), g.depth_m, g.shelf_width_km)
            stats["recompute_max_abs_m"] = max(stats["recompute_max_abs_m"], abs(chk - r["hs_station_m"]))
            breaking = (r.get("outputs") or {}).get("surf_regime") == "breaking"
            stats["breaking_rows"] += breaking
            for a in arms:
                k = fc[a] / f0 if f0 else 1.0
                new[a]["hs_station_m"] = round(r["hs_station_m"] * k, 4)
                o = dict(r.get("outputs") or {})
                if o.get("surf_height_m") is not None:
                    o["surf_height_m"] = round(o["surf_height_m"] * k, 4)
                new[a]["outputs"] = o
        for a in arms:
            arms[a].append(dict(new[a], arm=a))
    for a, rows in arms.items():
        pv.write_json(os.path.join(out_dir, f"replay_{a}.json"), {"arm": a, "rows": rows, "gaps": served.get("gaps")})
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--stations", required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--decoder", default="pygrib")
    ap.add_argument("--offline", action="store_true")
    a = ap.parse_args(argv)
    if EURO_HOST not in pv.ALLOWED_HOSTS:                 # ECMWF open data on AWS: public, keyless, GET only
        pv.ALLOWED_HOSTS = tuple(pv.ALLOWED_HOSTS) + (EURO_HOST,)
    from services.weather_pipeline import eval_reference as rf
    STATE["stations"] = rf.load_stations(a.stations)["stations"]
    hargs = ["run", "--stations", a.stations, "--start", a.start, "--end", a.end, "--cache-dir", a.cache_dir,
             "--out", a.out, "--decoder", a.decoder, "--wind-source", "pgrb2", "--exit-zero", "--pause-s", "0.05"]
    if a.offline:
        hargs.append("--offline")
    args = eh.parser().parse_args(hargs)
    eh.stage_forecast = stage_forecast
    os.makedirs(a.out, exist_ok=True)
    eh.run(args, get=retrying_get, fields_fn=make_fields_fn(a.decoder))
    stats = offline_arms(a.out, STATE["stations"])
    pv.write_json(os.path.join(a.out, "rework_exposure.json"), {"counts": COUNT, "offline": stats})
    print(json.dumps({"counts": COUNT, "offline": stats}, indent=1))
    if stats["anchor"] and stats["recompute_max_abs_m"] > 0.01:
        print(f"REFUSED: the recomputed served hs_station differs by {stats['recompute_max_abs_m']:.4f} m")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
