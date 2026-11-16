"""Round-2 measured error budget for WAVE DIRECTION and HEIGHT, offshore buoys, GFS-Wave lead 24-47 h.

Truth: NDBC realtime2 (MWD, WVHT, DPD), hourly (nearest record to each UTC hour within 20 min).
Model: Open-Meteo marine API, ncep_gfswave025, hourly `wave_direction_previous_day1` / `wave_height_previous_day1`
(the forecast made one day earlier for the same valid time = lead 24-47 h). Best estimate kept for reference.
Persistence baseline: observed direction 24 h earlier.

Decomposition per variable: per-station bias (circular mean of error), within-station scatter, and a time-split
cross-check (bias estimated on the first half of the window, applied to the second half).
Reproducible: stdlib only. Writes d1_summary.json next to this script.
"""
import json, math, os, sys, time, urllib.request, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))

# Offshore NDBC buoys (>= ~25 km from coast) with coordinates from the NDBC station list (verified this session).
STATIONS = {
    "46025": ("Santa Monica Basin", 33.765, -119.077, "CA"),
    "46086": ("San Clemente Basin", 32.504, -118.029, "CA"),
    "46042": ("Monterey", 36.787, -122.408, "CA"),
    "46026": ("San Francisco", 37.750, -122.838, "CA"),
    "46014": ("Point Arena", 39.225, -123.980, "CA"),
    "46011": ("Santa Maria", 34.937, -120.999, "CA"),
    "46053": ("East Santa Barbara", 34.246, -119.842, "CA"),
    "46029": ("Columbia River Bar", 46.148, -124.508, "PNW"),
    "46005": ("West Washington", 46.147, -131.077, "PNW"),
    "46041": ("Cape Elizabeth", 47.351, -124.741, "PNW"),
    "46002": ("West Oregon", 42.560, -130.523, "PNW"),
    "51002": ("SW Hawaii", 17.070, -157.755, "HI"),
    "51003": ("W Hawaii", 19.151, -160.617, "HI"),
    "51004": ("SE Hawaii", 17.504, -152.197, "HI"),
    "44011": ("Georges Bank", 41.088, -66.546, "NE"),
    "44008": ("Nantucket", 40.500, -69.254, "NE"),
    "44014": ("Virginia Beach", 36.603, -74.837, "SE"),
    "41043": ("NE Puerto Rico", 21.083, -64.853, "PR"),
}

UA = {"User-Agent": "raw-surf-research/round2 (measured error budget; public data)"}


def http_get(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # rate limit or network: back off and retry
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def ndbc_hourly(stn):
    """Return {utc_datetime_at_hour: (mwd_deg, wvht_m, dpd_s)} from realtime2 (MM = missing)."""
    txt = http_get(f"https://www.ndbc.noaa.gov/data/realtime2/{stn}.txt")
    out = {}
    for line in txt.splitlines():
        if not line or line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 12:
            continue
        try:
            t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        if p[11] == "MM" or p[8] == "MM" or p[9] == "MM":
            continue
        hour = t.replace(minute=0, second=0, microsecond=0)
        dmin = abs((t - hour).total_seconds()) / 60.0
        if dmin > 20 and (hour + dt.timedelta(hours=1) - t).total_seconds() / 60.0 > 20:
            continue
        # keep the record nearest to the hour
        target = hour if dmin <= 20 else hour + dt.timedelta(hours=1)
        if target not in out or abs((t - target).total_seconds()) < out[target][3]:
            out[target] = (float(p[11]), float(p[8]), float(p[9]), abs((t - target).total_seconds()))
    return {k: v[:3] for k, v in out.items()}


def open_meteo(lat, lon):
    url = ("https://marine-api.open-meteo.com/v1/marine?latitude=%s&longitude=%s"
           "&hourly=wave_direction,wave_height,wave_period,"
           "wave_direction_previous_day1,wave_height_previous_day1,wave_period_previous_day1"
           "&past_days=30&forecast_days=1&models=ncep_gfswave025&timezone=GMT") % (lat, lon)
    d = json.loads(http_get(url))
    h = d["hourly"]
    res = {}
    for i, ts in enumerate(h["time"]):
        t = dt.datetime.fromisoformat(ts).replace(tzinfo=dt.timezone.utc)
        res[t] = {k: h[k][i] for k in h if k != "time"}
    return res


def wrap(a):
    """Signed angular difference in degrees, (-180, 180]."""
    x = (a + 180.0) % 360.0 - 180.0
    return 180.0 if x == -180.0 else x


def circ_mean(angles):
    if not angles:
        return None
    s = sum(math.sin(math.radians(a)) for a in angles)
    c = sum(math.cos(math.radians(a)) for a in angles)
    return math.degrees(math.atan2(s, c)) if (s or c) else 0.0


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def summarise(rows):
    """rows: list of dict(stn, t, e_dir, e_hs, obs_dir, obs_hs, persist_e)."""
    out = {"n": len(rows)}
    if not rows:
        return out
    # --- direction: station bias decomposition ---
    by = {}
    for r in rows:
        by.setdefault(r["stn"], []).append(r)
    bias = {s: circ_mean([r["e_dir"] for r in v]) for s, v in by.items()}
    allE = [r["e_dir"] for r in rows]
    mae_all = mean([abs(e) for e in allE])
    within = []
    for s, v in by.items():
        b = bias[s]
        within += [wrap(r["e_dir"] - b) for r in v]
    mae_within = mean([abs(e) for e in within])
    # between-station share of MSE (degrees^2), using station-mean signed error
    mse_all = mean([e * e for e in allE])
    mse_bias_part = mean([(bias[r["stn"]] or 0.0) ** 2 for r in rows])
    out["dir"] = {
        "mae_all_deg": round(mae_all, 2),
        "mae_after_station_bias_removed_insample_deg": round(mae_within, 2),
        "station_bias_deg": {s: round(bias[s], 1) for s in sorted(bias)},
        "share_of_mse_from_station_bias": round(mse_bias_part / mse_all, 3) if mse_all else None,
    }
    # --- time-split check: bias from first half of the window, applied to second half ---
    ts_all = sorted(r["t"] for r in rows)
    mid = ts_all[len(ts_all) // 2]
    first = [r for r in rows if r["t"] < mid]
    second = [r for r in rows if r["t"] >= mid]
    bias1 = {}
    for s in by:
        v = [r["e_dir"] for r in first if r["stn"] == s]
        bias1[s] = circ_mean(v) if v else 0.0
    oos_raw = mean([abs(r["e_dir"]) for r in second]) if second else None
    oos_bias = mean([abs(wrap(r["e_dir"] - bias1.get(r["stn"], 0.0))) for r in second]) if second else None
    out["dir"]["time_split_oos_mae_raw_deg"] = round(oos_raw, 2) if oos_raw is not None else None
    out["dir"]["time_split_oos_mae_with_bias_from_first_half_deg"] = round(oos_bias, 2) if oos_bias is not None else None
    # --- persistence baseline (observed direction 24 h earlier) ---
    pe = [r["persist_e"] for r in rows if r.get("persist_e") is not None]
    out["dir"]["mae_persistence24_deg"] = round(mean([abs(e) for e in pe]), 2) if pe else None
    out["dir"]["mae_model_on_same_rows_deg"] = round(mean([abs(r["e_dir"]) for r in rows if r.get("persist_e") is not None]), 2) if pe else None
    # --- height ---
    hs_e = [r["e_hs"] for r in rows]
    hby = {}
    for r in rows:
        hby.setdefault(r["stn"], []).append(r["e_hs"])
    hbias = {s: mean(v) for s, v in hby.items()}
    hmse = mean([e * e for e in hs_e])
    hbias_part = mean([(hbias[r["stn"]] or 0.0) ** 2 for r in rows])
    out["hs"] = {
        "mae_m": round(mean([abs(e) for e in hs_e]), 3),
        "bias_m": round(mean(hs_e), 3),
        "share_of_mse_from_station_bias": round(hbias_part / hmse, 3) if hmse else None,
    }
    return out


def main():
    wanted = sys.argv[1:] or list(STATIONS)
    rows, meta = [], {}
    for stn in wanted:
        name, lat, lon, region = STATIONS[stn]
        try:
            obs = ndbc_hourly(stn)
            mod = open_meteo(lat, lon)
        except Exception as e:
            meta[stn] = {"error": str(e)[:200]}
            continue
        n_pairs = 0
        for t, o in obs.items():
            m = mod.get(t)
            if not m:
                continue
            mdir, mhs = m.get("wave_direction_previous_day1"), m.get("wave_height_previous_day1")
            if mdir is None or mhs is None:
                continue
            odir, ohs = o[0], o[1]
            if ohs < 0.5 or mhs < 0.3:  # direction is noise in calm seas; keep energetic hours
                continue
            # persistence: observed direction 24 h earlier (same station, same filter)
            prev = obs.get(t - dt.timedelta(hours=24))
            pe = wrap(prev[0] - odir) if (prev and prev[1] >= 0.5) else None
            rows.append({"stn": stn, "region": region, "t": t, "e_dir": wrap(mdir - odir),
                         "e_hs": mhs - ohs, "obs_dir": odir, "obs_hs": ohs, "persist_e": pe})
            n_pairs += 1
        meta[stn] = {"name": name, "region": region, "pairs": n_pairs, "obs_hours": len(obs), "model_hours": len(mod)}
        time.sleep(1.0)
    summary = {
        "method": "GFS-Wave ncep_gfswave025 previous_day1 (lead 24-47h) vs NDBC realtime2 MWD/WVHT, offshore buoys, WVHT>=0.5 m",
        "window_utc": [min(r["t"] for r in rows).isoformat(), max(r["t"] for r in rows).isoformat()] if rows else None,
        "stations": meta,
        "all": summarise(rows),
        "by_region": {},
    }
    regions = sorted(set(r["region"] for r in rows))
    for g in regions:
        summary["by_region"][g] = summarise([r for r in rows if r["region"] == g])
    out_path = os.path.join(HERE, "d1_summary.json")
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=1, default=str)
    print("wrote", out_path, "pairs:", len(rows))
    print(json.dumps(summary["all"], indent=1, default=str)[:2500])


if __name__ == "__main__":
    main()
