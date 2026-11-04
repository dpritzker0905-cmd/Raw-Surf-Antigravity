"""r7_score.py - round 7 gate on the harness's own replays: pooled two-way (spatial block ~100 km x day) bootstrap
(binding), station-cluster CI (advisory), Holm over season + region harm tests, controls, the offline nearshore-input
(NSI) x SURF_SPECTRAL_K factorial stratified by the pre-registered sampled-cell depth.
Usage: python r7_score.py out_W4 out_W1 out_W26 ..."""
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, r"C:\t\r7c\backend")
from services.weather_pipeline import eval_scoring as sc  # noqa: E402
from services.weather_pipeline import bight_hs_consensus as B  # noqa: E402
from services.weather_pipeline.nearshore_validation import model_hs_from_nearshore_input  # noqa: E402

REPS = 2000
ET = np.load(r"C:\t\r7c\backend\services\weather_pipeline\data\etopo_depth_0p25.npy")
STN = {s["id"]: s for s in json.load(open(os.path.join(os.path.dirname(__file__), "stations_r7.json")))["stations"]}


def d_cell(lat, lng):
    i0, j0 = int(math.floor((lat + 90) / 0.25)), int(math.floor((lng + 180) / 0.25))
    v = [float(ET[i % ET.shape[0], j % ET.shape[1]]) for i in (i0, i0 + 1) for j in (j0, j0 + 1)]
    v = [x for x in v if x > 0]
    return sum(v) / len(v) if v else None


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, h)))


BIGHT_BLOCK = {"46251": "N", "46025": "N", "46221": "N", "103p1": "N", "46222": "SP", "46253": "SP", "46256": "SP",
               "213p1": "SP", "215p1": "SP", "46277": "OC", "46224": "OC", "284p1": "OC", "264p1": "OC", "46225": "SD",
               "46258": "SD", "46232": "SD", "262p1": "SD", "153p1": "SD", "201p1": "SD", "101p1": "SD"}


def blocks(ids, km=100.0):
    """~100 km blocks: round 6's a-priori Bight blocks (N/SP/OC/SD, ~50-100 km) and 1-degree latitude bands outside
    (single linkage chained the whole coast into one block, which no CI can resample)."""
    return {s: "B:" + BIGHT_BLOCK.get(s, "lat%d" % int(math.floor(STN[s]["lat"]))) for s in ids}


def blocks_single_linkage(ids, km=100.0):
    """Single-linkage clusters of station coordinates at `km` (pre-registered ~100 km)."""
    ids = sorted(ids)
    lab = {s: s for s in ids}

    def root(s):
        while lab[s] != s:
            s = lab[s]
        return s
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if hav((STN[a]["lat"], STN[a]["lng"]), (STN[b]["lat"], STN[b]["lng"])) <= km:
                lab[root(b)] = root(a)
    return {s: "B:" + root(s) for s in ids}


def region(sid):
    s = STN[sid]
    return "bight" if B.inside_bight(s["lat"], s["lng"]) else "outside"


def twoway(vals, a, b, reps=REPS, seed=13):
    vals = np.asarray(vals, float)
    rng = np.random.default_rng(seed)
    ua, ia = np.unique(np.asarray(a), return_inverse=True)
    ub, ib = np.unique(np.asarray(b), return_inverse=True)
    bs = []
    for _ in range(reps):
        w = np.bincount(rng.integers(0, len(ua), len(ua)), minlength=len(ua))[ia] * \
            np.bincount(rng.integers(0, len(ub), len(ub)), minlength=len(ub))[ib]
        if w.sum():
            bs.append(float((w * vals).sum() / w.sum()))
    bs = np.array(bs)
    return float(vals.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), float((bs >= 0).mean())


def cluster(vals, g, reps=REPS, seed=11):
    vals = np.asarray(vals, float)
    u, inv = np.unique(np.asarray(g), return_inverse=True)
    sums, cnt = np.bincount(inv, weights=vals), np.bincount(inv).astype(float)
    W = np.random.default_rng(seed).multinomial(len(u), np.full(len(u), 1 / len(u)), size=reps).astype(float)
    bs = (W @ sums) / np.maximum(W @ cnt, 1e-12)
    return [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]


def load(win):
    tj = json.load(open(os.path.join(win, "truth.json")))
    truth = {sid: sorted((dict(o, time=datetime.strptime(o["time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc))
                          for o in recs), key=lambda o: o["time"]) for sid, recs in tj["records"].items()}
    stations = {sid: {"depth_m": STN.get(sid, {}).get("depth_m"), "source": v["source"]} for sid, v in tj["stations"].items()}
    reps = {f[7:-5]: json.load(open(os.path.join(win, f)))["rows"] for f in os.listdir(win)
            if f.startswith("replay_") and f.endswith(".json")}
    ts = sorted(datetime.strptime(r["valid"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc) for r in reps["served"])
    emb = sc.clim_embargo(ts[0], ts[-1], 72)
    return truth, stations, reps, emb


def nsi_rows(rows, k_rows=None):
    """Offline NSI instrument: hs_station = linear shoaling from d_cell (ETOPO 4-node stencil at the spot) to the buoy
    depth, nothing else. With k_rows (the SSK arm), rows whose station carries a K value keep it."""
    out = []
    kmap = {(r["station"], r["valid"], r["lead_h"]): r for r in (k_rows or []) if r.get("anchor")}
    for r in rows:
        r = dict(r)
        if r.get("anchor") and r.get("role") == "nearshore" and r.get("hs_station_m") is not None:
            kr = kmap.get((r["station"], r["valid"], r["lead_h"]))
            if kr is not None and kr.get("_k"):
                r["hs_station_m"] = kr["hs_station_m"]
            else:
                inp = r.get("inputs") or {}
                v = model_hs_from_nearshore_input(inp.get("offshore_hs_m"), inp.get("tp_s"), d_cell(r["lat"], r["lng"]),
                                                  float(STN[r["station"]].get("depth_m") or 20.0))
                if v is not None:
                    r["hs_station_m"] = v
        out.append(r)
    return out


def items_for(q, ref_rows, cand_rows, truth, stations, emb, tag):
    a, _ = sc.build_items(q, ref_rows, truth, stations, None, clim_embargo=emb)
    b, _ = sc.build_items(q, cand_rows, truth, stations, None, clim_embargo=emb)
    out = []
    for i in sc.pair(a, b):
        sid = i["buoy"]
        out.append({"st": sid, "day": f"{tag}:{i['t']:%Y-%m-%d}", "season": tag, "region": region(sid),
                    "lead": i.get("lead"), "obs": i["obs"], "ref": i["f_ref"], "cand": i["f_cand"]})
    return out


def gate(rows, blk):
    if len(rows) < 50:
        return {"n": len(rows), "verdict": "REFUSED (n < 50)"}
    d = np.array([abs(r["ref"] - r["obs"]) - abs(r["cand"] - r["obs"]) for r in rows])
    if np.all(d == 0):
        return {"n": len(rows), "gain": 0.0, "verdict": "REFUSED (no change)"}
    b = [blk[r["st"]] for r in rows]
    days = [r["day"] for r in rows]
    m, lo, hi, _ = twoway(d, b, days)
    res = {"n": len(rows), "stations": len({r["st"] for r in rows}), "blocks": len(set(b)), "days": len(set(days)),
           "gain": round(m, 4), "twoway_ci": [round(lo, 4), round(hi, 4)], "station_ci": cluster(d, [r["st"] for r in rows]),
           "bias_ref": round(float(np.mean([r["ref"] - r["obs"] for r in rows])), 3),
           "bias_cand": round(float(np.mean([r["cand"] - r["obs"] for r in rows])), 3),
           "mae_ref": round(float(np.mean([abs(r["ref"] - r["obs"]) for r in rows])), 3)}
    harm, strata = [], {}
    for key in ("season", "region"):
        for v in sorted({r[key] for r in rows}):
            sub = [i for i, r in enumerate(rows) if r[key] == v]
            if len(sub) < 30 or np.all(d[sub] == 0):
                continue
            mm, l2, h2, p_ge0 = twoway(d[sub], [b[i] for i in sub], [days[i] for i in sub], reps=1000)
            strata[f"{key}={v}"] = {"n": len(sub), "gain": round(mm, 4), "ci": [round(l2, 4), round(h2, 4)]}
            # one-sided harm p-value: P_boot(gain >= 0); small = significantly worse
            harm.append((f"{key}={v}", max(p_ge0, 1.0 / 1000)))
    worse, k = [], len(harm)
    for idx, (name, p) in enumerate(sorted(harm, key=lambda x: x[1])):
        if p <= 0.05 / (k - idx):
            worse.append(name)
        else:
            break
    res["strata"] = strata
    res["holm_worse"] = worse
    res["verdict"] = "PASS" if lo > 0 and not worse else "FAIL"
    return res


def controls(rows, blk):
    out = {}
    for name, fac in (("null", 1.0), ("positive_0.8", 0.8), ("negative_1.25", 1.25)):
        rr = [dict(r, cand=r["obs"] + fac * (r["ref"] - r["obs"])) for r in rows]
        g = gate(rr, blk)
        out[name] = g.get("verdict"), g.get("twoway_ci")
    ok = out["null"][0].startswith("REFUSED") and out["positive_0.8"][0] == "PASS" and out["negative_1.25"][0] == "FAIL"
    return out, ok


def main(wins):
    pooled, served_rows_by_q = {}, {}
    for win in wins:
        tag = os.path.basename(win).replace("out_", "")
        truth, stations, reps, emb = load(win)
        served = reps["served"]
        # mark K coverage on the SSK arm rows (hs_station differs from served at the same key)
        sk = reps.get("SURF_SPECTRAL_K_1")
        if sk:
            sv = {(r["station"], r["valid"], r["lead_h"], r["spot"]): r.get("hs_station_m") for r in served}
            for r in sk:
                r["_k"] = r.get("hs_station_m") != sv.get((r["station"], r["valid"], r["lead_h"], r["spot"]))
        arms = {k: v for k, v in reps.items() if k != "served"}
        nsi = nsi_rows(served)
        arms["NSI(offline)"] = nsi
        if sk:
            arms["NSI+SSK(offline)"] = nsi_rows(served, sk)
        for q in ("hs_station", "hb_proxy", "hs_offshore"):
            served_rows_by_q.setdefault(q, []).extend(items_for(q, served, served, truth, stations, emb, tag))
            for arm, rows in arms.items():
                if q != "hs_station" and arm.startswith("NSI"):
                    continue
                pooled.setdefault((arm, q), []).extend(items_for(q, served, rows, truth, stations, emb, tag))
            if q == "hs_station" and sk:   # factorial cell: SSK vs NSI baseline
                pooled.setdefault(("NSI+SSK vs NSI", q), []).extend(items_for(q, nsi, arms["NSI+SSK(offline)"], truth, stations, emb, tag))
    ids = {r["st"] for rows in pooled.values() for r in rows}
    blk = blocks(ids)
    out = {"blocks": blk, "windows": [os.path.basename(w) for w in wins], "arms": {}, "controls": {}}
    for q, rows in served_rows_by_q.items():
        out["controls"][q] = controls(rows, blk)
    for (arm, q), rows in sorted(pooled.items()):
        g = gate(rows, blk)
        moved = {r["st"] for r in rows if r["ref"] != r["cand"]}
        aff = [r for r in rows if r["st"] in moved]
        if moved and len(moved) < len({r["st"] for r in rows}):
            ga = gate(aff, blk)
            g["affected_scope"] = {k: ga.get(k) for k in ("n", "stations", "blocks", "gain", "twoway_ci", "station_ci",
                                                          "bias_ref", "bias_cand", "holm_worse", "verdict", "strata")}
        if q == "hs_station" and arm.startswith(("NSI", "SURF_SPECTRAL_K")) and rows:
            st = {}
            for lab, f in (("cell<50m", lambda x: x < 50), ("cell50-200m", lambda x: 50 <= x <= 200), ("cell>200m", lambda x: x > 200)):
                sub = [r for r in rows if (d := d_cell(STN[r["st"]]["anchor_spot"]["lat"], STN[r["st"]]["anchor_spot"]["lng"])) is not None and f(d)]
                if len(sub) >= 30:
                    dd = np.array([abs(r["ref"] - r["obs"]) - abs(r["cand"] - r["obs"]) for r in sub])
                    m, lo, hi, _ = twoway(dd, [blk[r["st"]] for r in sub], [r["day"] for r in sub], reps=1000)
                    st[lab] = {"n": len(sub), "stations": sorted({r["st"] for r in sub}), "gain": round(m, 4), "ci": [round(lo, 4), round(hi, 4)]}
            g["d_cell_strata"] = st
        per_st = {}
        for s in sorted({r["st"] for r in rows}):
            sub = [r for r in rows if r["st"] == s]
            per_st[s] = round(float(np.mean([abs(r["ref"] - r["obs"]) - abs(r["cand"] - r["obs"]) for r in sub])), 3)
        g["per_station_gain"] = per_st
        out["arms"][f"{arm}|{q}"] = g
        print(f"{arm:70s} {q:11s} n {g.get('n'):5d} gain {g.get('gain')} 2way {g.get('twoway_ci')} st {g.get('station_ci')} "
              f"bias {g.get('bias_ref')}->{g.get('bias_cand')} worse {g.get('holm_worse')} {g.get('verdict')} blk {g.get('blocks')}", flush=True)
        a = g.get("affected_scope")
        if a:
            print(f"{'   affected stations only':70s} {q:11s} n {a['n']:5d} st {a['stations']} blk {a['blocks']} gain {a['gain']} 2way {a['twoway_ci']} worse {a['holm_worse']} {a['verdict']}", flush=True)
    print("CONTROLS", json.dumps(out["controls"]))
    json.dump(out, open("r7_gate.json", "w"), indent=1, default=str)


if __name__ == "__main__":
    main(sys.argv[1:])
