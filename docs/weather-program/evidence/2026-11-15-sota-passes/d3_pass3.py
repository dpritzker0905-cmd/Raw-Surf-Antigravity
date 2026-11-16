"""Pass 3: height and direction bias structure, separated by source, with leave-one-quarter-out tests and CIs.

Reuses the 2025 stdmet truth and the Open-Meteo GFS-Wave fields from d2_multiyear.py. Pairs are split by source
(lead24_previous_day1 vs analysis_best_estimate) and never pooled for a skill claim.

Tests:
  1. Bias structure: height error by observed-Hs bin, pooled and by source; direction error by source.
  2. Leave-one-quarter-out (LOQO): station bias estimated on three quarters of 2025, applied to the fourth. Gain =
     MAE_raw - MAE_corrected on the held-out quarter. 95% CI from a day-block bootstrap of the per-day gains.
  3. Persistence definitions: buoy total MWD 24 h earlier versus model total direction, same rows (direction MAE).
Writes d3_summary.json.
"""
import json, math, os, random, sys, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from d1_direction import STATIONS, wrap, circ_mean, mean
from d2_multiyear import stdmet_hourly, om_range, is_land_mark

SKIP = {"46042", "46005"}  # no 2025 stdmet archive (HTTP 404), excluded, not land-marked


def build_rows():
    rows, status = [], {}
    for stn, (name, lat, lon, region) in STATIONS.items():
        if stn in SKIP:
            status[stn] = "no 2025 stdmet archive (404), excluded"
            continue
        try:
            obs = stdmet_hourly(stn, 2025)
            mod = om_range(lat, lon, "2025-01-01", "2025-12-31")
        except Exception as e:
            status[stn] = "error: " + str(e)[:120]
            continue
        n = 0
        for t, o in obs.items():
            m = mod.get(t)
            if not m or is_land_mark(m):
                continue
            mdir, mhs = m.get("wave_direction_previous_day1"), m.get("wave_height_previous_day1")
            source = "lead24"
            if mdir is None or mhs is None:
                mdir, mhs = m.get("wave_direction"), m.get("wave_height")
                source = "analysis"
            if mdir is None or mhs is None:
                continue
            odir, ohs = o[0], o[1]
            if ohs < 0.5 or mhs < 0.3:
                continue
            prev = obs.get(t - dt.timedelta(hours=24))
            pe = wrap(prev[0] - odir) if (prev and prev[1] >= 0.5) else None
            rows.append({"stn": stn, "region": region, "t": t, "day": t.date().isoformat(), "q": (t.month - 1) // 3,
                         "src": source, "ohs": ohs, "mhs": mhs, "e_hs": mhs - ohs, "e_dir": wrap(mdir - odir),
                         "persist_e": pe})
            n += 1
        status[stn] = f"ok pairs={n}"
    return rows, status


def hs_bin(h):
    if h < 1.0:
        return "0.5-1"
    if h < 2.0:
        return "1-2"
    if h < 3.0:
        return "2-3"
    return ">3"


def bias_by_bin(rows, key="ohs"):
    """key='ohs' bins by OBSERVED height (selection on the outcome, regression-to-mean prone);
    key='mhs' bins by FORECAST height (the valid conditioning for a forecast-side calibration)."""
    out = {}
    for b in ["0.5-1", "1-2", "2-3", ">3"]:
        v = [r["e_hs"] for r in rows if hs_bin(r[key]) == b]
        out[b] = {"n": len(v), "bias_m": round(mean(v), 3) if v else None}
    return out


def loqo(rows, reps=1000, seed=7):
    """Leave-one-quarter-out, per source and pooled. Bias estimated on other quarters, applied to held-out quarter."""
    gains_h, gains_d = [], []
    per_day_h, per_day_d = {}, {}
    res = {}
    for q in range(4):
        train = [r for r in rows if r["q"] != q]
        test = [r for r in rows if r["q"] == q]
        if not train or not test:
            continue
        hb, db = {}, {}
        for s in set(r["stn"] for r in train):
            hb[s] = mean([r["e_hs"] for r in train if r["stn"] == s])
            db[s] = circ_mean([r["e_dir"] for r in train if r["stn"] == s])
        for r in test:
            gh = abs(r["e_hs"]) - abs(r["e_hs"] - hb.get(r["stn"], 0.0))
            gd = abs(r["e_dir"]) - abs(wrap(r["e_dir"] - db.get(r["stn"], 0.0)))
            per_day_h.setdefault(r["day"], []).append(gh)
            per_day_d.setdefault(r["day"], []).append(gd)
            gains_h.append(gh)
            gains_d.append(gd)
        res[f"Q{q+1}"] = {"n": len(test),
                          "hs_mae_raw": round(mean([abs(r["e_hs"]) for r in test]), 3),
                          "hs_mae_corrected": round(mean([abs(r["e_hs"] - hb.get(r["stn"], 0.0)) for r in test]), 3),
                          "dir_mae_raw": round(mean([abs(r["e_dir"]) for r in test]), 2),
                          "dir_mae_corrected": round(mean([abs(wrap(r["e_dir"] - db.get(r["stn"], 0.0))) for r in test]), 2)}
    rng = random.Random(seed)
    days = list(per_day_h.keys())

    def ci(per_day):
        if not days:
            return None
        stats = []
        for _ in range(reps):
            samp = [rng.choice(days) for _ in days]
            vals = []
            for d in samp:
                vals += per_day[d]
            stats.append(mean(vals))
        stats.sort()
        return [round(stats[int(0.025 * reps)], 4), round(stats[int(0.975 * reps)], 4)]

    return {
        "quarters": res,
        "hs_gain_mean_m": round(mean(gains_h), 4) if gains_h else None,
        "hs_gain_95ci_day_block_m": ci(per_day_h),
        "dir_gain_mean_deg": round(mean(gains_d), 3) if gains_d else None,
        "dir_gain_95ci_day_block_deg": ci(per_day_d),
    }


def persistence_check(rows):
    pr = [r for r in rows if r["persist_e"] is not None]
    return {"n": len(pr),
            "model_dir_mae_deg": round(mean([abs(r["e_dir"]) for r in pr]), 2) if pr else None,
            "buoy_persistence24_dir_mae_deg": round(mean([abs(r["persist_e"]) for r in pr]), 2) if pr else None}


def main():
    rows, status = build_rows()
    by_src = {}
    for s in sorted(set(r["src"] for r in rows)):
        sub = [r for r in rows if r["src"] == s]
        by_src[s] = {
            "n": len(sub),
            "hs_mae_m": round(mean([abs(r["e_hs"]) for r in sub]), 3),
            "hs_bias_m": round(mean([r["e_hs"] for r in sub]), 3),
            "dir_mae_deg": round(mean([abs(r["e_dir"]) for r in sub]), 2),
            "hs_bias_by_hs_bin": bias_by_bin(sub),
            "persistence_check": persistence_check(sub),
        }
    summary = {
        "station_status": status,
        "by_source": by_src,
        "loqo_pooled": loqo(rows),
        "loqo_analysis_only": loqo([r for r in rows if r["src"] == "analysis"]),
        "pooled_hs_bias_by_OBSERVED_bin": bias_by_bin(rows, "ohs"),
        "pooled_hs_bias_by_FORECAST_bin": bias_by_bin(rows, "mhs"),
        "ca_hs_bias_by_OBSERVED_bin": bias_by_bin([r for r in rows if r["region"] == "CA"], "ohs"),
        "ca_hs_bias_by_FORECAST_bin": bias_by_bin([r for r in rows if r["region"] == "CA"], "mhs"),
        "loqo_lead24_only": loqo([r for r in rows if r["src"] == "lead24"]),
    }
    out = os.path.join(HERE, "d3_summary.json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=1, default=str)
    print("wrote", out, "rows", len(rows))


if __name__ == "__main__":
    main()
