"""Why do the open-ocean buoys carry ~42 deg primary-swell direction error? Per-buoy breakdown + candidate-cause tests.
Run from backend/ with RAW_SURF_PARTITION_TRUTH_CACHE set (the cache the main run filled):
  python scripts/partition_truth/open_ocean_breakdown.py <json of the S8 bulk lane buoy ids, i.e. meta.buoys of its s8_offline.json>
"open" = scored buoys NOT in that list. Offline; reads no service."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import json
import sys
from collections import defaultdict
from datetime import timedelta

import numpy as np

from scripts.partition_truth import gfswave_partitions as gw
from scripts.partition_truth import ndbc_spectra as nd
from scripts.partition_truth import partitioner as P
from scripts.partition_truth.mwd_decomposition import MWD_MIN_HS_M, near, read_mwd
from scripts.partition_truth.run_partition_truth import GATE, LEADS, STATIONS, nearest, observed_trains

S8 = set(json.load(open(sys.argv[1])))
T0, T1 = "2026-10-19", "2026-11-09"
from datetime import datetime, timezone
d0 = datetime(2026, 10, 12, tzinfo=timezone.utc)
d1 = datetime(2026, 11, 8, tzinfo=timezone.utc) + timedelta(hours=12)
cyc = gw.cycles(d0, d1)
pos = nd.station_positions(set(STATIONS))
stations = {s: nd.load_station(s, max_age_h=1e6) for s in STATIONS if s in pos}
stations = {s: v for s, v in stations.items() if v}
pos = {s: pos[s] for s in stations}
mwd = {s: read_mwd(s) for s in stations}

R = defaultdict(lambda: defaultdict(list))
for c in cyc:
    for lead in LEADS:
        try:
            samp = gw.sample(c, lead, pos)
        except Exception:
            continue
        T = c + timedelta(hours=lead)
        day = f"{T:%Y-%m-%d}"
        if not T0 <= day <= T1:
            continue
        for s, st in stations.items():
            it, ic = nearest(st["times"], T), nearest(st["times"], c)
            rec = samp.get(s) or {}
            if it is None or ic is None:
                continue
            trs, res = observed_trains(st, it)
            sw = trs["swell"]
            if not sw or sw[0]["hs_m"] < GATE["primary"]:
                continue
            v1 = rec.get("swell1")
            if not v1 or v1[0] < 0.1:
                continue
            o = sw[0]
            r = R[s]
            r["lead"].append(lead)
            r["e1"].append(float(P.angdiff(v1[2], o["dir_deg"])))
            errs = []
            for k in ("swell1", "swell2", "swell3"):
                v = rec.get(k)
                if v and v[0] >= 0.1:
                    errs.append(abs(float(P.angdiff(v[2], o["dir_deg"]))))
            r["best3"].append(min(errs))
            # oracle over observed trains: closest observed swell train to model slot 1 (rank-free)
            r["any_obs"].append(min(abs(float(P.angdiff(v1[2], t["dir_deg"]))) for t in sw))
            # also vs observed wind sea
            ws = trs["windsea"]
            r["vs_ws"].append(abs(float(P.angdiff(v1[2], ws["dir_deg"]))) if ws else np.nan)
            r["obs_hs"].append(o["hs_m"]); r["obs_tp"].append(o["tp_s"]); r["mod_hs"].append(v1[0]); r["mod_tp"].append(v1[1])
            r["has2"].append(len(sw) > 1 and sw[1]["hs_m"] >= 0.7 * o["hs_m"])
            r["n_swell"].append(len(sw))
            r["ws_frac"].append((ws["hs_m"] ** 2) / (ws["hs_m"] ** 2 + sum(t["hs_m"] ** 2 for t in sw)) if ws else 0.0)
            ocn = nearest(st["times"], c)
            if ocn is not None:
                tc = observed_trains(st, ocn)[0]["swell"]
                r["persist"].append(abs(float(P.angdiff(tc[0]["dir_deg"], o["dir_deg"]))) if tc else np.nan)
            mt = near(mwd[s], T)
            r["mwd_err"].append(abs(float(P.angdiff(v1[2], mt[0]))) if mt else np.nan)
            r["trainmwd"].append(abs(float(P.angdiff(o["dir_deg"], mt[0]))) if mt else np.nan)
            r["tp_diff"].append(v1[1] - o["tp_s"])

rows = []
for s, r in R.items():
    a = lambda k: np.array(r[k], float)
    rows.append((s, s not in S8, pos[s], len(r["e1"]), np.mean(np.abs(a("e1"))), np.mean(a("best3")), np.mean(a("any_obs")),
                 np.nanmean(a("persist")), np.nanmean(a("mwd_err")), np.nanmean(a("trainmwd")), np.mean(a("obs_hs")), np.mean(a("mod_hs")),
                 np.mean(a("obs_tp")), np.mean(a("mod_tp")), np.mean(a("has2")), np.mean(a("ws_frac")), np.mean(a("n_swell"))))
rows.sort(key=lambda x: (not x[1], -x[4]))
print("buoy open  lat     lon      n  MAE1  best3 anyObs persist  MWDerr trn-MWD obsHs modHs obsTp modTp has2 wsFrac nSw")
for s, op, (la, lo), n, e1, b3, ao, pe, me, tm, oh, mh, ot, mt_, h2, wf, ns in rows:
    print(f"{s} {'Y' if op else '.'} {la:7.2f} {lo:8.2f} {n:4d} {e1:5.1f} {b3:5.1f} {ao:5.1f} {pe:6.1f} {me:6.1f} {tm:6.1f} {oh:5.2f} {mh:5.2f} {ot:5.1f} {mt_:5.1f} {h2:4.2f} {wf:5.2f} {ns:4.1f}")


def pool(sel):
    out = {}
    for k in ("e1", "best3", "any_obs", "persist", "mwd_err", "trainmwd", "vs_ws", "obs_hs", "tp_diff"):
        out[k] = np.concatenate([np.array(R[s][k], float) for s in sel])
    out["has2"] = np.concatenate([np.array(R[s]["has2"], float) for s in sel])
    out["e1abs"] = np.abs(out["e1"]); out["e1signed"] = out["e1"]
    return out


for name, sel in (("open", [s for s in R if s not in S8]), ("near", [s for s in R if s in S8])):
    p = pool(sel)
    print(f"\n[{name}] buoys={len(sel)} rows={len(p['e1'])}  MAE slot1={np.mean(p['e1abs']):.1f}  best-of-3-slots={np.mean(p['best3']):.1f}  "
          f"any-observed-swell-train={np.mean(p['any_obs']):.1f}  persistence={np.nanmean(p['persist']):.1f}  vs MWD={np.nanmean(p['mwd_err']):.1f}  "
          f"train-vs-MWD={np.nanmean(p['trainmwd']):.1f}  mean Tp(model-obs)={np.mean(p['tp_diff']):.2f}s  ambiguous-2nd-swell share={np.mean(p['has2']):.2f}")
    print(f"   error quantiles |e|: " + " ".join(f"p{q}={np.percentile(p['e1abs'], q):.0f}" for q in (25, 50, 75, 90)) +
          f"   share>90deg={np.mean(p['e1abs'] > 90):.2f}  share>150deg={np.mean(p['e1abs'] > 150):.2f}")
    for lo, hi in ((0.5, 1.0), (1.0, 2.0), (2.0, 99)):
        m = (p["obs_hs"] >= lo) & (p["obs_hs"] < hi)
        if m.any():
            print(f"   obs primary Hs {lo}-{hi} m: n={m.sum()} MAE={np.mean(p['e1abs'][m]):.1f}")
