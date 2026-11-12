"""s8_direction_period_offline.py: the OFFLINE first reading of S8/S7 v2 (swell direction and period skill, paired),
from public archives only. It never calls the Raw Surf backend, Supabase or any credentialed service.

SOURCES
  * Truth: NDBC realtime2 standard-meteorological files (last 45 days): WVHT, DPD (dominant = PEAK period), APD (average
    period, NDBC computes it as Tm02) and MWD (direction FROM at the dominant period), the observation nearest each hour
    (within 30 min). Buoys: NDBC wave buoys within --buoy-km of an active catalogue spot (peak_period_validation.py's
    selection), coasts from skill_consensus.region_of (the ledger's NDBC-id rule); Great Lakes and "other" excluded.
  * Forecasts: Open-Meteo's archived PREVIOUS RUNS of the same three wave models we ingest, one pipeline for all three:
      GFS  = `ncep_gfswave025`: wave_direction = DIRPW (peak direction), wave_period = PERPW (PEAK period)
      EURO = `ecmwf_wam025`:   wave_direction = mwd (energy-MEAN direction), wave_peak_period = pp1d (PEAK),
                               wave_period = mwp (MEAN period; graded with the Tm-1,0 class, never against DPD)
      ICON = `dwd_gwam`:       wave_direction = mwd (MEAN direction), wave_period = tm10 (Tm-1,0, MEAN); no peak period
    `<var>_previous_dayN` is the value from the run issued about N days before the valid hour: lead >= 24N h, up to
    24N h plus the model's run spacing (GFS/ECMWF 6 h, GWAM 12 h). Buckets 24/48/72 are those, not the ledger's exact
    lead. `--gfs-aws-check K` re-reads K days of GFS-Wave f024/f048/f072 straight from NOAA's public AWS bucket
    (noaa-gfs-bdp-pds, byte ranges of DIRPW/PERPW) at the synoptic hours and reports how far Open-Meteo's archive sits
    from the source GRIB at the same buoys, so the reading is not an artefact of the archive.
  * Persistence: the buoy's own MWD / DPD / APD at (target - 24N h). Climatology: the buoy's circular-mean MWD and mean
    DPD/APD over the window BEFORE the graded one (skill_direction_period_paired, MIN_CLIM obs).

GRADING is skill_direction_period_paired.paired_direction_period_report, the same code the ledger lane runs under
FORECAST_SKILL_DIRPER_PAIRED: rows are built in the ledger's shape, so the reading is also the lane's end-to-end test
on real data. On top it adds a buoy-cluster bootstrap (whole buoys resampled, so the hourly autocorrelation inside a
buoy does not inflate n) of consensus minus best member and best member minus persistence.

USAGE (from backend/):
    python scripts/s8_direction_period_offline.py --out <dir> [--start 2026-10-03 --end 2026-11-09 --holdout-days 21]
        [--cache-dir <dir>] [--gfs-aws-check 4]
"""
import argparse
import json
import math
import os
import random
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)
sys.path.insert(0, HERE)

import peak_period_validation as ppv  # noqa: E402  (shared NDBC/Open-Meteo plumbing, on-disk cache)
from services.weather_pipeline import skill_direction_period_paired as s8  # noqa: E402
from services.weather_pipeline.skill_consensus import region_of  # noqa: E402

OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"
MODELS = {"raw_surf": "ncep_gfswave025", "raw_surf:EURO": "ecmwf_wam025", "raw_surf:ICON": "dwd_gwam"}
DAYS = (1, 2, 3)
GFS_AWS = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{d}/{c:02d}/wave/gridded/gfswave.t{c:02d}z.global.0p25.f{f:03d}.grib2"


# ── truth ───────────────────────────────────────────────────────────────────────────────────────────────────────
def ndbc_hourly(buoy_id):
    """{hour datetime: {hs, dpd, apd, mwd, obs_time}} from realtime2: per hour the nearest record (<= 30 min) with the
    fewest missing wave fields, one record per hour so every field verifies against the same observation."""
    try:
        txt = ppv.get(ppv.NDBC_RT.format(id=buoy_id), timeout=40).decode("utf-8", "replace")
    except Exception:
        return {}

    def num(x):
        return None if x == "MM" else float(x)
    best = {}
    for line in txt.splitlines():
        f = line.split()
        if line.startswith("#") or len(f) < 12:
            continue
        try:
            t = datetime(int(f[0]), int(f[1]), int(f[2]), int(f[3]), int(f[4]), tzinfo=timezone.utc)
            hs, dpd, apd, mwd = num(f[8]), num(f[9]), num(f[10]), num(f[11])
        except ValueError:
            continue
        if hs is None:
            continue
        hour = (t + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)
        # nearest COMPLETE record first: realtime2 leaves DPD 'MM' on 30-50% of wave lines (measured 2026-11-11)
        off = (sum(v is None for v in (dpd, apd, mwd)), abs((t - hour).total_seconds()))
        if off[1] <= 1800 and (hour not in best or off < best[hour][0]):
            best[hour] = (off, {"hs": hs, "dpd": dpd, "apd": apd, "mwd": mwd, "obs_time": t.isoformat()})
    return {h: v[1] for h, v in best.items()}


# ── forecasts ───────────────────────────────────────────────────────────────────────────────────────────────────
def om_previous_runs(buoys, model, start, end, batch=20):
    """{buoy_id: {"time": [...], var: [...]}} of `_previous_dayN` variables for one model."""
    variables = [f"{v}_previous_day{n}" for n in DAYS for v in ("wave_direction", "wave_period", "wave_peak_period")]
    out = {}
    for i in range(0, len(buoys), batch):
        chunk = buoys[i:i + batch]
        q = {"latitude": ",".join(f"{b['lat']:.4f}" for b in chunk), "longitude": ",".join(f"{b['lon']:.4f}" for b in chunk),
             "hourly": ",".join(variables), "models": model, "timezone": "UTC", "cell_selection": "sea",
             "start_date": start.strftime("%Y-%m-%d"), "end_date": end.strftime("%Y-%m-%d")}
        body = json.loads(ppv.get(OM_MARINE + "?" + urllib.parse.urlencode(q), timeout=180))
        if isinstance(body, dict) and body.get("error"):
            raise RuntimeError(f"Open-Meteo error ({model}): {body.get('reason')}")
        for b, loc in zip(chunk, body if isinstance(body, list) else [body]):
            h = dict(loc.get("hourly") or {})
            h["_grid"] = (loc.get("latitude"), loc.get("longitude"))
            out[b["id"]] = h
        time.sleep(8.0)
    return out


def build_rows(buoys, obs, fc, start, end, step_h):
    """Scored ledger-shaped rows: three member lanes + persistence per (buoy, target, lead)."""
    rows = []
    for b in buoys:
        bid, ob = b["id"], obs.get(b["id"]) or {}
        idx = {}
        for src, model in MODELS.items():
            h = fc[model].get(bid) or {}
            idx[src] = (h, {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): i for i, t in enumerate(h.get("time", []))})
        t = start
        while t <= end:
            o = ob.get(t)
            if o is not None:
                base = {"buoy_id": bid, "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"), "obs_time": o["obs_time"],
                        "obs_hs_m": o["hs"], "obs_dpd_s": o["dpd"], "obs_apd_s": o["apd"], "obs_mwd_deg": o["mwd"]}
                for n in DAYS:
                    lead = 24.0 * n
                    for src, (h, ti) in idx.items():
                        i = ti.get(t)
                        if i is None:
                            continue
                        row = dict(base, source=src, lead_h=lead,
                                   dir_deg=_at(h, f"wave_direction_previous_day{n}", i))
                        if src == "raw_surf:ICON":
                            row.update(tp_s=_at(h, f"wave_period_previous_day{n}", i), tp_kind="tm10", dir_kind="mean")
                        elif src == "raw_surf:EURO":
                            row.update(tp_s=_at(h, f"wave_peak_period_previous_day{n}", i), tp_kind="peak",
                                       tp_mean_s=_at(h, f"wave_period_previous_day{n}", i), tp_mean_kind="tm10",
                                       dir_kind="mean")
                        else:
                            row.update(tp_s=_at(h, f"wave_period_previous_day{n}", i), tp_kind="peak", dir_kind="peak")
                        rows.append(row)
                    p = ob.get(t - timedelta(hours=lead))
                    if p is not None:
                        rows.append(dict(base, source="persistence", lead_h=lead, dir_deg=p["mwd"], tp_s=p["dpd"],
                                         tp_kind="peak", tp_mean_s=p["apd"], tp_mean_kind="obs_apd", dir_kind="obs"))
            t += timedelta(hours=step_h)
    return rows


def _at(h, var, i):
    v = h.get(var) or []
    return v[i] if i < len(v) else None


# ── GFS source cross-check (NOAA AWS GRIB) ──────────────────────────────────────────────────────────────────────
def gfs_aws_check(buoys, fc_gfs, days, end):
    """|Open-Meteo previous_dayN - NOAA GRIB f(24N)| for DIRPW/PERPW at the buoys, 00Z cycles, `days` days."""
    try:
        import eccodes
    except ImportError:
        return {"status": "skipped", "reason": "eccodes not installed"}
    import urllib.request
    res = {"per_lead": {}, "cycles": []}
    for k in range(days):
        cyc = (end - timedelta(days=k + 4)).replace(hour=0)
        for n in DAYS:
            url = GFS_AWS.format(d=cyc.strftime("%Y%m%d"), c=0, f=24 * n)
            try:
                idx = ppv.get(url + ".idx", timeout=60).decode()
            except Exception as e:
                res["cycles"].append({"cycle": cyc.isoformat(), "lead": 24 * n, "error": type(e).__name__})
                continue
            lines = idx.strip().splitlines()
            fields = {}
            for j, ln in enumerate(lines):
                p = ln.split(":")
                if p[3] in ("DIRPW", "PERPW") and p[4] == "surface":
                    stop = lines[j + 1].split(":")[1] if j + 1 < len(lines) else ""
                    req = urllib.request.Request(url, headers={**ppv.UA, "Range": f"bytes={p[1]}-{stop and int(stop) - 1}"})
                    with urllib.request.urlopen(req, timeout=120) as r:
                        msg = eccodes.codes_new_from_message(r.read())
                    vals = eccodes.codes_get_values(msg)
                    ni, nj = eccodes.codes_get(msg, "Ni"), eccodes.codes_get(msg, "Nj")
                    la1, lo1 = eccodes.codes_get(msg, "latitudeOfFirstGridPointInDegrees"), eccodes.codes_get(msg, "longitudeOfFirstGridPointInDegrees")
                    dj, di = eccodes.codes_get(msg, "jDirectionIncrementInDegrees"), eccodes.codes_get(msg, "iDirectionIncrementInDegrees")
                    miss = eccodes.codes_get(msg, "missingValue")
                    eccodes.codes_release(msg)
                    fields[p[3]] = (vals, ni, nj, la1, lo1, dj, di, miss)
            if len(fields) < 2:
                continue
            valid = cyc + timedelta(hours=24 * n)
            acc = res["per_lead"].setdefault(str(24 * n), {"dir": [], "per": []})
            for b in buoys:
                h = fc_gfs.get(b["id"]) or {}
                glat, glon = h.get("_grid", (None, None))
                times = h.get("time", [])
                key = valid.strftime("%Y-%m-%dT%H:%M")
                if glat is None or key not in times:
                    continue
                i = times.index(key)
                vals, ni, nj, la1, lo1, dj, di, miss = fields["DIRPW"]
                jj = int(round(abs(glat - la1) / dj))
                ii = int(round(((glon - lo1) % 360.0) / di)) % ni
                gd, gp = vals[jj * ni + ii], fields["PERPW"][0][jj * ni + ii]
                od, op = _at(h, f"wave_direction_previous_day{n}", i), _at(h, f"wave_period_previous_day{n}", i)
                if gd != miss and od is not None:
                    acc["dir"].append(abs(s8.signed_circular_diff(od, gd)))
                if gp != miss and op is not None:
                    acc["per"].append(abs(op - gp))
            res["cycles"].append({"cycle": cyc.isoformat(), "lead": 24 * n, "ok": True})
    for lead, a in res["per_lead"].items():
        for k in ("dir", "per"):
            v = sorted(a[k])
            a[k] = {"n": len(v), "median_abs": v[len(v) // 2] if v else None,
                    "p90_abs": v[int(0.9 * len(v))] if v else None,
                    "share_exact": round(sum(1 for x in v if x < (1.0 if k == "dir" else 0.06)) / len(v), 3) if v else None}
    return res


# ── buoy-cluster bootstrap ──────────────────────────────────────────────────────────────────────────────────────
def cluster_bootstrap(by_buoy, metric, a, b, reps=2000, seed=11):
    """95% interval of pooled MAE(a) - MAE(b) with whole buoys resampled. by_buoy: {buoy: {cand: {n, metric}}}."""
    cells = [(c[a]["n"], c[a][metric], c[b][metric]) for c in by_buoy.values()
             if c.get(a, {}).get(metric) is not None and c.get(b, {}).get(metric) is not None]
    if len(cells) < 5:
        return None

    def diff(sample):
        n = sum(x[0] for x in sample)
        return sum(x[0] * (x[1] - x[2]) for x in sample) / n
    rng = random.Random(seed)
    ds = sorted(diff([rng.choice(cells) for _ in cells]) for _ in range(reps))
    return {"point": round(diff(cells), 3), "lo95": round(ds[int(0.025 * reps)], 3), "hi95": round(ds[int(0.975 * reps)], 3),
            "n_buoys": len(cells)}


def bootstraps(rep):
    out = {}
    for lead, e in rep["by_lead"].items():
        o = out.setdefault(lead, {})
        for block, metric in (("direction", "mae_deg"), ("period_peak", "mae_s"), ("period_tm10", "mae_s")):
            blk = e.get(block)
            if not blk or not blk.get("by_buoy") or not blk.get("best_member"):
                continue
            best = blk["best_member"]
            o[block] = {"best_member": best,
                        "persistence_minus_best": cluster_bootstrap(blk["by_buoy"], metric, "persistence", best),
                        "climatology_minus_best": cluster_bootstrap(blk["by_buoy"], metric, "climatology", best)}
            if "consensus_equal" in blk["all"]:
                o[block]["consensus_minus_best"] = cluster_bootstrap(blk["by_buoy"], metric, "consensus_equal", best)
    return out


def markdown(rep, boot, check):
    nm = {"raw_surf": "GFS", "raw_surf:EURO": "EURO", "raw_surf:ICON": "ICON", "consensus_equal": "consensus",
          "persistence": "persistence", "climatology": "climatology"}
    md = ["# S8/S7 v2 offline first reading", "", f"window graded: {rep['cutoff']} .. +{rep['holdout_days']} d; "
          f"members {', '.join(nm[m] for m in rep['members'])}", ""]
    for lead, e in sorted(rep["by_lead"].items(), key=lambda x: int(x[0])):
        d = e["direction"]
        md.append(f"## lead {lead} h -- direction (n={d['n']} paired keys; consensus beats best: "
                  f"{d.get('consensus_beats_best')})")
        md.append("| candidate | MAE deg | circ bias deg | RMS | p90 |")
        md.append("|---|---|---|---|---|")
        for c, s in d["all"].items():
            md.append(f"| {nm.get(c, c)} | {s.get('mae_deg')} | {s.get('circ_bias_deg')} | {s.get('rms_deg')} | {s.get('p90_deg')} |")
        md.append("")
        md.append("| coast | n | " + " | ".join(nm.get(c, c) for c in d["all"]) + " |")
        md.append("|---|---|" + "---|" * len(d["all"]))
        for g, cell in d["by_region"].items():
            n = next(iter(cell.values()))["n"]
            md.append(f"| {g} | {n} | " + " | ".join(f"{cell[c].get('mae_deg')} / {cell[c].get('circ_bias_deg')}"
                                                     for c in d["all"]) + " |")
        for kind in ("peak", "tm10"):
            p = e.get("period_" + kind)
            if not p:
                continue
            md.append("")
            md.append(f"### period {kind}: {p['label']} (n={p['n']}; exact definition: {p['definition_exact']})")
            md.append("| candidate | MAE s | bias s | RMSE s |")
            md.append("|---|---|---|---|")
            for c, s in p["all"].items():
                md.append(f"| {nm.get(c, c)} | {s.get('mae_s')} | {s.get('bias_s')} | {s.get('rmse_s')} |")
            md.append("")
            md.append("| coast | n | " + " | ".join(nm.get(c, c) for c in p["all"]) + " |")
            md.append("|---|---|" + "---|" * len(p["all"]))
            for g, cell in p["by_region"].items():
                n = next(iter(cell.values()))["n"]
                md.append(f"| {g} | {n} | " + " | ".join(f"{cell[c].get('mae_s')} / {cell[c].get('bias_s')}"
                                                         for c in p["all"]) + " |")
        md.append("")
        md.append(f"bootstrap (buoy clusters): `{json.dumps(boot.get(lead))}`")
        md.append("")
    md.append(f"GFS archive vs NOAA AWS GRIB: `{json.dumps(check.get('per_lead') if isinstance(check, dict) else check)}`")
    return "\n".join(md) + "\n"


def _strip(rep):
    out = json.loads(json.dumps(rep))
    for e in out["by_lead"].values():
        for blk in e.values():
            if isinstance(blk, dict):
                blk.pop("by_buoy", None)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--start", default="2026-10-03")
    ap.add_argument("--end", default="2026-11-09")
    ap.add_argument("--holdout-days", type=int, default=21)
    ap.add_argument("--step-h", type=int, default=3)
    ap.add_argument("--buoy-km", type=float, default=100.0)
    ap.add_argument("--max-buoys", type=int, default=0)
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--gfs-aws-check", type=int, default=0)
    a = ap.parse_args()
    if a.cache_dir:
        ppv.CACHE_DIR = a.cache_dir
    os.makedirs(a.out, exist_ok=True)
    start = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc, hour=21)
    buoys = [b for b in ppv.ndbc_wave_buoys(ppv.load_spots(), a.buoy_km) if region_of(b["id"]) != "other"]
    if a.max_buoys:
        buoys = buoys[:a.max_buoys]
    print(f"[s8] {len(buoys)} buoys", flush=True)
    obs = {b["id"]: ndbc_hourly(b["id"]) for b in buoys}
    buoys = [b for b in buoys if obs.get(b["id"])]
    print(f"[s8] {len(buoys)} buoys with realtime2 waves", flush=True)
    om_start = start - timedelta(days=1)
    fc = {m: om_previous_runs(buoys, m, om_start, end) for m in MODELS.values()}
    rows = build_rows(buoys, obs, fc, start, end, a.step_h)
    now = end + timedelta(hours=1)
    rep = s8.paired_direction_period_report(rows, now, primary="GFS", holdout_days=a.holdout_days, env={}, by_buoy=True)
    boot = bootstraps(rep)
    check = gfs_aws_check(buoys, fc["ncep_gfswave025"], a.gfs_aws_check, end) if a.gfs_aws_check else {"status": "not run"}
    meta = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "instrument": "backend/scripts/s8_direction_period_offline.py", "args": vars(a),
            "n_buoys": len(buoys), "n_rows": len(rows), "buoys": {b["id"]: region_of(b["id"]) for b in buoys},
            "models": MODELS, "lead_semantics": "Open-Meteo previous_dayN: run issued ~N days before the valid hour "
                                                "(lead 24N h up to 24N h + run spacing)"}
    full = {"meta": meta, "report": rep, "bootstrap": boot, "gfs_aws_check": check}
    with open(os.path.join(a.out, "s8_offline_full.json"), "w", encoding="utf-8") as fh:
        json.dump(full, fh, indent=1)
    with open(os.path.join(a.out, "s8_offline.json"), "w", encoding="utf-8") as fh:
        json.dump({**full, "report": _strip(rep)}, fh, indent=1)
    md = markdown(rep, boot, check)
    with open(os.path.join(a.out, "s8_offline.md"), "w", encoding="utf-8") as fh:
        fh.write(md)
    print(md)


if __name__ == "__main__":
    main()
