"""Pass 5e forensics.
(1) Land probe: what does Open-Meteo return over a known inland cell (null or zero)? Decides whether the d2 land rule
    (zero or null height AND period = land) can be trusted.
(2) Reverse holdout from the d6 cache: fit 2025 (full year), test 2024 (only the hours the archive has: Jun 19 - Dec 31),
    forecast-side selection (model >= 0.5 m), stations with >= 200 rows in both years. Tests whether the station offset
    holds when the direction of the split is reversed and the test season matches the 2024 fit.
Writes d8_checks.json.
"""
import json, os, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from d1_direction import http_get, mean
from d6_shape import bin_of, boot_ci, score, pearson

INLAND = ("Denver (inland, no sea)", 39.74, -104.99)


def land_probe():
    lat, lon = INLAND[1], INLAND[2]
    url = ("https://marine-api.open-meteo.com/v1/marine?latitude=%s&longitude=%s"
           "&hourly=wave_height,wave_period&start_date=2025-01-01&end_date=2025-01-31"
           "&models=ncep_gfswave025&timezone=GMT") % (lat, lon)
    h = json.loads(http_get(url))["hourly"]
    c = Counter()
    for hv, pv in zip(h["wave_height"], h["wave_period"]):
        c["h_null" if hv is None else ("h_zero" if hv == 0 else "h_pos")] += 1
        c["p_null" if pv is None else ("p_zero" if pv == 0 else "p_pos")] += 1
    return dict(c)


def ols(xs, ys):
    mx, my = mean(xs), mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx if sxx else 0.0
    return my - b * mx, b


def reverse(rows):
    fit_all = [r for r in rows if r["yr"] == 2025 and r["mhs"] >= 0.5]
    test_all = [r for r in rows if r["yr"] == 2024 and r["mhs"] >= 0.5]
    cf, ct = Counter(r["stn"] for r in fit_all), Counter(r["stn"] for r in test_all)
    stations = sorted(s for s in cf if cf[s] >= 200 and ct.get(s, 0) >= 200)
    fit = [r for r in fit_all if r["stn"] in stations]
    test = [r for r in test_all if r["stn"] in stations]
    days = [r["t"][:10] for r in test]
    e_st, e_sb, e_b = defaultdict(list), defaultdict(list), defaultdict(list)
    es = []
    for r in fit:
        e = r["mhs"] - r["ohs"]
        b = bin_of(r["mhs"])
        e_st[r["stn"]].append(e)
        e_sb[(r["stn"], b)].append(e)
        e_b[b].append(e)
        es.append(e)
    c_s = {s: mean(v) for s, v in e_st.items()}
    c_sb = {k: (mean(v), len(v)) for k, v in e_sb.items()}
    c_b = {b: mean(v) for b, v in e_b.items()}
    c_pool = mean(es)

    def m3(r):
        v = c_sb.get((r["stn"], bin_of(r["mhs"])))
        return v[0] if (v and v[1] >= 50) else c_b[bin_of(r["mhs"])]

    offsets = {
        "M0_raw": [0.0] * len(test),
        "M1_station_const": [c_s[r["stn"]] for r in test],
        "M2_pooled_const": [c_pool] * len(test),
        "M3_station_x_forecast_bin": [m3(r) for r in test],
    }
    methods, gains = {}, {}
    for name, off in offsets.items():
        methods[name], gains[name] = score(test, off, days)

    def paired(a, b):
        d = [x - y for x, y in zip(gains[a], gains[b])]
        return {"mean_m": round(mean(d), 4), "ci95_day_block_m": boot_ci(days, d)}

    per_test = defaultdict(list)
    for r in test:
        per_test[r["stn"]].append(r["mhs"] - r["ohs"])
    r_stab = pearson([c_s[s] for s in stations], [mean(per_test[s]) for s in stations])
    return {
        "definition": "fit 2025 full year, test 2024 hours the archive has (Jun 19 - Dec 31); model >= 0.5 m; stations with >= 200 rows in both years",
        "stations": stations,
        "n_fit_2025": len(fit),
        "n_test_2024": len(test),
        "station_bias_r_2025_vs_2024": round(r_stab, 3) if r_stab is not None else None,
        "methods": methods,
        "paired_gain_differences_m": {
            "M1_minus_M2_station_vs_pooled": paired("M1_station_const", "M2_pooled_const"),
            "M3_minus_M1_forecast_bin_conditioning": paired("M3_station_x_forecast_bin", "M1_station_const"),
        },
    }


def main():
    cache = json.load(open(os.path.join(HERE, "d6_rows.json")))
    rows = [{"stn": a, "region": b, "yr": c, "t": d, "ohs": e, "mhs": f} for a, b, c, d, e, f in cache["rows"]]
    out = {"land_probe_inland_jan2025": {"cell": INLAND[0], "lat": INLAND[1], "lon": INLAND[2], "counts": land_probe()},
           "reverse_holdout": reverse(rows)}
    path = os.path.join(HERE, "d8_checks.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", path)


if __name__ == "__main__":
    main()
