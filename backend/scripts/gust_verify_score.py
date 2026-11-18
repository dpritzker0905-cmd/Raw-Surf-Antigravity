"""gust_verify_score.py - score the stored gust record (GFS / EURO / ICON vs NDBC GST). Standard library only.

Method: docs/weather-program/log/2026-11-18-opus-gust-verification.md section 1 (pre-registered; this file implements it and
must not drift from it). Input = the files gust_verify_collect.py writes (and gust_bucket_io.py fetches):
  <dir>/stations.json                      the frozen station list (id, lat, lon, z_m, node, land)
  <dir>/cycles/<MODEL>_<YYYYMMDDHH>.json.gz one 00Z run's gust (g) and 10 m wind (u) at every station, per step
  <dir>/obs/<YYYYMMDD>_<kind>.json.gz       NDBC reports [epoch minute, WSPD, GST] per station
(`.new` twins, written by today's collection before upload, are read too.)

  python gust_verify_score.py --dir D --out report.json [--md table.md]

Never calls the Raw Surf backend; reads local files only.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import random
import sys
from array import array
from datetime import datetime, timezone

MODELS = ("GFS", "EURO", "ICON")
BINS = ((0, 23), (24, 47), (48, 71), (72, 119), (120, 240))
GUST_FACTOR = 1.40                 # baseline (a), fixed in the pre-registration
THRESH = 15.0                      # m/s, the hit-rate / false-alarm threshold
Z0 = 0.0002                        # m, open-sea roughness for the log-law adjustment to 10 m
Z_RANGE = (1.0, 50.0)              # m: heights the adjustment is applied to (amendment 1, written before any result)
MATCH_MIN = 10                     # +- minutes: the hourly observation is the report nearest the hour within this
DENSE_PER_HOUR = 5                 # the dense sensitivity uses stations reporting at least this many times an hour
NULL_MIN_RATIO = 1.10              # the null control: shuffled MAE must be >= 10% higher
BOOT = 1000
DECIDE_MIN_CYCLES = 14
DECIDE_MIN_BIAS = 0.5
DECIDE_HALF_BIAS = 0.25


def bin_of(f):
    for lo, hi in BINS:
        if lo <= f <= hi:
            return f"{lo}-{hi}"
    return None


def height_factor(z_m, z0=Z0):
    """U10 / Uz by the neutral log law; None when the height is unknown or outside Z_RANGE (amendment 1)."""
    if z_m is None or not Z_RANGE[0] <= z_m <= Z_RANGE[1]:
        return None
    return math.log(10.0 / z0) / math.log(z_m / z0)


# ---------------------------------------------------------------------------------------------------- reading the record
def _load(path):
    op = gzip.open if ".gz" in os.path.basename(path) else open
    with op(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def _files(d, sub):
    p = os.path.join(d, sub)
    if not os.path.isdir(p):
        return []
    out = {}
    for name in sorted(os.listdir(p)):
        base = name[:-4] if name.endswith(".new") else name
        if base.endswith(".json.gz") or base.endswith(".json"):
            out[base] = os.path.join(p, name)          # a stored file and today's .new twin: the twin is the same run
    return [out[k] for k in sorted(out)]


def load_obs(d):
    """{station: sorted [(epoch_min, wspd, gst)]}; a later file's report replaces an earlier one at the same minute."""
    merged = {}
    for path in _files(d, "obs"):
        for sid, rows in _load(path)["stations"].items():
            m = merged.setdefault(sid, {})
            for t, w, g in rows:
                m[int(t)] = (w, g)
    return {sid: sorted((t, w, g) for t, (w, g) in m.items()) for sid, m in merged.items()}


def hourly(reports):
    """({hour: (gst, wspd)} nearest report within +-MATCH_MIN min, {hour: [gst of every report in (hour-1, hour]]})."""
    near, dense = {}, {}
    for t, w, g in reports:
        h, r = divmod(t, 60)
        if r > 30:
            h, r = h + 1, r - 60
        if abs(r) <= MATCH_MIN:
            prev = near.get(h)
            if prev is None or abs(r) < prev[0]:
                near[h] = (abs(r), g, w)
        if g is not None:
            hk = -(-t // 60)                            # (hour-1, hour] -> the hour that ends it
            dense.setdefault(hk, []).append(g)
    return {h: (g, w) for h, (_, g, w) in near.items()}, dense


def window_obs(hours, v, w):
    """The observation a forecast valid at hour v with window w pairs with: the hourly GST at v (w = 0) or the max of the hourly
    GSTs at v-w+1 .. v, all present; None otherwise."""
    if w == 0:
        x = hours.get(v)
        return x[0] if x else None
    vals = []
    for k in range(w):
        x = hours.get(v - k)
        if x is None or x[0] is None:
            return None
        vals.append(x[0])
    return max(vals)


def dense_obs(dense, v, w):
    """Max of every report in (v-w, v] when there are at least DENSE_PER_HOUR per hour in each hour, else None."""
    vals = []
    for k in range(w):
        got = dense.get(v - k)
        if not got or len(got) < DENSE_PER_HOUR:
            return None
        vals += got
    return max(vals)


# ---------------------------------------------------------------------------------------------------- pairs
class Pairs:
    """Column store per model (array('f') / array('i')) so a month of pairs fits comfortably in memory."""
    COLS_F = ("fc", "ob", "wind", "pers", "dense", "adj")
    COLS_I = ("f", "cycle", "st", "v")

    def __init__(self):
        self.c = {k: array("f") for k in self.COLS_F}
        self.c.update({k: array("i") for k in self.COLS_I})

    def add(self, **kw):
        for k in self.COLS_F:
            x = kw[k]
            self.c[k].append(float("nan") if x is None else x)
        for k in self.COLS_I:
            self.c[k].append(kw[k])

    def __len__(self):
        return len(self.c["f"])


def nan(x):
    return x != x


def cycle_hour(name):
    return int(datetime.strptime(name, "%Y%m%d%H").replace(tzinfo=timezone.utc).timestamp() // 3600)


def build_pairs(d):
    sp = os.path.join(d, "stations.json")
    stations = _load(sp if os.path.exists(sp) else sp + ".new")["stations"]       # a first run has only the .new twin
    ids = [s["id"] for s in stations]
    adj = [height_factor(s.get("z_m")) for s in stations]
    obs = load_obs(d)
    hours, dense = {}, {}
    for i, sid in enumerate(ids):
        hours[i], dense[i] = hourly(obs.get(sid, []))
    pairs = {m: Pairs() for m in MODELS}
    cycles = {m: [] for m in MODELS}
    dropped = []
    for path in _files(d, "cycles"):
        doc = _load(path)
        m = doc["model"]
        if m not in pairs:
            continue
        if doc.get("station_ids") and doc["station_ids"] != ids:
            dropped.append({"file": os.path.basename(path), "why": "station list differs from stations.json"})
            continue
        t0 = cycle_hour(doc["cycle"])
        cycles[m].append(t0)
        for step in doc["steps"]:
            f, w = int(step["f"]), int(step["w"])
            if bin_of(f) is None:
                continue
            v = t0 + f
            for i, g in enumerate(step["g"]):
                if g is None:
                    continue
                ob = window_obs(hours[i], v, w)
                if ob is None:
                    continue
                u = step["u"][i] if step.get("u") else None
                pairs[m].add(fc=g, ob=ob, wind=u, pers=window_obs(hours[i], t0, w),
                             dense=dense_obs(dense[i], v, w) if w else None, adj=adj[i],
                             f=f, cycle=t0, st=i, v=v)
    return stations, pairs, cycles, dropped


# ---------------------------------------------------------------------------------------------------- metrics
def metrics(fc, ob, thresh=THRESH):
    n = len(fc)
    if n == 0:
        return {"n": 0}
    e = [a - b for a, b in zip(fc, ob)]
    hit = sum(1 for a, b in zip(fc, ob) if a >= thresh and b >= thresh)
    miss = sum(1 for a, b in zip(fc, ob) if a < thresh <= b)
    fa = sum(1 for a, b in zip(fc, ob) if b < thresh <= a)
    return {"n": n, "bias": sum(e) / n, "mae": sum(abs(x) for x in e) / n, "rmse": math.sqrt(sum(x * x for x in e) / n),
            "pod": hit / (hit + miss) if hit + miss else None, "far": fa / (hit + fa) if hit + fa else None,
            "n_obs_ge": hit + miss}


def _rows(P, sel, adjusted):
    """(indices kept, forecast list, observation list); adjusted keeps stations with a height and scales the observation."""
    c = P.c
    keep, fc, ob = [], [], []
    for k in sel:
        a = c["adj"][k]
        if adjusted:
            if nan(a):
                continue
            o = c["ob"][k] * a
        else:
            o = c["ob"][k]
        keep.append(k)
        fc.append(c["fc"][k])
        ob.append(o)
    return keep, fc, ob


def boot_bias(P, keep, fc, ob, seed=0, draws=BOOT):
    """95% interval of the bias by resampling whole cycles."""
    per = {}
    for k, a, b in zip(keep, fc, ob):
        s = per.setdefault(P.c["cycle"][k], [0, 0.0])
        s[0] += 1
        s[1] += a - b
    cyc = sorted(per)
    if len(cyc) < 2:
        return None
    rng = random.Random(seed)
    out = []
    for _ in range(draws):
        n = s = 0.0
        for _ in cyc:
            x = per[cyc[rng.randrange(len(cyc))]]
            n += x[0]
            s += x[1]
        out.append(s / n)
    out.sort()
    return [out[int(0.025 * draws)], out[int(0.975 * draws) - 1]]


def score_block(P, sel, adjusted):
    keep, fc, ob = _rows(P, sel, adjusted)
    c = P.c
    adjf = [c["adj"][k] if adjusted else 1.0 for k in keep]
    out = {"model": metrics(fc, ob)}
    if not keep:
        return out
    out["bias_ci95"] = boot_bias(P, keep, fc, ob)
    out["cycles"] = len({c["cycle"][k] for k in keep})
    wk = [(a, b, c["wind"][k]) for k, a, b in zip(keep, fc, ob) if not nan(c["wind"][k])]
    out["gust_factor"] = {"base": metrics([w * GUST_FACTOR for _, _, w in wk], [b for _, b, _ in wk]),
                          "model_same_pairs": metrics([a for a, _, _ in wk], [b for _, b, _ in wk])}
    pk = [(a, b, c["pers"][k] * j) for k, a, b, j in zip(keep, fc, ob, adjf) if not nan(c["pers"][k])]
    out["persistence"] = {"base": metrics([p for _, _, p in pk], [b for _, b, _ in pk]),
                          "model_same_pairs": metrics([a for a, _, _ in pk], [b for _, b, _ in pk])}
    dk = [(a, b, c["dense"][k] * j) for k, a, b, j in zip(keep, fc, ob, adjf) if not nan(c["dense"][k])]
    if dk:
        out["dense"] = {"vs_primary_obs": metrics([a for a, _, _ in dk], [b for _, b, _ in dk]),
                        "vs_dense_obs": metrics([a for a, _, _ in dk], [x for _, _, x in dk])}
    return out


def by_bin(P):
    sel = {}
    for k, f in enumerate(P.c["f"]):
        sel.setdefault(bin_of(f), []).append(k)
    return sel


def null_control(P, seed=2):
    """Within each station and lead bin, permute the forecasts across valid hours; pooled MAE vs the real pooled MAE (RAW)."""
    rng = random.Random(seed)
    groups = {}
    for k in range(len(P)):
        groups.setdefault((P.c["st"][k], bin_of(P.c["f"][k])), []).append(k)
    real = shuf = 0.0
    n = 0
    for ks in groups.values():
        fc = [P.c["fc"][k] for k in ks]
        rng.shuffle(fc)
        for k, s in zip(ks, fc):
            real += abs(P.c["fc"][k] - P.c["ob"][k])
            shuf += abs(s - P.c["ob"][k])
            n += 1
    if n == 0:
        return {"n": 0}
    ratio = shuf / real if real else None
    return {"n": n, "mae": real / n, "mae_shuffled": shuf / n, "ratio": ratio,
            "pass": bool(ratio is not None and ratio >= NULL_MIN_RATIO)}


def positive_control(obs_values, sigma=1.0, seed=1):
    rng = random.Random(seed)
    fc = [o + rng.gauss(0.0, sigma) for o in obs_values]
    m = metrics(fc, obs_values)
    if m["n"] < 1000:
        return dict(m, **{"pass": None, "why": "n < 1000"})
    ok = abs(m["bias"]) <= 0.05 and abs(m["mae"] - sigma * math.sqrt(2 / math.pi)) <= 0.03 and abs(m["rmse"] - sigma) <= 0.03
    return dict(m, **{"pass": ok})


def same_pairs(pairs):
    """Station-valid-hours (in the same lead bin) all three models cover; each model against its own observation (RAW)."""
    idx = {}
    for m, P in pairs.items():
        d = {}
        for k in range(len(P)):
            key = (P.c["st"][k], P.c["v"][k], bin_of(P.c["f"][k]))
            if key not in d or P.c["f"][k] < P.c["f"][d[key]]:      # the shortest lead when two cycles reach the same hour
                d[key] = k
        idx[m] = d
    common = set.intersection(*(set(d) for d in idx.values())) if all(idx.values()) else set()
    out = {}
    for b in [f"{lo}-{hi}" for lo, hi in BINS]:
        keys = [k for k in common if k[2] == b]
        if not keys:
            continue
        out[b] = {m: metrics([pairs[m].c["fc"][idx[m][k]] for k in keys], [pairs[m].c["ob"][idx[m][k]] for k in keys])
                  for m in MODELS}
    return out


def decide(P, sel, cycles_all):
    """The pre-registered correction rule for one model x bin (ADJUSTED primary, RAW sign check)."""
    keep, fc, ob = _rows(P, sel, True)
    out = {"propose": False, "why": []}
    cyc = sorted({P.c["cycle"][k] for k in keep})
    out["cycles"] = len(cyc)
    if len(cyc) < DECIDE_MIN_CYCLES:
        out["why"].append(f"{len(cyc)} cycles < {DECIDE_MIN_CYCLES}: recorded, not acted on")
        return out
    m = metrics(fc, ob)
    ci = boot_bias(P, keep, fc, ob)
    raw = metrics(*_rows(P, sel, False)[1:])
    half = cyc[len(cyc) // 2]
    first = [(a, b) for k, a, b in zip(keep, fc, ob) if P.c["cycle"][k] < half]
    second = [(a, b) for k, a, b in zip(keep, fc, ob) if P.c["cycle"][k] >= half]
    b1 = metrics([a for a, _ in first], [b for _, b in first])
    b2 = metrics([a for a, _ in second], [b for _, b in second])
    corrected = metrics([a - b1["bias"] for a, _ in second], [b for _, b in second])
    checks = {
        "ci_excludes_0": bool(ci and (ci[0] > 0 or ci[1] < 0)),
        "abs_bias_ge_min": abs(m["bias"]) >= DECIDE_MIN_BIAS,
        "raw_same_sign": raw["bias"] * m["bias"] > 0,
        "steady_halves": all(x["bias"] * m["bias"] > 0 and abs(x["bias"]) >= DECIDE_HALF_BIAS for x in (b1, b2)),
        "out_of_sample_mae_lower": corrected["mae"] < b2["mae"],
    }
    out.update(checks=checks, bias=m["bias"], ci95=ci, bias_first_half=b1["bias"], bias_second_half=b2["bias"],
               mae_second_half=b2["mae"], mae_second_half_corrected=corrected["mae"])
    out["propose"] = all(checks.values())
    out["why"] = [k for k, ok in checks.items() if not ok]
    return out


def score(d):
    stations, pairs, cycles, dropped = build_pairs(d)
    land = [s.get("land") for s in stations]
    rep = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "stations": len(stations),
           "stations_with_height": sum(1 for s in stations if height_factor(s.get("z_m")) is not None),
           "cycles": {m: [datetime.fromtimestamp(t * 3600, timezone.utc).strftime("%Y%m%d%H") for t in sorted(c)]
                      for m, c in cycles.items()},
           "dropped_files": dropped, "models": {}, "controls": {}, "decisions": {}}
    for m, P in pairs.items():
        bins = by_bin(P)
        rep["models"][m] = {}
        rep["decisions"][m] = {}
        for b in [f"{lo}-{hi}" for lo, hi in BINS]:
            sel = bins.get(b)
            if not sel:
                continue
            row = {"raw": score_block(P, sel, False), "adjusted": score_block(P, sel, True)}
            for name, flag in (("land", 1), ("sea", 0)):
                part = [k for k in sel if land[P.c["st"][k]] == flag]
                row[name] = {"raw": metrics(*_rows(P, part, False)[1:]), "adjusted": metrics(*_rows(P, part, True)[1:])}
            rep["models"][m][b] = row
            rep["decisions"][m][b] = decide(P, sel, cycles[m])
        rep["controls"][f"null_{m}"] = null_control(P)
    rep["same_pairs"] = same_pairs(pairs)
    allobs = [x for P in pairs.values() for x in P.c["ob"]]
    rep["controls"]["positive"] = positive_control(allobs)
    return rep


# ---------------------------------------------------------------------------------------------------- the table
def _f(x, nd=2, sign=False):
    if x is None:
        return "-"
    return f"{x:+.{nd}f}" if sign else f"{x:.{nd}f}"


def markdown(rep):
    L = [f"Stations {rep['stations']} ({rep['stations_with_height']} with an anemometer height); cycles "
         + ", ".join(f"{m} {len(c)}" for m, c in rep["cycles"].items()) + ".", "",
         "| model | lead h | n | bias raw (95% CI) | bias adj | MAE raw / adj | RMSE adj | POD / FAR adj | MAE gust-factor base | "
         "MAE model / persistence (n) | dense: bias vs primary / vs dense (n) |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for m, bins in rep["models"].items():
        for b, row in bins.items():
            r, a = row["raw"], row["adjusted"]
            rm, am = r["model"], a.get("model", {"n": 0})
            ci = r.get("bias_ci95")
            gf = a.get("gust_factor", {}).get("base", {})
            ps = a.get("persistence", {})
            dn = a.get("dense")
            L.append("| " + " | ".join([
                m, b, str(rm["n"]),
                f"{_f(rm.get('bias'), sign=True)} ({_f(ci[0], sign=True)}, {_f(ci[1], sign=True)})" if ci else _f(rm.get("bias"), sign=True),
                _f(am.get("bias"), sign=True), f"{_f(rm.get('mae'))} / {_f(am.get('mae'))}", _f(am.get("rmse")),
                f"{_f(am.get('pod'))} / {_f(am.get('far'))}", _f(gf.get("mae")),
                f"{_f(ps.get('model_same_pairs', {}).get('mae'))} / {_f(ps.get('base', {}).get('mae'))} ({ps.get('base', {}).get('n', 0)})",
                (f"{_f(dn['vs_primary_obs']['bias'], sign=True)} / {_f(dn['vs_dense_obs']['bias'], sign=True)} "
                 f"({dn['vs_dense_obs']['n']})") if dn else "-"]) + " |")
    L += ["", "Same pairs (RAW, each model against its own observation definition):", "",
          "| lead h | n | GFS bias / MAE | EURO bias / MAE | ICON bias / MAE |", "|---|---|---|---|---|"]
    for b, row in rep["same_pairs"].items():
        L.append(f"| {b} | {row['GFS']['n']} | " + " | ".join(
            f"{_f(row[m]['bias'], sign=True)} / {_f(row[m]['mae'])}" for m in MODELS) + " |")
    c = rep["controls"]
    L += ["", "Controls: " + "; ".join(
        f"null {m} MAE {_f(c[f'null_{m}'].get('mae'))} -> shuffled {_f(c[f'null_{m}'].get('mae_shuffled'))} "
        f"(x{_f(c[f'null_{m}'].get('ratio'))}, {'PASS' if c[f'null_{m}'].get('pass') else 'FAIL'})"
        for m in MODELS if c.get(f"null_{m}", {}).get("n")) +
        f"; positive bias {_f(c['positive'].get('bias'), 3, True)} MAE {_f(c['positive'].get('mae'), 3)} "
        f"RMSE {_f(c['positive'].get('rmse'), 3)} ({'PASS' if c['positive'].get('pass') else c['positive'].get('pass')})."]
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--md")
    a = ap.parse_args(argv)
    rep = score(a.dir)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=1)
    md = markdown(rep)
    if a.md:
        with open(a.md, "w", encoding="utf-8") as fh:
            fh.write(md)
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
