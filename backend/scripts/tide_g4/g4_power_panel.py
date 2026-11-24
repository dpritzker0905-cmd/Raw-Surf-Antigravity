"""G4 power check, PANEL RECORD (the advisor's ruling, 2026-11-20): which of the 26 gauges power run 44419701002 scored,
and why each excluded one was excluded. Recomputed AFTER that run, from public data, with the run's own functions:
- D: g4_power.d_reference (Open-Meteo previous_day1/2, test-only reference; get_json is g3t_gate's 5-try retry);
- observed water: g3t_gate.coops_obs_pred on G3t's SEEN window (already declared seen; not G4's window);
- exclusion: g3t_rules.excluded_gauges (coverage < 95% on P, D or observed).
P (A+M) is taken as complete: FES2022b is defined at every gauge and the run logged no "m ... unavailable" stage. No
credential is used; nothing is scored; no share is computed. Output: the 26-gauge table as JSON on stdout.

Run from the repo root:  python backend/scripts/tide_g4/g4_power_panel.py > panel.json
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import g4_power as P                     # noqa: E402  (also installs g3t_gate's retrying get_json)

R, T, S, R4 = P.R, P.T, P.S, P.R4


def main():
    hours = R.window_hours()
    pts = {}
    for sid in R4.GAUGES:
        la, lo, _ = S.station_meta(sid)
        if la is not None:
            pts[sid] = (la, lo)
    D = P.d_reference(pts, hours)
    obs = {}
    for sid in pts:
        o = {}
        for a, b in R.segments():
            oo, _pp = T.coops_obs_pred(sid, a, b)
            o.update(oo)
        obs[sid] = np.array([o.get(t, np.nan) for t in hours])
    AM = {sid: np.zeros((len(R.GATE_BINS), len(hours))) for sid in pts}          # P complete (see docstring)
    excl = R.excluded_gauges(AM, D, obs, list(pts))
    rows = []
    for sid in R4.GAUGES:
        if sid not in pts:
            rows.append({"gauge": sid, "included": False, "reason": "no CO-OPS metadata"})
            continue
        both = np.isfinite(obs[sid]) & np.all(np.isfinite(D[sid]), axis=0)
        rows.append({"gauge": sid, "included": sid not in excl, "reason": excl.get(sid),
                     "D_coverage": round(min(R.coverage(r) for r in D[sid]), 4),
                     "observed_coverage": round(R.coverage(obs[sid]), 4),
                     "gauge_days_D_and_observed": round(float(both.sum()) / 24.0, 1)})
    inc = [r for r in rows if r["included"]]
    print(json.dumps({"record_of": "G4 power check run 44419701002 (attempt 2)", "window": "G3t's seen window",
                      "window_days": len(hours) / 24.0, "n_gauges": len(R4.GAUGES), "n_included": len(inc),
                      "gauge_days_included": round(sum(r["gauge_days_D_and_observed"] for r in inc), 1),
                      "rows": rows}, indent=1))


if __name__ == "__main__":
    main()
