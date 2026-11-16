"""Pass 2: multi-season, land-mark-aware wave direction and height error budget (offshore buoys).

Truth: NDBC historical stdmet 2025 (hourly, WVHT/DPD/MWD; sentinels 99.00/999 = missing), nearest record to each UTC
hour within 30 min. Model: Open-Meteo marine, ncep_gfswave025, `*_previous_day1` fields (forecast made one day earlier
for the same valid time = lead 24-47 h) for 2025-01-01..2025-12-31.

LAND MARKS (shoreline logic, not relocation): an hour is a land mark when the model returns zero/null wave height AND
zero/null wave period at that cell. Stations whose land-mark share is >= 25% are reported as LAND-MARKED and excluded
from the pooled statistics. They are handed to the separate relocation lane; nothing is moved here.

Decomposition: per-station bias share of the MSE (direction and height). Out-of-sample: bias estimated on one half-year
and tested on the other, both ways. Persistence baseline: observed value 24 h earlier (same station, same filter).
Stdlib only. Writes d2_summary.json next to this script.
"""
import gzip, json, math, os, sys, time, urllib.request, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from d1_direction import STATIONS, wrap, circ_mean, mean, http_get  # reuse station list and helpers

UA = {"User-Agent": "raw-surf-research/pass2 (measured error budget; public data)"}
MISSING = {"99.00", "999", "999.0", "99.0", "MM"}


def fetch_bytes(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def stdmet_hourly(stn, year):
    raw = gzip.decompress(fetch_bytes(f"https://www.ndbc.noaa.gov/data/historical/stdmet/{stn}h{year}.txt.gz"))
    out = {}
    for line in raw.decode("utf-8", "replace").splitlines():
        if not line or line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 12:
            continue
        try:
            t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        if p[8] in MISSING or p[9] in MISSING or p[11] in MISSING:
            continue
        try:
            wvht, dpd, mwd = float(p[8]), float(p[9]), float(p[11])
        except ValueError:
            continue
        if wvht >= 99 or dpd >= 99 or mwd >= 999:
            continue
        hour = t.replace(minute=0, second=0, microsecond=0)
        dmin = (t - hour).total_seconds() / 60.0
        if dmin > 30:
            hour = hour + dt.timedelta(hours=1)
            dmin = abs((t - hour).total_seconds()) / 60.0
            if dmin > 30:
                continue
        prev = out.get(hour)
        if prev is None or abs((t - hour).total_seconds()) < prev[3]:
            out[hour] = (mwd, wvht, dpd, abs((t - hour).total_seconds()))
    return {k: v[:3] for k, v in out.items()}


def om_range(lat, lon, start, end):
    url = ("https://marine-api.open-meteo.com/v1/marine?latitude=%s&longitude=%s"
           "&hourly=wave_direction_previous_day1,wave_height_previous_day1,wave_period_previous_day1,"
           "wave_direction,wave_height,wave_period&start_date=%s&end_date=%s&models=ncep_gfswave025&timezone=GMT") % (
        lat, lon, start, end)
    d = json.loads(http_get(url))
    h = d["hourly"]
    res = {}
    for i, ts in enumerate(h["time"]):
        t = dt.datetime.fromisoformat(ts).replace(tzinfo=dt.timezone.utc)
        res[t] = {k: h[k][i] for k in h if k != "time"}
    return res


def is_land_mark(m):
    # Land/sea is a property of the grid cell, so it is read from the BEST-ESTIMATE fields (wave_height, wave_period).
    # Using the previous-day fields was a bug: they are empty for past seasons (Open-Meteo returns null for 2025),
    # which flagged every station as land (forensic finding, 2026-11-15).
    hs = m.get("wave_height")
    tp = m.get("wave_period")
    return (hs is None or hs == 0) and (tp is None or tp == 0)


def season(month):
    return {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM", 6: "JJA", 7: "JJA", 8: "JJA"}.get(month, "SON")


def stats(rows):
    if not rows:
        return {"n": 0}
    dirs = [r["e_dir"] for r in rows]
    hs = [r["e_hs"] for r in rows]
    by = {}
    for r in rows:
        by.setdefault(r["stn"], []).append(r)
    dbias = {s: circ_mean([x["e_dir"] for x in v]) for s, v in by.items()}
    hbias = {s: mean([x["e_hs"] for x in v]) for s, v in by.items()}
    mse_d = mean([e * e for e in dirs])
    mse_h = mean([e * e for e in hs])
    share_d = mean([(dbias[r["stn"]] or 0.0) ** 2 for r in rows]) / mse_d if mse_d else None
    share_h = mean([(hbias[r["stn"]]) ** 2 for r in rows]) / mse_h if mse_h else None
    # out-of-sample halves: H1 = Jan-Jun, H2 = Jul-Dec
    h1 = [r for r in rows if r["t"].month <= 6]
    h2 = [r for r in rows if r["t"].month >= 7]

    def oos(train, test):
        if not train or not test:
            return None
        tb = {}
        for s in set(r["stn"] for r in train):
            tb[s] = circ_mean([x["e_dir"] for x in train if x["stn"] == s])
        th = {}
        for s in set(r["stn"] for r in train):
            th[s] = mean([x["e_hs"] for x in train if x["stn"] == s])
        dir_raw = mean([abs(x["e_dir"]) for x in test])
        dir_bc = mean([abs(wrap(x["e_dir"] - tb.get(x["stn"], 0.0))) for x in test])
        hs_raw = mean([abs(x["e_hs"]) for x in test])
        hs_bc = mean([abs(x["e_hs"] - th.get(x["stn"], 0.0)) for x in test])
        return {"dir_mae_raw": round(dir_raw, 2), "dir_mae_bias_corrected": round(dir_bc, 2),
                "hs_mae_raw": round(hs_raw, 3), "hs_mae_bias_corrected": round(hs_bc, 3)}

    pers = [r["persist_e"] for r in rows if r.get("persist_e") is not None]
    seasons = {}
    for sname in ("DJF", "MAM", "JJA", "SON"):
        sub = [r for r in rows if season(r["t"].month) == sname]
        if sub:
            sb = {}
            for s in set(r["stn"] for r in sub):
                sb[s] = circ_mean([x["e_dir"] for x in sub if x["stn"] == s])
            md = mean([(sb[r["stn"]] or 0.0) ** 2 for r in sub]) / mean([e * e for e in [x["e_dir"] for x in sub]])
            seasons[sname] = {"n": len(sub), "dir_mae": round(mean([abs(x["e_dir"]) for x in sub]), 2),
                              "dir_station_bias_share": round(md, 3)}
    return {
        "n": len(rows),
        "dir_mae_deg": round(mean([abs(e) for e in dirs]), 2),
        "dir_station_bias_share_of_mse": round(share_d, 3) if share_d is not None else None,
        "dir_persistence24_mae_deg": round(mean([abs(e) for e in pers]), 2) if pers else None,
        "dir_model_mae_same_rows_deg": round(mean([abs(r["e_dir"]) for r in rows if r.get("persist_e") is not None]), 2) if pers else None,
        "hs_mae_m": round(mean([abs(e) for e in hs]), 3),
        "hs_bias_m": round(mean(hs), 3),
        "hs_station_bias_share_of_mse": round(share_h, 3) if share_h is not None else None,
        "oos_H1_to_H2": oos(h1, h2),
        "oos_H2_to_H1": oos(h2, h1),
        "seasons": seasons,
    }


def main():
    rows, meta = [], {}
    for stn, (name, lat, lon, region) in STATIONS.items():
        try:
            obs = stdmet_hourly(stn, 2025)
            mod = om_range(lat, lon, "2025-01-01", "2025-12-31")
        except Exception as e:
            meta[stn] = {"name": name, "region": region, "error": str(e)[:200]}
            continue
        land = sum(1 for t in mod if is_land_mark(mod[t]))
        land_frac = land / max(1, len(mod))
        n_pairs = 0
        cand = []
        for t, o in obs.items():
            m = mod.get(t)
            if not m:
                continue
            if is_land_mark(m):
                continue
            # Lead 24-47 h where the archive has it (recent window only); otherwise the best-estimate ANALYSIS value.
            mdir, mhs = m.get("wave_direction_previous_day1"), m.get("wave_height_previous_day1")
            source = "lead24_previous_day1"
            if mdir is None or mhs is None:
                mdir, mhs = m.get("wave_direction"), m.get("wave_height")
                source = "analysis_best_estimate"
            if mdir is None or mhs is None:
                continue
            odir, ohs = o[0], o[1]
            if ohs < 0.5 or mhs < 0.3:
                continue
            prev = obs.get(t - dt.timedelta(hours=24))
            pe = wrap(prev[0] - odir) if (prev and prev[1] >= 0.5) else None
            cand.append({"stn": stn, "region": region, "t": t, "e_dir": wrap(mdir - odir), "e_hs": mhs - ohs,
                         "persist_e": pe, "source": source})
            n_pairs += 1
        meta[stn] = {"name": name, "region": region, "obs_hours": len(obs), "model_hours": len(mod),
                     "land_mark_fraction": round(land_frac, 3),
                     "status": "LAND-MARKED (excluded, to relocation lane)" if land_frac >= 0.25 else "water",
                     "pairs_used": n_pairs}
        if land_frac < 0.25:
            rows += cand
        time.sleep(1.0)
    summary = {
        "method": "GFS-Wave ncep_gfswave025 previous_day1 (lead 24-47 h) vs NDBC stdmet 2025 WVHT/MWD, offshore buoys, WVHT>=0.5 m, model Hs>=0.3 m, land marks excluded",
        "stations": meta,
        "source_counts": {s: sum(1 for r in rows if r.get("source") == s) for s in
                          sorted(set(r.get("source") for r in rows))},
        "pooled": stats(rows),
        "by_region": {g: stats([r for r in rows if r["region"] == g]) for g in sorted(set(r["region"] for r in rows))},
    }
    out = os.path.join(HERE, "d2_summary.json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=1, default=str)
    print("wrote", out, "pairs:", len(rows))


if __name__ == "__main__":
    main()
