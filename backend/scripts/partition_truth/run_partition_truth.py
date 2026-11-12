"""Partition-truth instrument: score stored GFS-Wave partitions against buoy-spectrum partitions (offline).

Run from backend/:
  python -m scripts.partition_truth.run_partition_truth --start 2026-10-12 --end 2026-11-08 --out result.json
Needs numpy and Pillow (JPEG2000 GRIB decode). Public hosts only: ndbc.noaa.gov, noaa-gfs-bdp-pds.s3.amazonaws.com.
Cache: RAW_SURF_PARTITION_TRUTH_CACHE (default <tempdir>/raw_surf_partition_truth). Nothing is written to the repo.
It changes no served number and reads no Raw Surf service.

For each station, cycle (00Z and 12Z) and lead (24/48/72 h): the OBSERVED trains at the target hour (partitioner.py on
the buoy's spectrum) against the model's slot-1 swell, slot-2 swell and wind sea at the buoy, and against PERSISTENCE
(the observed train of the same rank at the issue time). A pair is scored only where the observed train is real
(Hs gate) and the model slot is populated.
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np

from scripts.partition_truth import gfswave_partitions as gw
from scripts.partition_truth import ndbc_spectra as nd
from scripts.partition_truth import partitioner as P
from scripts.partition_truth import score as sc

STATIONS = ("46025 46026 46042 46054 46086 46059 46002 46005 46006 46013 46014 46022 46027 46050 46041 46029 46087 "
            "51001 51002 51003 51004 51101 51201 51202 41002 41004 41008 41010 41025 41043 41047 41049").split()
LEADS = (24, 48, 72)
GATE = {"primary": 0.5, "secondary": 0.3, "windsea": 0.3}     # observed Hs (m) a train must reach to be scored
MODEL_MIN_HS = 0.1


def nearest(times, target, tol_min=30):
    best = None
    for i, t in enumerate(times):
        d = abs((t - target).total_seconds()) / 60.0
        if d <= tol_min and (best is None or d < best[0]):
            best = (d, i)
    return None if best is None else best[1]


def observed_trains(st, i, **kw):
    t = st["times"][i]
    w = None
    for dt in (0, -10, 10, -20, 20, -30, 30):
        w = st["wind"].get(t + timedelta(minutes=dt))
        if w and w[0] < 998 and w[1] < 98:
            break
        w = None
    zero = np.zeros_like(st["a1"][i])
    res = P.partition_spectrum(st["freq"], st["energy"][i], st["a1"][i], st["b1"][i], zero, zero,
                               wind_speed_ms=None if w is None else w[1],
                               wind_dir_from_deg=None if w is None else w[0], **kw)
    return P.trains(res), res


def pick(tr, which):
    if which == "primary":
        return tr["swell"][0] if tr["swell"] else None
    if which == "secondary":
        return tr["swell"][1] if len(tr["swell"]) > 1 else None
    return tr["windsea"]


def model_train(rec, which):
    slot = {"primary": "swell1", "secondary": "swell2", "windsea": "windsea"}[which]
    v = (rec or {}).get(slot)
    if not v or v[0] < MODEL_MIN_HS:
        return None
    return {"hs_m": v[0], "tp_s": v[1], "dir_deg": v[2]}


def build_rows(obs_cache, sample_by, stations, cycles):
    rows = defaultdict(list)          # (lead, which, metric) -> rows
    diag = defaultdict(lambda: defaultdict(int))
    for st_id, st in stations.items():
        for c in cycles:
            ic = nearest(st["times"], c)
            if ic is None:
                continue
            tr_c = obs_cache(st_id, ic)
            for lead in LEADS:
                T = c + timedelta(hours=lead)
                it = nearest(st["times"], T)
                rec = sample_by.get((c, lead), {}).get(st_id)
                if it is None or rec is None:
                    continue
                tr_t = obs_cache(st_id, it)
                for which in ("primary", "secondary", "windsea"):
                    ot, oc, mt = pick(tr_t, which), pick(tr_c, which), model_train(rec, which)
                    if ot is None or ot["hs_m"] < GATE[which]:
                        continue
                    u = diag[(lead, f"match:{which}")]
                    u["observed_real"] += 1
                    if mt is None:
                        u["unmatched_model_slot_empty"] += 1
                        continue
                    if oc is None:
                        u["unmatched_no_persistence_train"] += 1
                        continue
                    u["scored"] += 1
                    day = f"{T:%Y-%m-%d}"
                    for metric, key in (("dir", "dir_deg"), ("period", "tp_s"), ("height", "hs_m")):
                        rows[(lead, which, metric)].append({
                            "station": st_id, "day": day, "model_err": sc._err(metric, mt[key], ot[key]),
                            "persist_err": sc._err(metric, oc[key], ot[key])})
                if tr_t["swell"] and tr_t["swell"][0]["hs_m"] >= GATE["primary"]:      # slot diagnostics, primary swell
                    o = tr_t["swell"][0]
                    errs = []
                    for slot in ("swell1", "swell2", "swell3"):
                        v = (rec or {}).get(slot)
                        errs.append(None if not v or v[0] < MODEL_MIN_HS else abs(float(P.angdiff(v[2], o["dir_deg"]))))
                    d = diag[(lead, "slots")]
                    d["n"] += 1
                    if errs[0] is None:
                        d["slot1_empty"] += 1
                    ok = [(e, k) for k, e in enumerate(errs) if e is not None]
                    if ok:
                        best = min(ok)[1]
                        d["best_is_slot1"] += int(best == 0)
                        d["best_is_slot2_or_3"] += int(best > 0)
                        d["slot1_off_over_45_but_another_slot_within_25"] += int(
                            errs[0] is not None and errs[0] > 45 and min(e for e, _ in ok) <= 25)
    return rows, diag


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", required=True, help="first cycle date, YYYY-MM-DD (00Z and 12Z cycles)")
    ap.add_argument("--end", required=True, help="last cycle date, YYYY-MM-DD")
    ap.add_argument("--stations", nargs="*", default=STATIONS)
    ap.add_argument("--merge-ratio", type=float, default=P.MERGE_RATIO)
    ap.add_argument("--model", choices=("wrapped_normal", "mem"), default="wrapped_normal")
    ap.add_argument("--radius-km", type=float, default=500.0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    d0 = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    d1 = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc) + timedelta(hours=12)
    cyc = gw.cycles(d0, d1)

    pos = nd.station_positions(set(a.stations))
    stations = {}
    for s in a.stations:
        st = nd.load_station(s) if s in pos else None
        if st:
            stations[s] = st
    pos = {s: pos[s] for s in stations}
    print(f"stations with spectra: {len(stations)}/{len(a.stations)}", file=sys.stderr)

    sample_by = {}
    for c in cyc:
        for lead in LEADS:
            try:
                sample_by[(c, lead)] = gw.sample(c, lead, pos)
            except Exception as e:                   # a missing cycle is a gap, reported, never filled
                print(f"gap {c:%Y-%m-%d %HZ} f{lead:03d}: {type(e).__name__}: {e}", file=sys.stderr)
    print(f"model samples: {len(sample_by)}/{len(cyc) * len(LEADS)} (cycle,lead) files", file=sys.stderr)

    memo = {}

    def obs_cache(sid, i):
        k = (sid, i)
        if k not in memo:
            memo[k] = observed_trains(stations[sid], i, merge_ratio=a.merge_ratio, model=a.model)[0]
        return memo[k]

    rows, diag = build_rows(obs_cache, sample_by, stations, cyc)
    blocks = sc.station_blocks(pos, a.radius_km)
    result = {"window_cycles": [f"{cyc[0]:%Y-%m-%d %HZ}", f"{cyc[-1]:%Y-%m-%d %HZ}"], "partitioner": {
        "model": a.model, "merge_ratio": a.merge_ratio, "min_partition_hs_m": P.MIN_PARTITION_HS_M,
        "wave_age_limit": P.WAVE_AGE_LIMIT}, "gates_obs_hs_m": GATE, "model_min_hs_m": MODEL_MIN_HS,
        "stations_used": sorted(stations), "station_blocks_at_km": a.radius_km,
        "n_station_blocks_all": len(set(blocks.values())), "results": {}, "slot_diagnostics": {}}
    for (lead, which, metric), r in sorted(rows.items()):
        result["results"][f"+{lead}h/{which}/{metric}"] = sc.summarize(r, metric, blocks)
    result["matching_rule"] = ("RANK matching, no peeking: observed primary swell (largest-Hs non-wind-sea train) vs model "
                               "swell slot 1; observed second swell vs slot 2; observed wind sea vs the wind-sea field. "
                               "unmatched_* counts observed trains at or above the Hs gate that were NOT scored.")
    result["match_counts"] = {}
    for (lead, which), d in sorted(diag.items()):
        if which == "slots":
            result["slot_diagnostics"][f"+{lead}h"] = dict(d)
        elif which.startswith("match:"):
            result["match_counts"][f"+{lead}h/{which[6:]}"] = dict(d)
    text = json.dumps(result, indent=1, default=str)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(text)
    return result


if __name__ == "__main__":
    main()
