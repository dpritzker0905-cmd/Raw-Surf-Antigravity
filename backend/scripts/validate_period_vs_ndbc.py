"""Is our peak period right? Measured against NDBC buoys, which share no code with us.

WHY THIS EXISTS
---------------
Answering the owner's Florida report on 2026-07-29 turned up a side finding worth more than the
answer: at three FL buoys our Tp ran **+2.7 s high** (41009 Canaveral: buoy DPD 5.0 s, ours 7.7 s)
while our wave HEIGHTS matched well (0.68 vs 0.70 m). Three buoys is an anecdote. This makes it a
measurement.

★ WHY PERIOD AND NOT HEIGHT. The measured Jacobian says offshore Hs+10% moves the score 0.0 points
(the size gate saturates), while Tp+10% moves it 2.7. A +2.7 s error on a 5 s sea is +54% — call it
~14 points of score, which crosses at least one level boundary. Period is where our error budget
actually lives, and nothing in the repo had ever checked it against an instrument.

★★ WHY NDBC IS A REAL CHECK. `sim-parity-validates-wiring-not-physics` — a check whose two sides
share a dependency cannot go red on the thing they share. Our forecast and our sim both come from
the same model; a buoy is a physical object in the water. It can disagree with us, which is the
entire point.

⚠️ WHAT THIS DOES *NOT* MEASURE. NDBC `DPD` is the dominant period of the TOTAL sea at the buoy's
open-water location. Our `swell_period_sec` at the same coordinate is the model's peak period. Both
are "peak period of the total field", so they are comparable — but a bimodal sea (a small long
groundswell under a big short windsea) can make either jump between peaks. That is a real source of
scatter and is why this reports the DISTRIBUTION and a per-buoy breakdown, not a single number.
`APD` (average period) is reported alongside because when DPD and APD diverge sharply the sea is
bimodal and that row deserves less weight.

Usage:
    python backend/scripts/validate_period_vs_ndbc.py [--hours N] [--json out.json]
"""
import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import sim_forecast   # noqa: E402

# Open-water NDBC stations with a wide geographic and climatic spread — short-period wind seas
# (Gulf, FL, Great Lakes-adjacent Atlantic) through long-period Pacific groundswell (Hawaii, West
# Coast), so a bias that is really a REGIME effect separates from a global one.
BUOYS = {
    # station: (lat, lng, label, regime)
    "41117": (29.999, -81.079, "St Augustine FL", "short-period Atlantic"),
    "41009": (28.508, -80.185, "Canaveral FL", "short-period Atlantic"),
    "41113": (27.551, -80.225, "Fort Pierce FL", "short-period Atlantic"),
    "41010": (28.878, -78.485, "Canaveral East", "open Atlantic"),
    "41047": (27.514, -71.494, "NE Bahamas", "open Atlantic"),
    "41048": (31.831, -69.573, "W Bermuda", "open Atlantic"),
    "44025": (40.251, -73.164, "Long Island NY", "mid Atlantic"),
    "44008": (40.504, -69.248, "Nantucket", "mid Atlantic"),
    "42039": (28.788, -86.008, "Pensacola Gulf", "short-period Gulf"),
    "42036": (28.501, -84.508, "W Tampa Gulf", "short-period Gulf"),
    "51201": (21.669, -158.116, "Waimea HI", "long-period Pacific"),
    "51202": (21.417, -157.679, "Mokapu Point HI", "long-period Pacific"),
    "51000": (23.528, -153.787, "N Hawaii", "long-period Pacific"),
    "46042": (36.785, -122.398, "Monterey CA", "long-period Pacific"),
    "46026": (37.759, -122.833, "San Francisco CA", "long-period Pacific"),
    "46047": (32.403, -119.536, "Tanner Bank CA", "long-period Pacific"),
    "46050": (44.669, -124.546, "Stonewall Bank OR", "long-period Pacific"),
    "46029": (46.159, -124.514, "Columbia River OR", "long-period Pacific"),
}


def ndbc_latest(station):
    """Newest usable row of NDBC realtime2. Columns:
    YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE"""
    url = f"https://www.ndbc.noaa.gov/data/realtime2/{station}.txt"
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-validation/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            text = r.read().decode("utf-8", "ignore")
    except Exception as e:
        return None, f"unreachable ({e.__class__.__name__})"
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        c = line.split()
        if len(c) < 12:
            continue
        try:
            wvht = None if c[8] == "MM" else float(c[8])
            dpd = None if c[9] == "MM" else float(c[9])
            apd = None if c[10] == "MM" else float(c[10])
        except ValueError:
            continue
        if wvht is None or dpd is None or dpd <= 0:
            continue
        return {"wvht": wvht, "dpd": dpd, "apd": apd,
                "time": f"{c[0]}-{c[1]}-{c[2]}T{c[3]}:{c[4]}Z"}, None
    return None, "no usable rows"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write the full result set here")
    args = ap.parse_args()

    print("=" * 112)
    print("PEAK PERIOD: OUR MODEL vs NDBC BUOYS  (buoy DPD = dominant period, APD = average)")
    print("=" * 112)
    print(f"{'stn':<8}{'where':<20}{'regime':<24}{'Hs_b':>6}{'Hs_us':>7}{'DPD':>6}{'APD':>6}"
          f"{'Tp_us':>7}{'dTp':>7}{'dHs':>7}")
    print("-" * 112)

    rows = []
    for stn, (lat, lng, label, regime) in BUOYS.items():
        obs, err = ndbc_latest(stn)
        if not obs:
            print(f"{stn:<8}{label:<20}{regime:<24}{err}")
            continue
        try:
            b, _prov = sim_forecast.fetch_live_forecast(lat, lng)
        except Exception as e:
            print(f"{stn:<8}{label:<20}{regime:<24}model error: {e}")
            continue
        if not b:
            print(f"{stn:<8}{label:<20}{regime:<24}model returned nothing")
            continue
        d_tp = b["swell_period_sec"] - obs["dpd"]
        d_hs = b["swell_height_m"] - obs["wvht"]
        bimodal = obs["apd"] is not None and (obs["dpd"] - obs["apd"]) > 3.0
        rows.append({"station": stn, "label": label, "regime": regime,
                     "buoy_hs": obs["wvht"], "buoy_dpd": obs["dpd"], "buoy_apd": obs["apd"],
                     "our_hs": b["swell_height_m"], "our_tp": b["swell_period_sec"],
                     "d_tp": round(d_tp, 2), "d_hs": round(d_hs, 3),
                     "bimodal": bimodal, "buoy_time": obs["time"]})
        print(f"{stn:<8}{label[:19]:<20}{regime:<24}{obs['wvht']:>6.2f}{b['swell_height_m']:>7.2f}"
              f"{obs['dpd']:>6.1f}{(obs['apd'] or float('nan')):>6.1f}"
              f"{b['swell_period_sec']:>7.1f}{d_tp:>+7.1f}{d_hs:>+7.2f}"
              + ("  bimodal" if bimodal else ""))

    if not rows:
        print("\nno buoys resolved — nothing to conclude")
        return 1

    def stats(vals):
        v = sorted(vals)
        n = len(v)
        return {"n": n, "median": v[n // 2], "min": v[0], "max": v[-1],
                "mean": round(sum(v) / n, 2)}

    print("-" * 112)
    all_tp = stats([r["d_tp"] for r in rows])
    all_hs = stats([r["d_hs"] for r in rows])
    print(f"Tp error (ours - buoy): median {all_tp['median']:+.1f} s   mean {all_tp['mean']:+.2f}   "
          f"range {all_tp['min']:+.1f} .. {all_tp['max']:+.1f}   n={all_tp['n']}")
    print(f"Hs error (ours - buoy): median {all_hs['median']:+.2f} m   mean {all_hs['mean']:+.2f}   "
          f"range {all_hs['min']:+.2f} .. {all_hs['max']:+.2f}")

    print("\nBY REGIME — a bias that is really a regime effect separates here:")
    regimes = {}
    for r in rows:
        regimes.setdefault(r["regime"], []).append(r)
    for reg, rs in sorted(regimes.items()):
        s = stats([r["d_tp"] for r in rs])
        print(f"  {reg:<26} n={s['n']:<3} median dTp {s['median']:+.1f} s   "
              f"range {s['min']:+.1f} .. {s['max']:+.1f}")

    clean = [r for r in rows if not r["bimodal"]]
    if clean and len(clean) != len(rows):
        s = stats([r["d_tp"] for r in clean])
        print(f"\nEXCLUDING bimodal seas (DPD-APD > 3 s): n={s['n']} median dTp {s['median']:+.1f} s")

    # What the bias is WORTH, in the only currency that matters.
    print("\n" + "=" * 112)
    print("WHAT IT COSTS THE SCORE (Jacobian: the rating is what the user sees, not Tp)")
    print("=" * 112)
    from services.weather_pipeline.surf_rating import compute_surf_rating
    med = all_tp["median"]
    for label, h, tp_true in [("FL 3 ft short-period", 0.91, 5.0),
                              ("FL 2 ft short-period", 0.61, 5.0),
                              ("CA 4 ft groundswell", 1.22, 13.0)]:
        s_true, l_true = compute_surf_rating(h, tp_true, 2.0, 270.0, 90.0, 90.0)
        s_ours, l_ours = compute_surf_rating(h, tp_true + med, 2.0, 270.0, 90.0, 90.0)
        print(f"  {label:<24} Tp {tp_true:.0f} -> {tp_true+med:.1f} s :  "
              f"{s_true:>5.1f} {l_true:<10} -> {s_ours:>5.1f} {l_ours:<10} "
              f"({s_ours - s_true:+.1f}{'  LEVEL CHANGE' if l_true != l_ours else ''})")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"generated_at": datetime.now(timezone.utc).isoformat(),
                       "rows": rows, "tp_error": all_tp, "hs_error": all_hs}, f, indent=2)
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
