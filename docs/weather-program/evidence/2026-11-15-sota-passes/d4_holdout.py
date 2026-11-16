"""Pass 5a: time-blocked holdout for the per-station height offset (LongCat pass-4 request).

Fit: per-station mean height error on 2024 analysis pairs (Open-Meteo best-estimate wave_height vs NDBC stdmet WVHT,
energetic hours only: buoy Hs >= 0.5 m, model Hs >= 0.3 m, land marks excluded).
Test: the same offset applied to 2025 analysis pairs (never seen in the fit).
Also: stability of station bias across years (Pearson r of 2024 vs 2025 station means), and a CI from a day-block
bootstrap of the per-day MAE gain. Reuses d2_multiyear helpers. Writes d4_summary.json.
"""
import json, math, os, random, sys, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from d1_direction import STATIONS, mean
from d2_multiyear import stdmet_hourly, om_range, is_land_mark

SKIP = {"46042", "46005"}  # no 2024/2025 stdmet archive at these IDs (HTTP 404)


def analysis_pairs(stn, lat, lon, region, year):
    obs = stdmet_hourly(stn, year)
    mod = om_range(lat, lon, f"{year}-01-01", f"{year}-12-31")
    rows = []
    for t, o in obs.items():
        m = mod.get(t)
        if not m or is_land_mark(m):
            continue
        mhs = m.get("wave_height")
        if mhs is None:
            continue
        ohs = o[1]
        if ohs < 0.5 or mhs < 0.3:
            continue
        rows.append({"stn": stn, "region": region, "day": t.date().isoformat(), "e": mhs - ohs, "ohs": ohs, "mhs": mhs})
    return rows


def pearson(x, y):
    n = len(x)
    if n < 3:
        return None
    mx, my = mean(x), mean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    if sx == 0 or sy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy)


def main():
    fit_rows, test_rows, status = [], [], {}
    for stn, (name, lat, lon, region) in STATIONS.items():
        if stn in SKIP:
            status[stn] = "no stdmet archive, excluded"
            continue
        try:
            r24 = analysis_pairs(stn, lat, lon, region, 2024)
            r25 = analysis_pairs(stn, lat, lon, region, 2025)
            status[stn] = f"2024 n={len(r24)} 2025 n={len(r25)}"
            fit_rows += r24
            test_rows += r25
        except Exception as e:
            status[stn] = "error: " + str(e)[:120]
    # per-station offset from 2024 (mean error), applied to 2025
    off = {}
    for s in set(r["stn"] for r in fit_rows):
        off[s] = mean([r["e"] for r in fit_rows if r["stn"] == s])
    raw = [abs(r["e"]) for r in test_rows if r["stn"] in off]
    cor = [abs(r["e"] - off[r["stn"]]) for r in test_rows if r["stn"] in off]
    mae_raw, mae_cor = mean(raw), mean(cor)
    # day-block bootstrap of the per-day MAE gain
    per_day = {}
    for r in test_rows:
        if r["stn"] not in off:
            continue
        per_day.setdefault(r["day"], []).append(abs(r["e"]) - abs(r["e"] - off[r["stn"]]))
    days = list(per_day.keys())
    rng = random.Random(11)
    boots = []
    for _ in range(1000):
        vals = []
        for d in [rng.choice(days) for _ in days]:
            vals += per_day[d]
        boots.append(mean(vals))
    boots.sort()
    # stability of station bias across years
    common = sorted(s for s in off if any(r["stn"] == s for r in test_rows))
    b25 = {s: mean([r["e"] for r in test_rows if r["stn"] == s]) for s in common}
    r_stab = pearson([off[s] for s in common], [b25[s] for s in common])
    # calibration by forecast-height bin on 2025 (is the offset constant across forecast heights?)
    bins = {}
    for r in test_rows:
        if r["stn"] not in off:
            continue
        b = "0.5-1" if r["mhs"] < 1 else "1-2" if r["mhs"] < 2 else "2-3" if r["mhs"] < 3 else ">3"
        bins.setdefault(b, []).append((r["e"], off[r["stn"]]))
    by_bin = {b: {"n": len(v), "raw_mean_error_m": round(mean([x for x, _ in v]), 3),
                  "after_offset_m": round(mean([x - o for x, o in v]), 3)} for b, v in bins.items()}
    summary = {
        "method": "analysis pairs (best-estimate Open-Meteo GFS-Wave vs NDBC stdmet), fit 2024, test 2025",
        "station_status": status,
        "n_fit_2024": len(fit_rows), "n_test_2025": len(test_rows),
        "stations_with_offset": len(off),
        "mae_2025_raw_m": round(mae_raw, 4), "mae_2025_with_2024_offset_m": round(mae_cor, 4),
        "gain_m": round(mae_raw - mae_cor, 4),
        "gain_95ci_day_block_m": [round(boots[25], 4), round(boots[974], 4)],
        "station_bias_stability_r_2024_vs_2025": round(r_stab, 3) if r_stab is not None else None,
        "offset_by_station_2024": {s: round(off[s], 3) for s in sorted(off)},
        "bias_2025_by_station": {s: round(b25[s], 3) for s in common},
        "test_2025_by_forecast_bin": by_bin,
    }
    out = os.path.join(HERE, "d4_summary.json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
