"""Same rows, two truths: how much of the primary-swell direction error is the TRUTH DEFINITION?

For every (buoy, cycle, lead) pair the partition lane scores, this also reads the buoy's bulk MWD (NDBC standard-met
column, the truth of the S8 bulk lane) at the same target hour, and reports the GFS-Wave slot-1 direction error against
(a) the observed primary train and (b) the MWD, plus the distance between the two truths. Rows are IDENTICAL across
columns, so the difference is the definition of truth, not the sample.

  python -m scripts.partition_truth.mwd_decomposition --start 2026-10-12 --end 2026-11-08 \
      --target-start 2026-10-19 --target-end 2026-11-09 [--buoys 46025 ...] --out result.json
Needs the same cache the main run filled (RAW_SURF_PARTITION_TRUTH_CACHE); reads no other service.
"""
import argparse
import json
from datetime import datetime, timedelta, timezone

import numpy as np

from scripts.partition_truth import gfswave_partitions as gw
from scripts.partition_truth import ndbc_spectra as nd
from scripts.partition_truth import partitioner as P
from scripts.partition_truth import score as sc
from scripts.partition_truth.run_partition_truth import GATE, LEADS, STATIONS, nearest, observed_trains, pick

MWD_MIN_HS_M = 0.3          # the S8 bulk lane's own observed-Hs gate for direction


def read_mwd(sid):
    """{time: (mwd_deg_from, wvht_m)} from the cached standard-met file; missing -> omitted."""
    out = {}
    path = nd.cache_dir() / f"{sid}.txt"
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        try:
            t = datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=timezone.utc)
            mwd, hs = float(p[11]), float(p[8])
        except (ValueError, IndexError):
            continue
        if mwd < 998 and 0 <= hs < 90:
            out[t] = (mwd, hs)
    return out


def near(d, t, tol=30):
    best = None
    for dt in range(-tol, tol + 1, 10):
        v = d.get(t + timedelta(minutes=dt))
        if v is not None and (best is None or abs(dt) < best[0]):
            best = (abs(dt), v)
    return None if best is None else best[1]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--target-start", default="0000")
    ap.add_argument("--target-end", default="9999")
    ap.add_argument("--buoys", nargs="*", default=STATIONS)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    d0 = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    d1 = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc) + timedelta(hours=12)
    cyc = gw.cycles(d0, d1)
    pos = nd.station_positions(set(a.buoys))
    stations = {s: nd.load_station(s, max_age_h=1e6) for s in a.buoys if s in pos}
    stations = {s: v for s, v in stations.items() if v}
    pos = {s: pos[s] for s in stations}
    mwd = {s: read_mwd(s) for s in stations}
    cols = {k: [] for k in ("lead", "station", "day", "model_vs_train", "model_vs_mwd", "train_vs_mwd", "persist_mwd")}
    for c in cyc:
        for lead in LEADS:
            try:
                samp = gw.sample(c, lead, pos)
            except Exception:
                continue
            T = c + timedelta(hours=lead)
            day = f"{T:%Y-%m-%d}"
            if not a.target_start <= day <= a.target_end:
                continue
            for s, st in stations.items():
                it, ic = nearest(st["times"], T), nearest(st["times"], c)
                v = (samp.get(s) or {}).get("swell1")
                if it is None or ic is None or not v or v[0] < 0.1:
                    continue
                tr = pick(observed_trains(st, it)[0], "primary")
                mt, mc = near(mwd[s], T), near(mwd[s], c)
                if tr is None or tr["hs_m"] < GATE["primary"] or mt is None or mc is None or mt[1] < MWD_MIN_HS_M:
                    continue
                cols["lead"].append(lead); cols["station"].append(s); cols["day"].append(day)
                cols["model_vs_train"].append(float(P.angdiff(v[2], tr["dir_deg"])))
                cols["model_vs_mwd"].append(float(P.angdiff(v[2], mt[0])))
                cols["train_vs_mwd"].append(float(P.angdiff(tr["dir_deg"], mt[0])))
                cols["persist_mwd"].append(float(P.angdiff(mc[0], mt[0])))
    blocks = sc.station_blocks(pos)
    out = {"buoys": sorted(stations), "n_blocks": len(set(blocks.values())), "window_targets": [a.target_start, a.target_end],
           "gate": {"train_obs_hs_m": GATE["primary"], "mwd_obs_hs_m": MWD_MIN_HS_M}, "by_lead": {}}
    L = np.array(cols["lead"])
    for lead in LEADS:
        m = L == lead
        if not m.any():
            continue
        g = lambda k: np.array(cols[k])[m]
        rows = [{"station": s, "day": dd, "model_err": x, "persist_err": y}
                for s, dd, x, y in zip(np.array(cols["station"])[m], np.array(cols["day"])[m], g("model_vs_mwd"), g("persist_mwd"))]
        out["by_lead"][f"+{lead}h"] = {
            "n": int(m.sum()), "n_buoys": len(set(np.array(cols["station"])[m])),
            "mae_model_vs_train": float(np.mean(np.abs(g("model_vs_train")))),
            "mae_model_vs_mwd": float(np.mean(np.abs(g("model_vs_mwd")))),
            "mae_train_vs_mwd (distance between the two truths)": float(np.mean(np.abs(g("train_vs_mwd")))),
            "mae_persistence_vs_mwd": float(np.mean(np.abs(g("persist_mwd")))),
            "bias_model_vs_train": float(np.mean(g("model_vs_train"))), "bias_model_vs_mwd": float(np.mean(g("model_vs_mwd"))),
            "model_vs_mwd_minus_persistence": sc.summarize(rows, "dir", blocks)}
    text = json.dumps(out, indent=1, default=str)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(text)
    print(text)


if __name__ == "__main__":
    main()
