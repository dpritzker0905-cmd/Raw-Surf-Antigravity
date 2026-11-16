"""Pass 5c: height calibration shape, holdout 2024 -> 2025 (offshore buoys, Open-Meteo analysis best estimate).

Cache (built once, d6_rows.json): every hour where NDBC stdmet WVHT and the model cell wave_height both exist and the
cell is not land-marked (the d2 rule, read from best-estimate fields). No energy filter in the cache, so every
selection below is reproducible offline. Per station-year counts are stored for forensics.

Selections:
  OUTCOME   buoy >= 0.5 m and model >= 0.3 m (selects on the observed height; reproduces pass 4 / 5a).
  FORECAST  model >= 0.5 m, buoy unfiltered (valid frame for a forecast-side correction; binning by observed height
            manufactures a size-dependent bias, pass 3).
Errors: e = model - buoy. A correction o turns e into e - o. Gain = |e| - |e - o| (positive = better).
Methods, fit on 2024, applied to 2025:
  M0 raw; M1 per-station constant; M2 pooled constant; M3 per-station x forecast-bin constant (pooled bin constant
  where the station-bin has < 50 fit rows); M4 pooled linear o = a + b*model; M5 per-station linear (>= 200 fit rows,
  else M4). Day-block bootstrap (1000 reps, UTC date) for gains and paired differences. Writes d6_summary.json.
"""
import json, math, os, random, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from d1_direction import STATIONS, mean

CACHE = os.path.join(HERE, "d6_rows.json")
SUMMARY = os.path.join(HERE, "d6_summary.json")
REPS = 1000
SKIP = {"46042", "46005"}  # no stdmet archive (HTTP 404), same exclusion as passes 3 to 5a


def bin_of(h):
    if h < 0.5:
        return "0.3-0.5"
    if h < 1.0:
        return "0.5-1"
    if h < 2.0:
        return "1-2"
    if h < 3.0:
        return "2-3"
    return ">3"


def build_cache():
    from d2_multiyear import stdmet_hourly, om_range, is_land_mark
    rows, counts, errors = [], {}, {}
    for stn, (name, lat, lon, region) in STATIONS.items():
        if stn in SKIP:
            errors[stn] = "excluded: no stdmet archive (HTTP 404)"
            continue
        for yr in (2024, 2025):
            key = f"{stn}|{yr}"
            try:
                obs = stdmet_hourly(stn, yr)
                mod = om_range(lat, lon, f"{yr}-01-01", f"{yr}-12-31")
            except Exception as e:
                errors[key] = str(e)[:160]
                continue
            land = sum(1 for t in mod if is_land_mark(mod[t]))
            kept = 0
            for t, o in obs.items():
                m = mod.get(t)
                if not m or is_land_mark(m):
                    continue
                mhs = m.get("wave_height")
                if mhs is None:
                    continue
                rows.append([stn, region, yr, t.isoformat(), o[1], mhs])
                kept += 1
            counts[key] = {"obs_hours": len(obs), "model_hours": len(mod),
                           "land_mark_share": round(land / max(1, len(mod)), 3), "rows_kept": kept}
    cache = {"rows": rows, "counts": counts, "errors": errors}
    with open(CACHE, "w") as f:
        json.dump(cache, f)
    return cache


def ols(xs, ys):
    mx, my = mean(xs), mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx if sxx else 0.0
    return my - b * mx, b


def pearson(xs, ys):
    mx, my = mean(xs), mean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def boot_ci(days, vals, seed=21):
    """Day-block bootstrap of the mean of vals (blocks = UTC date across stations)."""
    per = {}
    for d, v in zip(days, vals):
        s = per.setdefault(d, [0.0, 0])
        s[0] += v
        s[1] += 1
    keys = list(per)
    S = [per[k][0] for k in keys]
    N = [per[k][1] for k in keys]
    rng, k, out = random.Random(seed), len(keys), []
    for _ in range(REPS):
        idx = [rng.randrange(k) for _ in range(k)]
        n = sum(N[i] for i in idx)
        out.append(sum(S[i] for i in idx) / n if n else 0.0)
    out.sort()
    return [round(out[int(0.025 * REPS)], 4), round(out[int(0.975 * REPS)], 4)]


def score(test, off, days):
    gains, eraw, ecor = [], [], []
    by_raw, by_cor = defaultdict(list), defaultdict(list)
    for r, o in zip(test, off):
        e = r["mhs"] - r["ohs"]
        ec = e - o
        eraw.append(abs(e))
        ecor.append(abs(ec))
        gains.append(abs(e) - abs(ec))
        b = bin_of(r["mhs"])
        by_raw[b].append(e)
        by_cor[b].append(ec)
    res = {
        "n": len(test),
        "mae_raw_m": round(mean(eraw), 4),
        "mae_corrected_m": round(mean(ecor), 4),
        "gain_m": round(mean(gains), 4),
        "gain_ci95_day_block_m": boot_ci(days, gains),
        "bias_raw_m_by_forecast_bin": {b: round(mean(v), 3) for b, v in sorted(by_raw.items())},
        "bias_after_m_by_forecast_bin": {b: round(mean(v), 3) for b, v in sorted(by_cor.items())},
    }
    return res, gains


def analyse_outcome(rows):
    fit = [r for r in rows if r["yr"] == 2024 and r["ohs"] >= 0.5 and r["mhs"] >= 0.3]
    test_all = [r for r in rows if r["yr"] == 2025 and r["ohs"] >= 0.5 and r["mhs"] >= 0.3]
    per = defaultdict(list)
    for r in fit:
        per[r["stn"]].append(r["mhs"] - r["ohs"])
    c = {s: mean(v) for s, v in per.items()}
    test = [r for r in test_all if r["stn"] in c]
    days = [r["t"][:10] for r in test]
    res, _ = score(test, [c[r["stn"]] for r in test], days)
    per25 = defaultdict(list)
    for r in test:
        per25[r["stn"]].append(r["mhs"] - r["ohs"])
    stations = sorted(c)
    r_stab = pearson([c[s] for s in stations], [mean(per25[s]) for s in stations])
    return {
        "definition": "buoy >= 0.5 m and model >= 0.3 m (selects on observed height); fit 2024, test 2025",
        "n_fit_2024": len(fit),
        "n_test_2025_all_stations": len(test_all),
        "n_test_2025_offset_stations": len(test),
        "stations_with_offset": stations,
        "offset_m_2024": {s: round(c[s], 3) for s in stations},
        "M1_per_station_constant": res,
        "station_bias_stability_r_2024_vs_2025": round(r_stab, 3) if r_stab is not None else None,
    }


def analyse_forecast(rows):
    fit_all = [r for r in rows if r["yr"] == 2024 and r["mhs"] >= 0.5]
    n_by_station = defaultdict(int)
    for r in fit_all:
        n_by_station[r["stn"]] += 1
    stations = sorted(s for s, n in n_by_station.items() if n >= 200)
    fit = [r for r in fit_all if r["stn"] in stations]
    test = [r for r in rows if r["yr"] == 2025 and r["mhs"] >= 0.5 and r["stn"] in stations]
    days = [r["t"][:10] for r in test]
    e_st, e_sb, e_b, pts = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
    xs, es = [], []
    for r in fit:
        e = r["mhs"] - r["ohs"]
        b = bin_of(r["mhs"])
        e_st[r["stn"]].append(e)
        e_sb[(r["stn"], b)].append(e)
        e_b[b].append(e)
        pts[r["stn"]].append((r["mhs"], e))
        xs.append(r["mhs"])
        es.append(e)
    c_s = {s: mean(v) for s, v in e_st.items()}
    c_sb = {k: (mean(v), len(v)) for k, v in e_sb.items()}
    c_b = {b: mean(v) for b, v in e_b.items()}
    c_pool = mean(es)
    a_pool, b_pool = ols(xs, es)
    lin_s = {s: ols([x for x, _ in lst], [e for _, e in lst]) for s, lst in pts.items() if len(lst) >= 200}

    def m3(r):
        v = c_sb.get((r["stn"], bin_of(r["mhs"])))
        return v[0] if (v and v[1] >= 50) else c_b[bin_of(r["mhs"])]

    def m5(r):
        a, b = lin_s.get(r["stn"], (a_pool, b_pool))
        return a + b * r["mhs"]

    fallback = sum(1 for r in test if not (c_sb.get((r["stn"], bin_of(r["mhs"])), (0, 0))[1] >= 50))
    offsets = {
        "M0_raw": [0.0] * len(test),
        "M1_station_const": [c_s[r["stn"]] for r in test],
        "M2_pooled_const": [c_pool] * len(test),
        "M3_station_x_forecast_bin": [m3(r) for r in test],
        "M4_pooled_linear": [a_pool + b_pool * r["mhs"] for r in test],
        "M5_station_linear": [m5(r) for r in test],
    }
    methods, gains = {}, {}
    for name, off in offsets.items():
        methods[name], gains[name] = score(test, off, days)

    def paired(a, b):
        d = [x - y for x, y in zip(gains[a], gains[b])]
        return {"mean_m": round(mean(d), 4), "ci95_day_block_m": boot_ci(days, d)}

    return {
        "definition": "model >= 0.5 m, buoy unfiltered (forecast-side selection); stations with >= 200 fit rows; fit 2024, test 2025",
        "stations": stations,
        "n_fit_2024": len(fit),
        "n_test_2025": len(test),
        "M3_fallback_rows_in_test": fallback,
        "pooled_const_m": round(c_pool, 4),
        "pooled_linear_a_m_b": [round(a_pool, 4), round(b_pool, 4)],
        "offset_m_2024_by_station": {s: round(c_s[s], 3) for s in stations},
        "methods": methods,
        "paired_gain_differences_m": {
            "M1_minus_M2_station_vs_pooled": paired("M1_station_const", "M2_pooled_const"),
            "M3_minus_M1_forecast_bin_conditioning": paired("M3_station_x_forecast_bin", "M1_station_const"),
            "M5_minus_M1_linear_slope": paired("M5_station_linear", "M1_station_const"),
            "M4_minus_M2_linear_slope_pooled": paired("M4_pooled_linear", "M2_pooled_const"),
        },
    }


def main():
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else build_cache()
    rows = [{"stn": a, "region": b, "yr": c, "t": d, "ohs": e, "mhs": f} for a, b, c, d, e, f in cache["rows"]]
    summary = {
        "cache_counts": cache["counts"],
        "cache_errors": cache["errors"],
        "outcome_side_d4_reproduction": analyse_outcome(rows),
        "forecast_side": analyse_forecast(rows),
    }
    with open(SUMMARY, "w") as f:
        json.dump(summary, f, indent=1)
    print("wrote", SUMMARY, "rows", len(rows))


if __name__ == "__main__":
    main()
