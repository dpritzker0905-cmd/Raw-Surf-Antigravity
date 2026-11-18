"""wave_l1_score.py - the L1 gate (probabilistic offshore Hs at the 19-buoy panel). Offline; serves nothing; fetches
nothing. Registration: docs/weather-program/log/2026-11-15-senior-research-lead-sota-plan.md, L1 draft + amendments
1 and 2 (amendment 2 governs), FIXED 2026-11-17 00:33 EST. ONE scored look at TEST: any change after it is a new
registration on new data.

Input: a row table (npz), one row per SCHEDULED (init, lead, buoy) in the fit and test periods, written by the
collector whether or not the buoy reported (y = NaN when it did not), so a cell's expected count is its row count:
  valid, init, published (datetime64[h]; published = init + the product's measured publication delay), lead_h (int),
  buoy, basin (str: pacific | atlantic_gulf | hawaii), y (buoy Hs, m), gefs (n, 31) and ecmwf (n, 50) member Hs (m),
  r1 (deterministic proxy Hs, m: mean of GFS-Wave det and ECMWF det wave, labelled "proxy, ICON absent").
Plus the buoys' pre-TEST observation history (arm C) and the model-upgrade dates (amendment 2, "Versions").

Gate (all must hold; a line that passes on 10-day blocks and fails on 3-day blocks, or the reverse, is FRAGILE):
  G1 raw pooled CRPSS(E2 vs R2) over 48-240 h >= 0.05 with the 95% CI lower bound > 0;
  G2 no 24-h lead bin in 48-240 h significantly worse than R2 (CI upper >= 0);
  G3 pooled 80% central-interval coverage in [0.75, 0.85]; per basin the block-bootstrap CI includes 0.80;
  G4 no basin's CRPSS is negative.
VOID (the result is not read as PASS or FAIL):
  - a buoy-lead cell with < 90% of its rows scorable is excluded and counted; > 20% of cells excluded is VOID;
  - null: CRPSS(R2 vs R2) must be exactly 0 with a zero-width CI;
  - buoy derangement: E2 forecasts paired with the wrong buoy's observation (same valid time and lead, buoys cycled
    by one) must score CRPSS < 0 against arm C at the true buoy. [Instrument reading of "the CRPS skill must collapse
    below 0"; the reference is named here for the advisor to confirm before any fetch.]
  - positive control: E2 with its spread HALVED must fail G3's pooled coverage AND score a higher CRPS than E2.
Reported (not gating): E1, R1 (CRPS = MAE), C, the frozen-TRAIN fit, the mean of per-buoy skill and each buoy's CRPSS
with CI (amendment 1c), per-model arms, the shuffled-spread E2 (within buoy and lead bin) and the spread-term CRPSS
(fitted vs constant spread, amendment 1a), which together decide the SHIPPED form; week 2 (240-360 h) Brier skill for
Hs above the buoy's pre-TEST 90th percentile.
"""
import argparse
import json
import os
import sys
from typing import Dict, Optional

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wave_emos_core as W  # noqa: E402
from emos_core import crps_ensemble  # noqa: E402

TEST_START = np.datetime64("2026-01-01T00", "h")
TEST_END = np.datetime64("2026-07-01T00", "h")                 # exclusive
HELD_OUT_WEEKS = (np.datetime64("2026-03-15T00", "h"), np.datetime64("2026-06-15T00", "h"))
GATE_LEADS = (48, 240)
THRESH_CRPSS = 0.05
COVER_BAND = (0.75, 0.85)
CELL_MIN_FRAC, CELLS_VOID_FRAC = 0.90, 0.20
BLOCK_DAYS, BLOCK_DAYS_ALT = 10, 3
N_BOOT, SEED = 2000, 20261117
BASINS = ("pacific", "atlantic_gulf", "hawaii")


def test_window_mask(valid) -> np.ndarray:
    v = np.asarray(valid, "datetime64[h]")
    m = (v >= TEST_START) & (v < TEST_END)
    for w in HELD_OUT_WEEKS:
        m &= ~((v >= w) & (v < w + np.timedelta64(7 * 24, "h")))
    return m


def block_ids(valid, days: int) -> np.ndarray:
    return ((np.asarray(valid, "datetime64[h]") - TEST_START).astype(int) // (24 * days)).astype(int)


def _boot_counts(n_blocks: int, seed: int = SEED, n_boot: int = N_BOOT) -> np.ndarray:
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n_blocks, size=(n_boot, n_blocks))
    return np.stack([np.bincount(r, minlength=n_blocks) for r in idx]).astype(float)


def crpss(crps_f, crps_ref, blocks, mask=None, days=BLOCK_DAYS) -> Dict:
    """Raw pooled CRPSS = 1 - sum CRPS_f / sum CRPS_ref, with a 95% block-bootstrap CI (blocks of whole valid dates:
    every buoy, lead and basin in a block go together)."""
    m = np.isfinite(crps_f) & np.isfinite(crps_ref) & (True if mask is None else mask)
    if not m.any():
        return {"crpss": None, "ci": None, "n": 0}
    b = blocks[m]
    ub, inv = np.unique(b, return_inverse=True)
    sf = np.bincount(inv, weights=crps_f[m], minlength=len(ub))
    sr = np.bincount(inv, weights=crps_ref[m], minlength=len(ub))
    C = _boot_counts(len(ub), SEED + days)
    with np.errstate(divide="ignore", invalid="ignore"):
        boot = 1.0 - (C @ sf) / (C @ sr)
    boot = boot[np.isfinite(boot)]
    return {"crpss": float(1.0 - sf.sum() / sr.sum()), "ci": [float(np.percentile(boot, 2.5)),
            float(np.percentile(boot, 97.5))], "n": int(m.sum()), "blocks": int(len(ub))}


def coverage(hit, blocks, mask=None, days=BLOCK_DAYS) -> Dict:
    m = np.isfinite(hit) & (True if mask is None else mask)
    if not m.any():
        return {"coverage": None, "ci": None, "n": 0}
    ub, inv = np.unique(blocks[m], return_inverse=True)
    h = np.bincount(inv, weights=hit[m], minlength=len(ub))
    n = np.bincount(inv, minlength=len(ub)).astype(float)
    C = _boot_counts(len(ub), SEED + 100 + days)
    boot = (C @ h) / (C @ n)
    return {"coverage": float(h.sum() / n.sum()), "ci": [float(np.percentile(boot, 2.5)),
            float(np.percentile(boot, 97.5))], "n": int(m.sum())}


def central_hit(mu, sigma, y, level=0.80) -> np.ndarray:
    lo = W.quantile_lognormal(mu, sigma, 0.5 - level / 2)
    hi = W.quantile_lognormal(mu, sigma, 0.5 + level / 2)
    out = ((y >= lo) & (y <= hi)).astype(float)
    return np.where(np.isfinite(mu) & np.isfinite(y), out, np.nan)


def derange_index(valid, lead_h, buoy) -> np.ndarray:
    """For each row, the index of the row at the same valid time and lead whose buoy is next in sorted order (cycled
    by one: no row keeps its own buoy). -1 where the group has a single buoy."""
    n = len(buoy)
    out = np.full(n, -1)
    key = np.char.add(np.char.add(np.asarray(valid).astype(str), "|"), np.asarray(lead_h).astype(str))
    order = np.lexsort((np.asarray(buoy), key))
    ks = key[order]
    starts = np.flatnonzero(np.r_[True, ks[1:] != ks[:-1]])
    ends = np.r_[starts[1:], n]
    for s, e in zip(starts, ends):
        if e - s >= 2:
            g = order[s:e]
            out[g] = np.roll(g, -1)
    return out


def shuffle_within(sd, buoy, lbin, seed=SEED) -> np.ndarray:
    """The reported shuffled-spread feature: sd permuted within each (buoy, lead bin)."""
    rng = np.random.default_rng(seed)
    out = np.array(sd, dtype=float)
    key = np.char.add(np.asarray(buoy).astype(str), np.char.add("|", np.asarray(lbin).astype(str)))
    for k in np.unique(key):
        idx = np.flatnonzero(key == k)
        out[idx] = out[rng.permutation(idx)]
    return out


def _both(crps_f, crps_ref, valid, mask):
    a = crpss(crps_f, crps_ref, block_ids(valid, BLOCK_DAYS), mask, BLOCK_DAYS)
    b = crpss(crps_f, crps_ref, block_ids(valid, BLOCK_DAYS_ALT), mask, BLOCK_DAYS_ALT)
    return a, b


def _line(name, a, b, test):
    pa, pb = (test(x) if x["crpss"] is not None else False for x in (a, b))
    return {"line": name, "blocks10": a, "blocks3": b, "pass": bool(pa), "fragile": bool(pa != pb)}


def score(T: Dict[str, np.ndarray], hist: Dict, upgrades=(), refit_first=None) -> Dict:
    valid = np.asarray(T["valid"], "datetime64[h]")
    published = np.asarray(T["published"], "datetime64[h]")
    lead = np.asarray(T["lead_h"], dtype=int)
    buoy, basin = np.asarray(T["buoy"]).astype(str), np.asarray(T["basin"]).astype(str)
    y = np.asarray(T["y"], dtype=float)
    lbin = W.lead_bin(lead)
    f = W.ens_features(T["gefs"], T["ecmwf"])
    f["lr1"] = W.safe_log(T["r1"])
    test = test_window_mask(valid)
    gate_rows = test & (lead >= GATE_LEADS[0]) & (lead <= GATE_LEADS[1])
    refits = W.refit_times(refit_first or (TEST_START - np.timedelta64(24 * 24, "h")), TEST_END)

    mu_e, sg_e = W.rolling_predict("E2", f, y, valid, published, lbin, refits, test, upgrades)
    mu_r, sg_r = W.rolling_predict("R2", f, y, valid, published, lbin, refits, test, upgrades)
    scorable = np.isfinite(y) & np.isfinite(mu_e) & np.isfinite(mu_r)

    # cell exclusion (G-coverage): a buoy x lead-bin cell with < 90% scorable rows is excluded; > 20% excluded = VOID
    cells, excluded = {}, []
    for b_ in np.unique(buoy[gate_rows]):
        for lb in np.unique(lbin[gate_rows]):
            c = gate_rows & (buoy == b_) & (lbin == lb)
            frac = float(scorable[c].mean()) if c.any() else 0.0
            cells[f"{b_}|{lb}"] = frac
            if frac < CELL_MIN_FRAC:
                excluded.append(f"{b_}|{lb}")
    keep = scorable.copy()
    for k in excluded:
        b_, lb = k.split("|")
        keep &= ~((buoy == b_) & (lbin == int(lb)))
    G = gate_rows & keep

    ce = W.crps_lognormal(mu_e, sg_e, y)
    cr = W.crps_lognormal(mu_r, sg_r, y)
    void = []
    if len(cells) and len(excluded) / len(cells) > CELLS_VOID_FRAC:
        void.append(f"{len(excluded)}/{len(cells)} buoy-lead cells below {CELL_MIN_FRAC:.0%} scorable")

    lines = {}
    a, b = _both(ce, cr, valid, G)
    lines["G1_pooled"] = _line("G1", a, b, lambda x: x["crpss"] >= THRESH_CRPSS and x["ci"][0] > 0)
    g2 = {}
    for lb in sorted(np.unique(lbin[G])):
        a, b = _both(ce, cr, valid, G & (lbin == lb))
        g2[int(lb)] = _line(f"G2_{lb}", a, b, lambda x: x["ci"][1] >= 0)
    lines["G2_by_lead"] = g2
    hit = central_hit(mu_e, sg_e, y)
    cov_a = coverage(hit, block_ids(valid, BLOCK_DAYS), G, BLOCK_DAYS)
    cov_b = coverage(hit, block_ids(valid, BLOCK_DAYS_ALT), G, BLOCK_DAYS_ALT)
    in_band = (lambda x: x["coverage"] is not None and COVER_BAND[0] <= x["coverage"] <= COVER_BAND[1])
    g3 = {"pooled": {"blocks10": cov_a, "blocks3": cov_b, "pass": bool(in_band(cov_a)),
                     "fragile": bool(in_band(cov_a) != in_band(cov_b))}}
    g4 = {}
    for bs in BASINS:
        mb = G & (basin == bs)
        ca = coverage(hit, block_ids(valid, BLOCK_DAYS), mb, BLOCK_DAYS)
        cb = coverage(hit, block_ids(valid, BLOCK_DAYS_ALT), mb, BLOCK_DAYS_ALT)
        inc = (lambda x: x["ci"] is not None and x["ci"][0] <= 0.80 <= x["ci"][1])
        g3[bs] = {"blocks10": ca, "blocks3": cb, "pass": bool(inc(ca)), "fragile": bool(inc(ca) != inc(cb))}
        a, b = _both(ce, cr, valid, mb)
        g4[bs] = _line(f"G4_{bs}", a, b, lambda x: x["crpss"] >= 0)
    lines["G3_coverage"], lines["G4_basins"] = g3, g4

    # ---- VOID controls
    blk = block_ids(valid, BLOCK_DAYS)
    null = crpss(cr, cr, blk, G)
    if not (null["crpss"] == 0.0 and null["ci"] == [0.0, 0.0]):
        void.append(f"null control: R2 vs R2 gave {null['crpss']} {null['ci']}")
    clim = W.climatology_samples(hist, buoy, valid)
    cc = np.full(len(y), np.nan)
    for i in np.flatnonzero(G):
        if clim[i].size >= 10:
            cc[i] = float(crps_ensemble(clim[i][:, None], np.array([y[i]]))[0])
    j = derange_index(valid, lead, buoy)
    ok = j >= 0
    cd = np.full(len(y), np.nan)
    cd[ok] = W.crps_lognormal(mu_e[j[ok]], sg_e[j[ok]], y[ok])
    der = crpss(cd, cc, blk, G & ok)
    if der["crpss"] is None or der["crpss"] >= 0:
        void.append(f"buoy derangement did not collapse: CRPSS vs C {der['crpss']}")
    half = W.crps_lognormal(mu_e, 0.5 * sg_e, y)
    cov_half = coverage(central_hit(mu_e, 0.5 * sg_e, y), blk, G)
    pos_ok = (not in_band(cov_half)) and np.nansum(half[G]) > np.nansum(ce[G])
    if not pos_ok:
        void.append(f"positive control (halved spread) not detected: coverage {cov_half['coverage']}")

    # ---- reported
    rep = {"C_vs_R2": crpss(cc, cr, blk, G), "E2_vs_C": crpss(ce, cc, blk, G),
           "R1_mae_m": float(np.nanmean(np.abs(np.asarray(T["r1"], float) - y)[G])) if G.any() else None,
           "R1_label": "proxy, ICON absent (mean of GFS-Wave det and ECMWF det wave)"}
    w = np.r_[np.full(np.shape(T["gefs"])[1], 0.5 / np.shape(T["gefs"])[1]),
              np.full(np.shape(T["ecmwf"])[1], 0.5 / np.shape(T["ecmwf"])[1])]
    c1 = np.full(len(y), np.nan)
    c1[G] = W.crps_weighted_ensemble(np.hstack([T["gefs"], T["ecmwf"]])[G], w, y[G])
    rep["E1_vs_R2"] = crpss(c1, cr, blk, G)
    mu_c, sg_c = W.rolling_predict("E2", f, y, valid, published, lbin, refits, test, upgrades, spread="constant")
    rep["spread_term_fitted_vs_constant"] = crpss(ce, W.crps_lognormal(mu_c, sg_c, y), blk, G)
    mu_s, sg_s = W.rolling_predict("E2", f, y, valid, published, lbin, refits, test, upgrades,
                                   sd_override=shuffle_within(f["sd"], buoy, lbin))
    shuf = crpss(W.crps_lognormal(mu_s, sg_s, y), cr, blk, G)
    rep["E2_shuffled_spread_vs_R2"] = shuf
    gain = lines["G1_pooled"]["blocks10"]["crpss"]
    survives = (gain is not None and shuf["crpss"] is not None and gain > 0 and shuf["crpss"] >= 0.5 * gain)
    st = rep["spread_term_fitted_vs_constant"]
    rep["shipped_form"] = ("constant_spread" if survives or st["ci"] is None or st["ci"][0] <= 0
                           else "fitted_spread")
    for name, models in (("E2_gefs_only_vs_R2", ("g",)), ("E2_ecmwf_only_vs_R2", ("e",))):
        mm, ss = W.rolling_predict("E2", f, y, valid, published, lbin, refits, test, upgrades, models=models)
        rep[name] = crpss(W.crps_lognormal(mm, ss, y), cr, blk, G)
    wk2 = test & (lead > 240) & (lead <= 360) & np.isfinite(y) & np.isfinite(mu_e) & np.isfinite(mu_r)
    p90 = {b_: float(np.percentile(hist[b_][1], 90)) for b_ in np.unique(buoy[wk2]) if len(hist.get(b_, ((), ()))[1])}
    thr = np.array([p90.get(b_, np.nan) for b_ in buoy])
    wk2 &= np.isfinite(thr)
    if wk2.any():
        o = (y[wk2] > thr[wk2]).astype(float)
        be = np.mean((W.exceed_lognormal(mu_e[wk2], sg_e[wk2], thr[wk2]) - o) ** 2)
        br = np.mean((W.exceed_lognormal(mu_r[wk2], sg_r[wk2], thr[wk2]) - o) ** 2)
        rep["week2_brier_skill_p90_E2_vs_R2"] = {"bss": float(1 - be / br) if br > 0 else None, "n": int(wk2.sum()),
                                                  "base_rate": float(o.mean())}
    per = {}
    for b_ in np.unique(buoy[G]):
        per[str(b_)] = crpss(ce, cr, blk, G & (buoy == b_))
    rep["per_buoy"] = per
    vals = [v["crpss"] for v in per.values() if v["crpss"] is not None]
    rep["mean_per_buoy_crpss"] = float(np.mean(vals)) if vals else None
    rep["controls"] = {"null": null, "derangement_vs_C": der,
                       "halved_spread": {"coverage": cov_half, "crps_worse": bool(np.nansum(half[G]) > np.nansum(ce[G]))}}

    passed = (lines["G1_pooled"]["pass"] and all(v["pass"] for v in g2.values())
              and all(v["pass"] for v in g3.values()) and all(v["pass"] for v in g4.values()))
    verdict = "VOID" if void else ("PASS" if passed else "FAIL")
    if verdict == "PASS" and survives:
        verdict = "PASS (mean correction only; ships constant spread)"
    return {"verdict": verdict, "void_reasons": void, "lines": lines, "reported": rep,
            "size": {"rows_test_gate": int(gate_rows.sum()), "rows_scored": int(G.sum()),
                     "cells": len(cells), "cells_excluded": excluded,
                     "test_days": int(len(np.unique(valid[G].astype("datetime64[D]")))),
                     "blocks10": lines["G1_pooled"]["blocks10"].get("blocks")},
            "upgrades": [str(u) for u in upgrades]}


def load_table(path: str) -> Dict[str, np.ndarray]:
    with np.load(path, allow_pickle=False) as z:
        return {k: z[k] for k in z.files}


def load_hist(path: Optional[str]) -> Dict:
    if not path:
        return {}
    z = load_table(path)
    return {b: (z["t"][z["buoy"] == b], z["y"][z["buoy"] == b]) for b in np.unique(z["buoy"])}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--table", required=True)
    ap.add_argument("--hist", required=True, help="pre-TEST buoy history npz: buoy, t, y (arm C)")
    ap.add_argument("--upgrades", default="[]", help="JSON list of model-upgrade datetimes (amendment 2)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    r = score(load_table(a.table), load_hist(a.hist), [np.datetime64(u, "h") for u in json.loads(a.upgrades)])
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(r, fh, indent=1, default=str)
    print(f"L1 verdict: {r['verdict']}; void: {r['void_reasons']}; size: {r['size']['rows_scored']} rows, "
          f"{r['size']['test_days']} days")


if __name__ == "__main__":
    main()
