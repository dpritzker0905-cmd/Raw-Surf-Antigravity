"""The registered scorer for CHAIN / LITE / MOP / OFFSHORE (gate sections 3, 6, 7). Pure numpy, no I/O.

Rows (one per init x lead x buoy): dict(date 'YYYY-MM-DD', buoy, region, sheltered bool, stratum 'FINE'|'COARSE',
obs_hs, inc_rel_deg (|incoming - shore normal|), arms {name: hs_m or None}). The truth is the observed Hs.

  * paired moving-block bootstrap over dates, 7-day blocks, B = 10,000, seed 20261122
  * Holm over each family; one-sided "better"
  * California TOST on r = RMSE(LITE_EC)/RMSE(MOP) - 1 at +/-10%
  * controls: null, height plants, direction plants, bathymetry swap (reported), leak
"""
import math

import numpy as np

from . import coefficients as coef

SEED = 20261122
B_DEFAULT = 10000
BLOCK_DAYS = 7
TOST_MARGIN = 0.10
DIR_BINS = ((0, 30), (30, 60), (60, 90), (90, 181))
FLOORS = {"inits": 75, "blocks": 10, "buoys": 25, "buoys_per_region": 4, "buoys_sheltered": 6, "ca_buoys": 3}


# ---- primitives ------------------------------------------------------------------------------------------------
def _by_date(rows, arm, truth="obs_hs"):
    """date -> (sum sq err, n, sum err) over rows where both arm and truth exist."""
    out = {}
    for r in rows:
        a, t = r["arms"].get(arm), r.get(truth)
        if a is None or t is None or not (math.isfinite(a) and math.isfinite(t)):
            continue
        s = out.setdefault(r["date"], [0.0, 0, 0.0])
        e = a - t
        s[0] += e * e
        s[1] += 1
        s[2] += e
    return out


def _paired(rows, a, b):
    """Only rows where BOTH arms and the truth exist (missing-run rule: the same rows for every arm)."""
    return [r for r in rows if r["arms"].get(a) is not None and r["arms"].get(b) is not None
            and r.get("obs_hs") is not None]


def rmse(rows, arm):
    d = _by_date(rows, arm)
    n = sum(v[1] for v in d.values())
    return math.sqrt(sum(v[0] for v in d.values()) / n) if n else float("nan")


def mean_error(rows, arm):
    d = _by_date(rows, arm)
    n = sum(v[1] for v in d.values())
    return sum(v[2] for v in d.values()) / n if n else float("nan")


def block_indices(n_dates, block, B, rng):
    """Circular moving-block resample of date indices, shape (B, n_dates)."""
    nb = int(math.ceil(n_dates / block))
    starts = rng.integers(0, n_dates, size=(B, nb))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]) % n_dates
    return idx.reshape(B, nb * block)[:, :n_dates]


def paired_bootstrap(rows, a, b, metric="rmse", block=BLOCK_DAYS, B=B_DEFAULT, seed=SEED):
    """delta = metric(a) - metric(b) (negative = a better for rmse). Resamples WHOLE dates with every buoy together.
    Returns dict(delta, lo, hi, p_better = P(delta >= 0 under the bootstrap) one-sided, n_dates, n)."""
    rows = _paired(rows, a, b)
    da, db = _by_date(rows, a), _by_date(rows, b)
    dates = sorted(da)
    if len(dates) < 2:
        return {"delta": float("nan"), "lo": float("nan"), "hi": float("nan"), "p": 1.0, "n_dates": len(dates), "n": 0}
    sa = np.array([da[d][0] if metric == "rmse" else da[d][2] for d in dates])
    sb = np.array([db[d][0] if metric == "rmse" else db[d][2] for d in dates])
    n = np.array([da[d][1] for d in dates], dtype=float)
    rng = np.random.default_rng(seed)
    idx = block_indices(len(dates), block, B, rng)
    N = n[idx].sum(axis=1)
    if metric == "rmse":
        ma, mb = np.sqrt(sa[idx].sum(axis=1) / N), np.sqrt(sb[idx].sum(axis=1) / N)
        base = math.sqrt(sa.sum() / n.sum()) - math.sqrt(sb.sum() / n.sum())
    else:
        ma, mb = sa[idx].sum(axis=1) / N, sb[idx].sum(axis=1) / N
        base = sa.sum() / n.sum() - sb.sum() / n.sum()
    diff = ma - mb
    return {"delta": float(base), "lo": float(np.percentile(diff, 2.5)), "hi": float(np.percentile(diff, 97.5)),
            "p": float((np.sum(diff >= 0) + 1) / (B + 1)), "n_dates": len(dates), "n": int(n.sum())}


def holm(pvals):
    """Holm step-down adjusted p-values (same order as input)."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    adj = [0.0] * m
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * pvals[i]))
        adj[i] = running
    return adj


def tost_ratio(rows, a="LITE_EC", b="MOP", margin=TOST_MARGIN, block=BLOCK_DAYS, B=B_DEFAULT, seed=SEED):
    """r = RMSE(a)/RMSE(b) - 1; equivalent when the 90% CI (two one-sided 5% tests) lies inside +/-margin."""
    rows = _paired(rows, a, b)
    da, db = _by_date(rows, a), _by_date(rows, b)
    dates = sorted(da)
    if len(dates) < 2:
        return {"r": float("nan"), "lo": float("nan"), "hi": float("nan"), "equivalent": False, "worse": False}
    sa = np.array([da[d][0] for d in dates])
    sb = np.array([db[d][0] for d in dates])
    n = np.array([da[d][1] for d in dates], dtype=float)
    idx = block_indices(len(dates), block, B, np.random.default_rng(seed))
    N = n[idx].sum(axis=1)
    rr = np.sqrt(sa[idx].sum(axis=1) / N) / np.sqrt(sb[idx].sum(axis=1) / N) - 1.0
    r0 = math.sqrt(sa.sum() / n.sum()) / math.sqrt(sb.sum() / n.sum()) - 1.0
    lo, hi = float(np.percentile(rr, 5)), float(np.percentile(rr, 95))
    return {"r": float(r0), "lo": lo, "hi": hi, "equivalent": bool(lo > -margin and hi < margin),
            "worse": bool(lo > margin)}


# ---- strata and direction bins ---------------------------------------------------------------------------------
def _sel(rows, **kw):
    out = rows
    for k, v in kw.items():
        out = [r for r in out if r.get(k) == v]
    return out


def dir_bin(deg):
    for i, (lo, hi) in enumerate(DIR_BINS):
        if lo <= deg < hi:
            return i
    return len(DIR_BINS) - 1


def floors(rows, regions_gated):
    dates = sorted({r["date"] for r in rows})
    buoys = {r["buoy"] for r in rows}
    per_region = {g: len({r["buoy"] for r in rows if r["region"] == g}) for g in regions_gated}
    sheltered = len({r["buoy"] for r in rows if r.get("sheltered")})
    ca = len({r["buoy"] for r in rows if r["region"] == "California" and r["arms"].get("MOP") is not None})
    res = {"inits": len(dates), "blocks": len(dates) // BLOCK_DAYS, "buoys": len(buoys),
           "per_region": per_region, "sheltered": sheltered, "ca": ca}
    res["ok"] = (res["inits"] >= FLOORS["inits"] and res["blocks"] >= FLOORS["blocks"]
                 and res["buoys"] >= FLOORS["buoys"] and sheltered >= FLOORS["buoys_sheltered"]
                 and all(v >= FLOORS["buoys_per_region"] for v in per_region.values()))
    res["ca_run"] = res["ca"] >= FLOORS["ca_buoys"]
    return res


def evaluate_f1(rows, regions, B=B_DEFAULT, seed=SEED):
    """F1: LITE - CHAIN on M1 per region (California excluded) + pooled + sheltered + FINE + COARSE; Holm, one-sided."""
    non_ca = [r for r in rows if r["region"] != "California"]
    lines = {f"region:{g}": _sel(non_ca, region=g) for g in regions}
    lines["pooled"] = non_ca
    lines["sheltered"] = [r for r in non_ca if r.get("sheltered")]
    lines["FINE"] = _sel(non_ca, stratum="FINE")
    for tag in SHIP_TAGS:                      # COARSE, SEAM, DATUM_1M: a line only when the tag has targets
        sel = [r for r in non_ca if tag in row_tags(r)]
        if sel:
            lines[tag] = sel
    res = {k: paired_bootstrap(v, "LITE", "CHAIN", B=B, seed=seed) for k, v in lines.items()}
    keys = list(res)
    adj = holm([res[k]["p"] for k in keys])
    for k, a in zip(keys, adj):
        res[k]["p_holm"] = a
    # the worse-direction lines form their own family
    worse = {k: paired_bootstrap(v, "CHAIN", "LITE", B=B, seed=seed) for k, v in lines.items()}
    wadj = holm([worse[k]["p"] for k in keys])
    for k, a in zip(keys, wadj):
        res[k]["p_holm_worse"] = a
    return res


def halves(rows):
    """First and last half of the dates (45/45 for 90 inits)."""
    dates = sorted({r["date"] for r in rows})
    h = len(dates) // 2
    first, last = set(dates[:h]), set(dates[len(dates) - h:])
    return [r for r in rows if r["date"] in first], [r for r in rows if r["date"] in last]


def pass_rule(rows, regions, alpha=0.05, B=B_DEFAULT, seed=SEED):
    """Section 6 pass: pooled + FINE + sheltered better, no region Holm-worse, same sign and >= half the pooled effect
    in both halves. COARSE ships only if its own line is also better (reported as `coarse_ships`)."""
    f1 = evaluate_f1(rows, regions, B=B, seed=seed)
    non_ca = [r for r in rows if r["region"] != "California"]
    h1, h2 = halves(non_ca)
    d1 = paired_bootstrap(h1, "LITE", "CHAIN", B=B, seed=seed)["delta"]
    d2 = paired_bootstrap(h2, "LITE", "CHAIN", B=B, seed=seed)["delta"]
    pooled = f1["pooled"]["delta"]
    both_halves = bool(pooled < 0 and d1 < 0 and d2 < 0 and abs(d1) >= 0.5 * abs(pooled) and abs(d2) >= 0.5 * abs(pooled))
    better = lambda k: bool(f1[k]["p_holm"] < alpha and f1[k]["delta"] < 0)           # noqa: E731
    no_region_worse = all(f1[f"region:{g}"]["p_holm_worse"] >= alpha for g in regions)
    ok = better("pooled") and better("FINE") and better("sheltered") and no_region_worse and both_halves
    return {"pass": bool(ok), "pooled": better("pooled"), "FINE": better("FINE"), "sheltered": better("sheltered"),
            "no_region_worse": no_region_worse, "both_halves": both_halves, "half_deltas": [d1, d2],
            "coarse_ships": bool(better("COARSE")) if "COARSE" in f1 else False, "f1": f1}


# ---- ship decision: stratified tags (advisor ruling 2026-11-22) -------------------------------------------------
# SEAM and DATUM_1M targets are computed and SCORED as registered (stratify only: no source swap, no exclusion).
# At SHIP time LITE applies to a tagged target only if that stratum's own line is also BETTER; a multi-tagged target
# needs EVERY tag's line better. COARSE is the same rule (gate section 6). ONE switch point: `tag_rule`.
SHIP_TAGS = ("COARSE", "SEAM", "DATUM_1M")


def row_tags(row):
    """All stratum tags of a row: its COARSE stratum plus any extra tags (SEAM, DATUM_1M)."""
    tags = set(row.get("tags") or [])
    if row.get("stratum") == "COARSE":
        tags.add("COARSE")
    return tags


def tag_rule(target_tags, better_by_tag):
    """THE SWITCH POINT. A target ships iff every one of its tags has a line that is also better."""
    return all(bool(better_by_tag.get(t, False)) for t in target_tags if t in SHIP_TAGS)


def ship_decision(rows, regions, alpha=0.05, B=B_DEFAULT, seed=SEED):
    """{gate_pass, better, ships: {target: bool}}. The tag lines live in the F1 Holm family (a line exists only when
    the tag has targets). Untagged targets ship on a gate pass; a tagged target ships only if EVERY tag's line is
    BETTER (merely not worse = CHAIN); a gate that does not pass ships nothing."""
    gate = pass_rule(rows, regions, alpha=alpha, B=B, seed=seed)
    f1 = gate["f1"]
    better = {t: bool(f1[t]["p_holm"] < alpha and f1[t]["delta"] < 0) for t in SHIP_TAGS if t in f1}
    tags_by_target = {}
    for r in rows:
        tags_by_target.setdefault(r["buoy"], set()).update(row_tags(r))
    ships = {t: bool(gate["pass"] and tag_rule(tags, better)) for t, tags in tags_by_target.items()}
    return {"gate_pass": gate["pass"], "better": better, "ships": ships, "gate": gate}


# ---- controls --------------------------------------------------------------------------------------------------
def control_null(rows):
    """CHAIN - CHAIN must be exactly 0."""
    r = paired_bootstrap(rows, "CHAIN", "CHAIN", B=200)
    return abs(r["delta"]) == 0.0 and r["lo"] == 0.0 and r["hi"] == 0.0


def plant_height(rows, arm, factor):
    """Rows with `arm` scaled (the +10% / +20% plants)."""
    out = []
    for r in rows:
        arms = dict(r["arms"])
        if arms.get(arm) is not None:
            arms[f"{arm}_x{factor}"] = arms[arm] * factor
        out.append({**r, "arms": arms})
    return out


def control_height_plants(rows, arm="LITE", B=B_DEFAULT):
    """The ME test must catch the 2x plant (+20%): its ME CI vs the unplanted arm excludes 0."""
    p = plant_height(rows, arm, 1.20)
    r = paired_bootstrap(p, f"{arm}_x1.2", arm, metric="me", B=B)
    return {"caught_2x": bool(r["lo"] > 0 or r["hi"] < 0), "delta_me": r["delta"]}


def control_direction_plants(base_rows, plant2_rows, B=B_DEFAULT):
    """Sheltered subset: LITE with every direction rotated +40 deg must be significantly WORSE than unrotated.
    `plant2_rows` carry the rotated arm as `LITE_ROT40` (computed by the caller through the frozen tables)."""
    sh = [r for r in base_rows if r.get("sheltered")]
    by_key = {(r["date"], r["buoy"], r.get("lead_h")): r for r in plant2_rows}
    merged = []
    for r in sh:
        q = by_key.get((r["date"], r["buoy"], r.get("lead_h")))
        if q is not None and q["arms"].get("LITE_ROT40") is not None:
            merged.append({**r, "arms": {**r["arms"], "LITE_ROT40": q["arms"]["LITE_ROT40"]}})
    res = paired_bootstrap(merged, "LITE_ROT40", "LITE", B=B)
    return {"direction_aware": bool(res["lo"] > 0), "delta_rmse": res["delta"], "n": res["n"]}


def control_leak(coef_dir, target_ids, freeze_time_utc, valid_times_utc):
    """Hashes match and no TEST valid time precedes the freeze. Raises CoefficientHashMismatch on a bad hash."""
    for t in target_ids:
        coef.load_verified(coef_dir, t)
    return all(v >= freeze_time_utc for v in valid_times_utc)


def verify_frozen_or_refuse(coef_dir, target_ids):
    """Called before any scoring: a hash mismatch refuses to run (raises)."""
    return {t: coef.load_verified(coef_dir, t) for t in target_ids}


def verdict(floor_result, controls):
    """The result text. VOID is printed EXPLICITLY (advisor A8): a floor unmet or any control misbehaving voids the run.
    `controls` = {name: bool ok}. Returns (is_void, text)."""
    reasons = []
    if not floor_result.get("ok"):
        reasons.append(f"floors unmet {floor_result}")
    reasons += [f"control '{k}' misbehaved" for k, ok in controls.items() if not ok]
    if reasons:
        return True, "VOID: " + "; ".join(reasons)
    return False, "VALID: floors met and every control behaved"
