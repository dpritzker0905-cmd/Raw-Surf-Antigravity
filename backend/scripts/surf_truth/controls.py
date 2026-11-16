"""The registered controls (#989 controls + amendment 2 I) and the leak check. A failed control makes the run VOID."""
from __future__ import annotations

import math

import numpy as np

from .prep import FT, cell_key

SYN_KEY = "SYN+30"
SYN_REPORTS = 40
SYN_BIAS = math.log(1.3)
SYN_NOISE = 0.15


def shuffle_within_role(rows: list[dict], seed: int = 20261116) -> list[dict]:
    """Negative control input: observer (and device) identities permuted within role; entries untouched."""
    rng = np.random.default_rng(seed)
    out = [dict(r) for r in rows]
    by_role: dict = {}
    for i, r in enumerate(out):
        by_role.setdefault((r.get("observer_role"), r.get("anchor_status_at_obs")), []).append(i)
    for idx in by_role.values():
        perm = rng.permutation(idx)
        ids = [(rows[i]["observer_key"], rows[i].get("device_key")) for i in perm]
        for i, (ok, dk) in zip(idx, ids):
            out[i]["observer_key"], out[i]["device_key"] = ok, dk
    return out


def add_synthetic_observer(rows: list[dict], fit, seed: int = 20261116) -> list[dict]:
    """Positive control input: exactly 40 reports by one synthetic observer at +30% (log-noise 0.15) on real fit cells,
    generated from the fitted anchor-scale height of each cell."""
    rng = np.random.default_rng(seed)
    d = fit.design
    u_med = np.median(fit.samples["log_TP"], axis=0)
    cell_rows: dict = {}
    for r in rows:
        cell_rows.setdefault(cell_key(r)[:2], r)
    keys = list(cell_rows)
    if len(keys) < SYN_REPORTS:
        raise ValueError("fewer fit cells than the registered 40 synthetic reports")
    out = list(rows)
    for n, k in enumerate(rng.choice(len(keys), size=SYN_REPORTS, replace=False)):
        template = cell_rows[keys[k]]
        u = u_med[d.cell_index[keys[k]]]
        y = math.exp(u + SYN_BIAS + rng.normal(0, SYN_NOISE))
        out.append({**template, "row_key": f"syn-control-{n}", "observer_key": SYN_KEY, "device_key": SYN_KEY,
                    "observer_role": "surfer", "anchor_status_at_obs": None, "height_value": round(y / FT, 1),
                    "height_unit": "ft", "height_bucket": None, "height_scale": "face", "set_or_avg": "sets",
                    "flags": []})
    return out


def positive_ok(fit_with_syn) -> dict:
    j = fit_with_syn.design.obs_index[SYN_KEY]
    col = fit_with_syn.samples["b"][:, j]
    lo, hi = np.percentile(col, [2.5, 97.5])
    return {"b_ci95": [float(lo), float(hi)], "excludes_0": bool(lo > 0 or hi < 0),
            "contains_log_1_3": bool(lo <= SYN_BIAS <= hi),
            "P_unchanged": "vacuous: P is prior-only without physical rows",
            "ok": bool((lo > 0 or hi < 0) and lo <= SYN_BIAS <= hi)}


def leak_check(fit_rows: list[dict], holdout_cells: list) -> dict:
    """#989: NO row of a held-out SPOT, and no anchor target of a held-out anchor cell, may be in the fit input."""
    from .prep import spot_held_out
    fit_keys = {r["row_key"] for r in fit_rows}
    forbidden = set()
    for c in holdout_cells:
        if spot_held_out(c.spot_id):
            forbidden.update(r["row_key"] for r in c.rows)
        else:
            forbidden.update(r["row_key"] for r in c.rows if r.get("anchor_status_at_obs") == "active")
    leaked = fit_keys & forbidden
    return {"fit_rows": len(fit_keys), "forbidden_rows": len(forbidden), "leaked": len(leaked), "ok": not leaked}
