#!/usr/bin/env python3
"""rework_storm_gate.py - the STORM-BLOCK variant of the pooled rework gate (protocol `storm-v1`, PR #727 re-test,
pre-registered 2026-11-05 before any score). Offline: reads evaluation-harness output directories only (truth.json +
replay_<arm>.json), never the network, never the app.

    python scripts/rework_storm_gate.py --win F1=out_f1 --win F2=out_f2 --win F3=out_f3 --ref served \
        --arm SURF_SPECTRAL_K_1 --stations scripts/eval_harness_stations_ca.json --rodeo 142p1 --out gate.json

WHY: D-066's two-way bootstrap resamples spatial blocks x INDEPENDENT UTC days. Swell events last several days and a
72 h lead shares its cycle with the next two target days, so consecutive days are not independent and a day-level
interval is too narrow (review of #727). Here the day factor is replaced by a MOVING BLOCK of STORM_DAYS consecutive
days (Kuensch 1989), drawn within each contiguous run of days (a window); the spatial factor is D-066's unchanged.

THE INTERVAL (`storm_ci`): per replicate, spatial-block weights ~ Multinomial(G_b) as in eval_twoway; for each run of
n consecutive days, ceil(n / L) block starts uniform on 0..n-L, each adding weight 1 to its L days. The replicate
mean is sum(w_b w_d S) / sum(w_b w_d N) over the block x day cells. SE = SD of the replicates. Interval = mean +/-
t(0.975, G - 1) * sqrt(G / (G - 1)) * SE with G = sum over runs of ceil(n / L) (the number of storm blocks drawn),
and SE = the LARGER of the moving-block SD and a non-overlapping 5-day block SD (the same replicate count; a moving
block alone under-covers dependence that comes in whole L-day chunks: a block-constant sign-flip null falsely passed
10.5% in the build), x sqrt((1 + r1) / (1 - r1)), r1 = the lag-1 autocorrelation of consecutive non-overlapping
L-day block means within runs, clipped to [0, 0.9] (`block_lag1`): the persistence BETWEEN storm blocks that a
moving block cannot carry (without it a rho 0.6 day-persistent null falsely passed 7% over 45-day runs).
Needs >= 14 distinct UTC days, else not computable (REFUSED, never PASS).

THE GATE (`run`), every rule fixed in the pre-registration:
  primary     hs_station, pooled over moved stations: storm-block CI lower bound > 0.
  no harm     hb_proxy pooled: one-sided p_worse >= 0.05. Strata on BOTH quantities - spot (station), band (lead 24 /
              48 / 72 h; observed height < 1 / 1-2 / >= 2 m), season (window) - Holm on "worse" across all of them;
              any survivor = FAIL. The named Rodeo check (`--rodeo`, hb_proxy at that station) is UNADJUSTED: one-sided
              p_worse < 0.05 = FAIL (its harm is already on record).
  controls    on the reference's own moved-station pairs, per quantity: identical = REFUSED, 20% less error = PASS,
              25% more = FAIL, and a SIGN-FLIP null (each spatial block x fixed storm block's gains flipped with
              probability 1/2, `NULL_SETS` sets) must falsely pass <= 5%. Synthetic calibration (`calibrate`): AR(1)
              day-persistent nulls (rho <= 0.6) must falsely pass <= 5% on EVERY layout (rho 0.8 is advisory: the
              stated limit of a 3-5 day block), and a 4-null-SD effect must pass >= 80% on the full fresh layout
              (reported, not binding, at 14 days). Any control that misbehaves = INVALID.
  verdict     PASS only if every rule above holds; else FAIL, REFUSED or INVALID.
"""
import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (BACKEND, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

from services.weather_pipeline import eval_twoway as tw  # noqa: E402

try:
    import rework_gate as rg  # noqa: E402
except ImportError:                                          # pragma: no cover - imported as scripts.rework_gate
    from scripts import rework_gate as rg  # noqa: E402

PROTOCOL = "storm-v1"
STORM_DAYS = 5
MIN_DAYS = tw.MIN_DAYS
ALPHA = 0.05
NULL_SETS = 200
MAX_FALSE_PASS = 0.05
MIN_POWER = 0.80
HEIGHT_BANDS = ((0.0, 1.0, "obs<1m"), (1.0, 2.0, "obs1-2m"), (2.0, float("inf"), "obs>=2m"))


def _date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def day_runs(days):
    """Sorted UTC day strings split into runs of consecutive days (a gap of more than one day starts a new run)."""
    runs = []
    for d in sorted(days):
        if runs and (_date(d) - _date(runs[-1][-1])).days == 1:
            runs[-1].append(d)
        else:
            runs.append([d])
    return runs


def n_storm_blocks(days, L=STORM_DAYS):
    return sum(math.ceil(len(r) / L) for r in day_runs(days))


def block_lag1(S, N, runs, L=STORM_DAYS):
    """Lag-1 autocorrelation of consecutive NON-overlapping L-day block means (pooled over spatial blocks), within
    runs, clipped to [0, 0.9]: the persistence between storm blocks that a moving block cannot carry. Fewer than 3
    consecutive pairs = 0."""
    means = []
    for r in runs:
        ms = []
        for k in range(0, len(r) - L + 1, L):
            ds = r[k:k + L]
            num = sum(S[i][d] for i in range(len(S)) for d in ds)
            den = sum(N[i][d] for i in range(len(N)) for d in ds)
            if den > 0:
                ms.append(num / den)
        means.append(ms)
    flat = [x for ms in means for x in ms]
    pairs = [(a, b) for ms in means for a, b in zip(ms, ms[1:])]
    if len(pairs) < 3:
        return 0.0
    mu = sum(flat) / len(flat)
    var = sum((x - mu) ** 2 for x in flat) / len(flat)
    if var <= 0:
        return 0.0
    cov = sum((a - mu) * (b - mu) for a, b in pairs) / len(pairs)
    return min(max(cov / var, 0.0), 0.9)


def _storm_cells_ci(cells, reps, rng, L=STORM_DAYS, level=tw.LEVEL):
    """The storm-block interval from {(spatial block, day): (sum of gain, rows)}."""
    B = sorted({b for b, _ in cells})
    D = sorted({d for _, d in cells})
    di = {d: k for k, d in enumerate(D)}
    S = [[cells.get((b, d), (0.0, 0))[0] for d in D] for b in B]
    N = [[float(cells.get((b, d), (0.0, 0))[1]) for d in D] for b in B]
    runs = [[di[d] for d in r] for r in day_runs(D)]
    nb, nd = len(B), len(D)
    m = sum(map(sum, S)) / sum(map(sum, N))
    fixed = [[r[k:k + L] for k in range(0, len(r), L)] for r in runs]

    def rep_mean(wd):
        wb = [0] * nb
        for _ in range(nb):
            wb[rng.randrange(nb)] += 1
        num = den = 0.0
        for i in range(nb):
            if wb[i]:
                num += wb[i] * sum(w * x for w, x in zip(wd, S[i]))
                den += wb[i] * sum(w * x for w, x in zip(wd, N[i]))
        return num / den if den > 0 else None

    def sd(v):
        mu = sum(v) / len(v)
        return math.sqrt(sum((x - mu) ** 2 for x in v) / len(v))
    moving, nonover = [], []
    for _ in range(reps):
        wd = [0] * nd                                   # moving blocks: ceil(n / L) starts uniform on 0..n-L
        for r in runs:
            n = len(r)
            span = max(n - L + 1, 1)
            for _ in range(math.ceil(n / L)):
                s = rng.randrange(span)
                for k in r[s:s + L]:
                    wd[k] += 1
        v = rep_mean(wd)
        if v is not None:
            moving.append(v)
        wd = [0] * nd                                   # non-overlapping blocks: the run's own 5-day blocks
        for blocks in fixed:
            for _ in range(len(blocks)):
                for k in blocks[rng.randrange(len(blocks))]:
                    wd[k] += 1
        v = rep_mean(wd)
        if v is not None:
            nonover.append(v)
    vals = moving
    se_moving, se_nonoverlap = sd(moving), sd(nonover)
    se_boot = max(se_moving, se_nonoverlap)
    r1 = block_lag1(S, N, runs, L)
    infl = math.sqrt((1 + r1) / (1 - r1))
    se = se_boot * infl
    G = sum(math.ceil(len(r) / L) for r in runs)
    df = float(max(G - 1, 1))
    fac = G / (G - 1) if G > 1 else 1.0
    k = tw.t_quantile(1 - (1 - level) / 2, df) * math.sqrt(fac)
    return {"mean": m, "se": se, "se_bootstrap": se_boot, "se_moving": se_moving, "se_nonoverlap": se_nonoverlap,
            "block_lag1": r1, "inflation": infl, "df": df,
            "factor": fac, "storm_blocks": G, "storm_days": L,
            "ci": [m - k * se, m + k * se], "blocks": nb, "days": nd, "reps": len(vals)}


def storm_ci(items, reps=2000, seed=20261105, min_days=MIN_DAYS, L=STORM_DAYS):
    """The BINDING interval of the mean gain over gate items (moved stations only, as in eval_twoway.two_way_ci)."""
    moved = {i["buoy"] for i in items if i["f_cand"] != i["f_ref"]}
    untouched = sorted({i["buoy"] for i in items} - moved)
    items = [i for i in items if i["buoy"] in moved]
    blk = tw.item_blocks(items)
    cells = {}
    for i in items:
        c = cells.setdefault((blk[i["buoy"]], tw._day(i["t"])), [0.0, 0])
        c[0] += tw._gain(i)
        c[1] += 1
    days = sorted({d for _, d in cells})
    out = {"rule": f"spatial block x moving {L}-day storm block, >= {min_days} UTC days", "computable": False,
           "n": len(items), "days": len(days), "blocks": len(set(blk.values())), "mean": None, "ci": None,
           "untouched_stations": untouched, "stations_moved": sorted(moved)}
    if not items:
        out["reason"] = "no moved items"
        return out
    if len(days) < min_days:
        out["reason"] = f"{len(days)} UTC target days < {min_days}"
        return out
    r = _storm_cells_ci({k: tuple(v) for k, v in cells.items()}, reps, random.Random(seed), L)
    out.update(r, computable=True, reason="")
    return out


def p_one_sided(r, better=True):
    return rg.p_one_sided(r, better)


# ---- synthetic calibration: AR(1) storm-persistent nulls --------------------------------------------------------
def _ar1(n, rho, sd, rng):
    x, out = rng.gauss(0, sd), []
    for _ in range(n):
        out.append(x)
        x = rho * x + math.sqrt(1 - rho * rho) * rng.gauss(0, sd)
    return out


def synth_cells(blocks, runs, rows, comp, mu, rng):
    """{(block, day): (sum, n)} with mean mu + an AR(1) day shock shared by all blocks (sd, rho) + an AR(1) block x
    day shock (sd, rho) + row noise. comp = (sd_day, rho_day, sd_bd, rho_bd, sd_row)."""
    sd_a, rho_a, sd_bd, rho_bd, sd_e = comp
    cells = {}
    for run in runs:
        a = _ar1(len(run), rho_a, sd_a, rng)
        bd = {b: _ar1(len(run), rho_bd, sd_bd, rng) for b in blocks}
        for k, d in enumerate(run):
            for b in blocks:
                n = rows
                eff = mu + a[k] + bd[b][k]
                cells[(b, d)] = (n * eff + math.sqrt(n) * sd_e * rng.gauss(0, 1), n)
    return cells


# BINDING nulls: day-to-day persistence up to rho 0.6 (an e-folding of ~2 days: one 3-5 day swell event). ADVISORY:
# rho 0.8 (~9-day correlated stretches, longer than any 3-5 day block can carry; measured 2026-11-05 at L = 3, 4, 5:
# 7.5-17% false pass over 45-day runs). That is the stated LIMIT of a 3-5 day storm block, reported, not hidden.
CAL_NULLS = {"iid_day": (1.0, 0.0, 0.0, 0.0, 1.5), "storm_day_rho0.6": (1.0, 0.6, 0.0, 0.0, 1.5),
             "storm_block_x_day_rho0.6": (0.0, 0.0, 1.0, 0.6, 1.5), "mixed_rho0.6": (0.7, 0.6, 0.4, 0.6, 1.5)}
ADVISORY_NULLS = {"storm_day_rho0.8": (1.0, 0.8, 0.0, 0.0, 1.5), "storm_block_x_day_rho0.8": (0.0, 0.0, 1.0, 0.8, 1.5)}


def calibrate(layouts=None, n_sets=300, reps=200, seed=20261105):
    """False-pass rate on each null and power at 4 null SD, on the shortest admitted layouts (14 days, one run) and
    the scored shape (two 45-day runs + one 14-day run), 1 and 2 spatial blocks."""
    from datetime import date, timedelta

    def run_of(start, n):
        return [(start + timedelta(days=k)).isoformat() for k in range(n)]
    # (blocks, runs, rows per cell, power binding). False pass binds on EVERY layout; power binds on the protocol's
    # full fresh layout and is REPORTED on the 14-day one (3 storm blocks: low power can only make a PASS harder).
    layouts = layouts or {
        "14d_1block": (["b0"], [run_of(date(2026, 9, 22), 14)], 12, False),
        "fresh_2blocks": (["b0", "b1"], [run_of(date(2025, 1, 15), 45), run_of(date(2025, 11, 1), 45),
                                         run_of(date(2026, 9, 22), 14)], 12, True)}
    rng = random.Random(seed)
    out = {"n_sets": n_sets, "reps": reps, "seed": seed, "storm_days": STORM_DAYS, "layouts": {}}
    ok = True
    for name, lay in layouts.items():
        blocks, runs, rows = lay[:3]
        power_binding = lay[3] if len(lay) > 3 else True
        res = {"false_pass": {}, "advisory_nulls": {}}
        sd_mixed = None
        for nn, comp in list(CAL_NULLS.items()) + list(ADVISORY_NULLS.items()):
            fp, means = 0, []
            for _ in range(n_sets):
                r = _storm_cells_ci(synth_cells(blocks, runs, rows, comp, 0.0, rng), reps, rng)
                fp += r["ci"][0] > 0
                means.append(r["mean"])
            (res["false_pass"] if nn in CAL_NULLS else res["advisory_nulls"])[nn] = fp / n_sets
            if nn == "mixed_rho0.6":
                mu = sum(means) / len(means)
                sd_mixed = math.sqrt(sum((x - mu) ** 2 for x in means) / len(means))
        eff = 4.0 * sd_mixed
        hits = sum(_storm_cells_ci(synth_cells(blocks, runs, rows, CAL_NULLS["mixed_rho0.6"], eff, rng), reps,
                                   rng)["ci"][0] > 0 for _ in range(n_sets // 2))
        res["power"] = hits / (n_sets // 2)
        res["power_binding"] = power_binding
        fp_ok = max(res["false_pass"].values()) <= MAX_FALSE_PASS
        res["ok"] = fp_ok and (res["power"] >= MIN_POWER or not power_binding)
        ok = ok and res["ok"]
        out["layouts"][name] = res
    out["ok"] = ok
    return out


# ---- the gate ---------------------------------------------------------------------------------------------------
def _strata(its):
    """{name: items} for spot, lead band, observed-height band and season (moved stations only)."""
    out = {}
    for i in its:
        out.setdefault(f"spot={i['buoy']}", []).append(i)
        out.setdefault(f"lead={i['lead']}h", []).append(i)
        out.setdefault(f"season={i['season']}", []).append(i)
        for lo, hi, name in HEIGHT_BANDS:
            if lo <= i["obs"] < hi:
                out.setdefault(f"band={name}", []).append(i)
    return out


def _summ(r):
    return {"n": r["n"], "days": r["days"], "blocks": r["blocks"], "storm_blocks": r.get("storm_blocks"),
            "gain": None if r.get("mean") is None else round(r["mean"], 4),
            "ci": None if not r.get("ci") else [round(x, 4) for x in r["ci"]], "computable": r["computable"],
            "reason": r.get("reason", ""), "stations_moved": r.get("stations_moved"),
            "p_better": round(p_one_sided(r, True), 6) if r["computable"] else None,
            "p_worse": round(p_one_sided(r, False), 6) if r["computable"] else None}


def _bias(its):
    if not its:
        return {}
    n = len(its)
    return {"bias_ref": round(sum(i["f_ref"] - i["obs"] for i in its) / n, 4),
            "bias_cand": round(sum(i["f_cand"] - i["obs"] for i in its) / n, 4),
            "mae_ref": round(sum(abs(i["f_ref"] - i["obs"]) for i in its) / n, 4),
            "mae_cand": round(sum(abs(i["f_cand"] - i["obs"]) for i in its) / n, 4)}


def quantity_result(its, reps):
    moved_ids = {i["buoy"] for i in its if i["f_cand"] != i["f_ref"]}
    moved = [i for i in its if i["buoy"] in moved_ids]
    r = storm_ci(its, reps=reps)
    res = dict(_summ(r), n_all=len(its), **_bias(moved))
    strata = {}
    for name, sub in sorted(_strata(moved).items()):
        if all(i["f_cand"] == i["f_ref"] for i in sub):
            continue
        rs = storm_ci(sub, reps=max(500, reps // 2), min_days=min(MIN_DAYS, len({tw._day(i["t"]) for i in sub})))
        strata[name] = dict(_summ(rs), **_bias(sub))
    res["strata"] = strata
    per = {}
    for s in sorted({i["buoy"] for i in its}):
        sub = [i for i in its if i["buoy"] == s]
        per[s] = dict({"n": len(sub), "gain": round(sum(tw._gain(i) for i in sub) / len(sub), 4)}, **_bias(sub))
    res["per_station"] = per
    return res


def _fixed_storm_id(day, runs, L=STORM_DAYS):
    for ri, r in enumerate(runs):
        if day in r:
            return f"{ri}:{r.index(day) // L}"
    return day


def sign_flip_null(ref_moved_items, real_items, n_sets=NULL_SETS, reps=300, seed=7):
    """False-pass rate of the binding rule when each (spatial block, fixed storm block)'s gains of the REAL candidate
    pairs are sign-flipped at random (swap f_ref / f_cand): mean-zero by construction, the real dependence kept."""
    its = [i for i in real_items if i["buoy"] in {j["buoy"] for j in real_items if j["f_cand"] != j["f_ref"]}]
    if not its:
        return None
    blk = tw.item_blocks(its)
    runs = day_runs({tw._day(i["t"]) for i in its})
    keys = sorted({(blk[i["buoy"]], _fixed_storm_id(tw._day(i["t"]), runs)) for i in its})
    rng, fp, done = random.Random(seed), 0, 0
    for k in range(n_sets):
        flip = {key: rng.random() < 0.5 for key in keys}
        sw = [dict(i, f_ref=i["f_cand"], f_cand=i["f_ref"]) if flip[(blk[i["buoy"]], _fixed_storm_id(
            tw._day(i["t"]), runs))] else i for i in its]
        r = storm_ci(sw, reps=reps, seed=seed + k)
        if r["computable"]:
            done += 1
            fp += r["ci"][0] > 0
    return None if not done else {"sets": done, "false_pass": fp / done}


def controls(ref_items, cand_items, reps=1000):
    out = {}
    moved_ids = {i["buoy"] for i in cand_items if i["f_cand"] != i["f_ref"]}
    base = [i for i in ref_items if i["buoy"] in moved_ids]
    for name, fac in (("null_identical", 1.0), ("positive_0.8", 0.8), ("negative_1.25", 1.25)):
        rr = [dict(i, f_cand=i["f_ref"] if fac == 1.0 else i["obs"] + fac * (i["f_ref"] - i["obs"])) for i in base]
        r = storm_ci(rr, reps=reps)
        if fac == 1.0:
            v = "REFUSED" if not r["computable"] else "PASS" if r["ci"][0] > 0 else "FAIL"
        else:
            v = ("REFUSED" if not r["computable"] else "PASS" if r["ci"][0] > 0 else
                 "FAIL" if r["ci"][1] < 0 else "INCONCLUSIVE")
        out[name] = {"verdict": v, "ci": None if not r.get("ci") else [round(x, 4) for x in r["ci"]]}
    sf = sign_flip_null(base, cand_items)
    out["sign_flip_null"] = sf
    computable = storm_ci(cand_items, reps=50)["computable"]
    if not computable:
        return out, None              # nothing binding to control: the quantity is REFUSED anyway
    ok = (out["null_identical"]["verdict"] == "REFUSED" and out["positive_0.8"]["verdict"] == "PASS"
          and out["negative_1.25"]["verdict"] == "FAIL" and sf is not None and sf["false_pass"] <= MAX_FALSE_PASS)
    return out, ok


def verdict(res, rodeo):
    """The pre-registered decision (see the module doc). Returns (verdict, reasons)."""
    reasons = []
    if not res["calibration"]["ok"]:
        return "INVALID", ["synthetic calibration failed"]
    for q in ("hs_station", "hb_proxy"):
        if res["controls"][q]["ok"] is False:
            return "INVALID", [f"{q} controls failed"]
    hs, hb = res["quantities"]["hs_station"], res["quantities"]["hb_proxy"]
    if not hs["computable"]:
        return "REFUSED", [f"hs_station not computable: {hs['reason']}"]
    if not hs["ci"][0] > 0:
        reasons.append(f"hs_station gain {hs['gain']} CI {hs['ci']} does not exclude 0")
    if hb["computable"] and hb["p_worse"] < ALPHA:
        reasons.append(f"hb_proxy pooled worse (p_worse {hb['p_worse']})")
    if res["holm_worse"]:
        reasons.append("worse after Holm: " + ", ".join(res["holm_worse"]))
    rc = res.get("rodeo")
    if rc and rc.get("p_worse") is not None and rc["p_worse"] < ALPHA:
        reasons.append(f"Rodeo ({rodeo}) hb_proxy worse, unadjusted p_worse {rc['p_worse']}")
    return ("FAIL" if reasons else "PASS"), reasons


def run(wins, ref, arm, stations_path, reps=2000, rodeo="142p1", calibration=None):
    stations = {s["id"]: s for s in json.load(open(stations_path, encoding="utf-8"))["stations"]}
    pooled, ref_pool, meta = {}, {}, {}
    for tag, path in wins:
        truth, rows, emb = rg.load_window(path)
        meta[tag] = {"rows": len(rows["served"]), "arms": sorted(rows)}
        if arm not in rows:
            raise SystemExit(f"{path}: no replay_{arm}.json")
        for q in ("hs_station", "hb_proxy"):
            ref_pool.setdefault(q, []).extend(rg.items(q, rows[ref], rows[ref], truth, stations, emb, tag))
            pooled.setdefault(q, []).extend(rg.items(q, rows[ref], rows[arm], truth, stations, emb, tag))
    out = {"schema": "raw-surf.rework-storm-gate.v1", "protocol": PROTOCOL, "storm_days": STORM_DAYS,
           "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "windows": dict(wins),
           "window_meta": meta, "ref": ref, "arm": arm, "rodeo_station": rodeo, "quantities": {}, "controls": {}}
    out["calibration"] = calibration if calibration is not None else calibrate()
    harm = []
    for q in ("hs_station", "hb_proxy"):
        qr = quantity_result(pooled[q], reps)
        out["quantities"][q] = qr
        c, ok = controls(ref_pool[q], pooled[q])
        out["controls"][q] = {"cases": c, "ok": ok}
        for name, s in qr["strata"].items():
            if s["computable"]:
                harm.append((f"{q}:{name}", s["p_worse"]))
    out["holm_worse"] = rg.holm(harm, ALPHA)
    out["rodeo"] = out["quantities"]["hb_proxy"]["strata"].get(f"spot={rodeo}")
    out["verdict"], out["reasons"] = verdict(out, rodeo)
    return out


def markdown(res):
    L = [f"## Storm-block gate ({res['protocol']}, moving {res['storm_days']}-day blocks) - `{res['arm']}` vs "
         f"`{res['ref']}`: **{res['verdict']}**", ""]
    L += ["| quantity | stratum | n | days | storm blocks | gain m | 95% CI | p worse | bias ref -> cand |",
          "|---|---|---|---|---|---|---|---|---|"]
    for q, qr in res["quantities"].items():
        rows = [("pooled", qr)] + sorted(qr["strata"].items())
        for name, s in rows:
            L.append(f"| {q} | {name} | {s['n']} | {s['days']} | {s.get('storm_blocks')} | {s['gain']} | {s['ci']} | "
                     f"{s['p_worse']} | {s.get('bias_ref')} -> {s.get('bias_cand')} |")
    L += ["", "Reasons: " + ("; ".join(res["reasons"]) or "none"), "",
          "Controls: " + "; ".join(f"{q}: {'ok' if c['ok'] else ('n/a' if c['ok'] is None else 'FAILED')} "
                                   f"({json.dumps(c['cases'])})" for q, c in res["controls"].items()),
          "", "Calibration: " + json.dumps(res["calibration"].get("layouts")) + f" ok={res['calibration'].get('ok')}"]
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--win", action="append", required=True, help="TAG=harness_out_dir; repeatable")
    ap.add_argument("--ref", default="served")
    ap.add_argument("--arm", required=True, help="replay file slug (replay_<slug>.json)")
    ap.add_argument("--stations", required=True)
    ap.add_argument("--rodeo", default="142p1")
    ap.add_argument("--reps", type=int, default=2000)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run([tuple(w.split("=", 1)) for w in a.win], a.ref, a.arm, a.stations, a.reps, a.rodeo)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, indent=1, default=str)
    md = markdown(res)
    with open(os.path.splitext(a.out)[0] + ".md", "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    print(md)
    print("GATE_JSON_BEGIN")
    print(json.dumps(res, default=str))
    print("GATE_JSON_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
