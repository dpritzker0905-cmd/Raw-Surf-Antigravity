"""currents_skill_controls.py - the controls of the currents-skill-v1 registration (section 7). Serves nothing. Pure except
`leak_freeze`, which reads the evidence directory. ANY control that misbehaves makes the run VOID; a control that cannot be
evaluated (its region or zone below the floor) is reported "not evaluable" and voids nothing.

  null        CMEMS_025 against itself: exactly 0 on every line (diff and its CI).
  shuffled    each gated arm's D1 forecast paired with truth 7 days later: its advantage over PERSIST_<src> must vanish
              (the CI of arm minus persistence includes 0 or is positive) in every region with a floor.
  speed       +0.05 (1x) / +0.10 m/s (2x) along the plant arm's forecast vector on all rows: the speed-ME difference must catch 2x
              (CI excludes 0 and contains 0.10); 1x reported.
  direction   the plant arm's step vectors rotated +30 (1x) / +60 deg (2x) on the same random 15% of rows before the
              low-pass: at 2x the signed direction error AND the M1 vector RMSE must both rise (CIs exclude 0).
  The plant arm (amendment 1, A10): GIOPS_025 if it has rows, else CMEMS_083, else CMEMS_025 against its own unplanted self.
  lagrangian  CMEMS_025 scaled 0.7 (1x) / 0.5 (2x): M2 significantly worse at 2x in OPEN and WBC; 1x reported.
  leak/freeze every archive's SHA256SUMS and every collector MANIFEST.json match the files; no TEST valid time precedes the
              freeze commit.
"""
import glob
import hashlib
import json
import os
from typing import Dict, List, Optional

import numpy as np

import currents_skill_metrics as M
import currents_skill_stats as S

SPEED_PLANTS = {"1x": 0.05, "2x": 0.10}
DIR_PLANTS = {"1x": 30.0, "2x": 60.0}
LAG_PLANTS = {"1x": 0.7, "2x": 0.5}
PLANT_ARM = "GIOPS_025"
BASE = "CMEMS_025"


def null_control(m1_cols: Dict, m2_rows: List[dict], B=S.B_DEFAULT) -> dict:
    bad = []
    for (region, lead), col in m1_cols.items():
        e = M.err2(col, BASE)
        line = S.paired_line(col["date"], e, e, "rmse", B=B)
        if line.get("dates") and not (line["diff"] == 0 and line["diff_ci"] == [0.0, 0.0]):
            bad.append(f"M1 {region} D{lead}: {line['diff']} {line['diff_ci']}")
    sep = [r["sep_km"].get(BASE) for r in m2_rows]
    dates = [r.get("valid_h", r["init_h"]) // 24 for r in m2_rows]
    vals = np.array([np.nan if x is None else x for x in sep], float)
    if np.isfinite(vals).any():
        line = S.paired_line(dates, vals, vals, "mean", B=B)
        if not (line["diff"] == 0 and line["diff_ci"] == [0.0, 0.0]):
            bad.append(f"M2: {line['diff']} {line['diff_ci']}")
    return {"control": "null", "ok": not bad, "detail": bad}


def shuffled_control(shuffled_cols: Dict, gated: List[str], regions_with_floor: List[str], B=S.B_DEFAULT) -> dict:
    """`shuffled_cols` {(region, 1): column} from m1_rows(obs_shift_h=168, lead_days=(1,)) with each arm and its PERSIST."""
    out, bad = {}, []
    for arm in gated:
        for region in regions_with_floor:
            col = shuffled_cols.get((region, 1))
            if col is None or arm not in col["fc"]:
                out[f"{arm}/{region}"] = "not evaluable"
                continue
            line = S.paired_line(col["date"], M.err2(col, arm), M.err2(col, f"PERSIST_{arm}"), "rmse", B=B)
            if not line.get("dates"):
                out[f"{arm}/{region}"] = "not evaluable"
                continue
            ok = line["diff_ci"][1] >= 0                     # CI of arm minus persistence includes 0 or is positive
            out[f"{arm}/{region}"] = {"diff": line["diff"], "diff_ci": line["diff_ci"], "ok": ok}
            if not ok:
                bad.append(f"{arm}/{region} still beats persistence against truth 7 days later: pairing leaks")
    return {"control": "shuffled", "ok": not bad, "detail": out, "problems": bad}


def _pooled(m1_cols, fn):
    dates, vals = [], []
    for col in m1_cols.values():
        v = fn(col)
        if v is None:
            continue
        dates.append(col["date"])
        vals.append(v)
    if not dates:
        return np.zeros(0), np.zeros(0)
    return np.concatenate(dates), np.concatenate(vals)


def speed_control(m1_cols: Dict, arm=PLANT_ARM, B=S.B_DEFAULT) -> dict:
    res = {}
    for k, ms in SPEED_PLANTS.items():
        d, v = _pooled(m1_cols, lambda c: (M.speed_err(c, arm, ms) - M.speed_err(c, arm)) if arm in c["fc"] else None)
        if not np.isfinite(v).any():
            res[k] = "not evaluable"
            continue
        mean, ci = S.mean_ci(d, v, B=B)
        res[k] = {"planted": ms, "mean": mean, "ci": ci, "caught": S.ci_excludes_zero(ci) and S.ci_contains(ci, ms, 1e-6)}
    two = res.get("2x")
    ok = two == "not evaluable" or (isinstance(two, dict) and two["caught"])
    return {"control": "speed", "ok": ok if two != "not evaluable" else None, "detail": res}


def direction_control(m1_cols: Dict, arm=PLANT_ARM, B=S.B_DEFAULT) -> dict:
    """`m1_cols` carry the rotated arms f"{arm}_rot{deg:g}" (m1_rows rotations)."""
    res = {}
    for k, deg in DIR_PLANTS.items():
        name = f"{arm}_rot{deg:g}"

        def ddiff(c):
            if name not in c["fc"] or arm not in c["fc"]:
                return None
            a, b = M.signed_dir_err(dict(c), name), M.signed_dir_err(dict(c), arm)
            return (a - b + 180.0) % 360.0 - 180.0
        d, v = _pooled(m1_cols, ddiff)
        if not np.isfinite(v).any():
            res[k] = "not evaluable"
            continue
        mean, ci = S.mean_ci(d, v, B=B)
        d2, e_p = _pooled(m1_cols, lambda c: M.err2(c, name) if name in c["fc"] else None)
        _d3, e_b = _pooled(m1_cols, lambda c: M.err2(c, arm) if name in c["fc"] else None)
        rm = S.paired_line(d2, e_p, e_b, "rmse", B=B)
        res[k] = {"planted_deg": deg, "dir_mean": mean, "dir_ci": ci, "rmse_diff": rm.get("diff"), "rmse_ci": rm.get("diff_ci"),
                  "caught": S.ci_excludes_zero(ci) and rm.get("dates", 0) > 0 and S.ci_excludes_zero(rm["diff_ci"])}
    two = res.get("2x")
    if two == "not evaluable" or two is None:
        return {"control": "direction", "ok": None, "detail": res}
    return {"control": "direction", "ok": two["caught"], "detail": res}


def lagrangian_control(m2_rows: List[dict], zones_with_floor: List[str], B=S.B_DEFAULT) -> dict:
    res, bad = {}, []
    for zone in ("OPEN", "WBC"):
        rows = [r for r in m2_rows if r["zone"] == zone]
        for k, f in LAG_PLANTS.items():
            name = f"{BASE}_x{f:g}"
            if zone not in zones_with_floor or not rows:
                res[f"{zone}/{k}"] = "not evaluable"
                continue
            a = np.array([np.nan if r["sep_km"].get(name) is None else r["sep_km"][name] for r in rows])
            b = np.array([np.nan if r["sep_km"].get(BASE) is None else r["sep_km"][BASE] for r in rows])
            line = S.paired_line([r.get("valid_h", r["init_h"]) // 24 for r in rows], a, b, "mean", B=B)
            caught = line.get("dates", 0) > 0 and line["p_worse"] < S.ALPHA_ONE_SIDED
            res[f"{zone}/{k}"] = {"diff_km": line.get("diff"), "diff_ci": line.get("diff_ci"), "p_worse": line.get("p_worse"),
                                  "caught": caught}
            if k == "2x" and not caught:
                bad.append(f"{zone}: M2 not significantly worse at velocity x{f:g}")
    evaluable = any(isinstance(v, dict) for k, v in res.items() if k.endswith("2x"))
    return {"control": "lagrangian", "ok": (not bad) if evaluable else None, "detail": res, "problems": bad}


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def leak_freeze(evidence_dir: str, init_hours: List[int], freeze_h: float, verify=None) -> dict:
    """Every archive (a directory holding SHA256SUMS) verifies; every MANIFEST.json's files match their sha256; no TEST
    init (hence no valid time) precedes the freeze."""
    bad = []
    if verify is not None:
        for sums in glob.glob(os.path.join(evidence_dir, "**", "SHA256SUMS"), recursive=True):
            bad += [f"{os.path.dirname(sums)}: {p}" for p in verify(os.path.dirname(sums))]
    for man in glob.glob(os.path.join(evidence_dir, "**", "MANIFEST.json"), recursive=True):
        root = os.path.dirname(man)
        for f in json.load(open(man, encoding="utf-8")).get("files", []):
            p = os.path.join(root, *f["path"].split("/"))
            if not os.path.exists(p):
                bad.append(f"missing {f['path']} (listed in {man})")
            elif _sha(p) != f["sha256"]:
                bad.append(f"sha256 differs {f['path']}")
    early = [h for h in init_hours if h < freeze_h]
    if early:
        bad.append(f"{len(early)} TEST inits precede the freeze")
    return {"control": "leak_freeze", "ok": not bad, "detail": bad[:50], "problems": len(bad)}


def verdict(controls: List[dict]) -> Optional[str]:
    """None when every evaluable control behaved; else the VOID reason."""
    bad = [c["control"] for c in controls if c.get("ok") is False]
    return f"VOID: control(s) misbehaved: {', '.join(bad)}" if bad else None
