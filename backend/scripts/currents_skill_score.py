"""currents_skill_score.py - the ONE look of the currents-skill-v1 registration (section 8). Serves nothing. Reads a local
copy of the archived evidence (every archive verified by its SHA256SUMS first), scores TEST once, writes one report JSON.

  python scripts/currents_skill_score.py --evidence DIR --freeze-time 2026-12-01T15:04:05Z --out report.json \
      [--absent RTOFS_025] [--first-line freeze_record.json]

Evidence: every archive (calibration/currents-skill/<run>-<attempt>/) downloaded under one directory. Inside each, the
collector's trees: .../frames/<ARM>/<run YYYYMMDDTHHMMSSZ>/fHHH.bin, .../native/<run>/<region>.npz,
.../hfr/<stamp>/hfr_<region>_<stamp>.npz, .../drifters/<stamp>/*.nc, each tree with its MANIFEST.json; found recursively.

Built here: arms (served frames, native 1/12, PERSIST_<src>), per-arm pairing and the missing-run rule, M1 / M2 rows, the
F-M1 / F-M2 families with Holm per arm (better, worse, equivalence), BETTER / COMPARABLE / WORSE / NOT SHOWN, G3 skill
against PERSIST_<src>, floors and VOID rules, all controls, the 3- and 10-day block sensitivity, STILL, 24 h separation,
Liu-Weisberg skill, beaching counts, drogue split, speed ME, signed direction error, unfiltered M1. NOT built (reported-only
items, listed in the report's `not_built`): PERSIST_OBS, CMEMS_1H, SMOC, complex correlation, D0 RMSE, the HFRNet 25 h
product cross-check, the European radar totals.
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import numpy as np

import currents_skill_arms as A
import currents_skill_collect as C
import currents_skill_controls as K
import currents_skill_geo as G
import currents_skill_metrics as M
import currents_skill_stats as S
import currents_skill_truth as T

GATED_ARMS = ("GIOPS_025", "RTOFS_025", "CMEMS_083")
SERVED = ("CMEMS_025", "GIOPS_025", "RTOFS_025")
GATED_REGIONS = ("uswc", "usegc", "ushi")
REPORTED_REGIONS = ("usprvi",)
SCORED_STEPS = tuple(range(A.FIRST_STEP_H, 169, 6))       # "every step to 168 h" (section 2) from the 6 h step
NOT_BUILT = ["PERSIST_OBS", "CMEMS_1H", "SMOC", "complex correlation", "D0 analysis RMSE",
             "HFRNet 25 h RTV cross-check", "European HF radar totals (INSITU radar subset)"]


def test_inits(freeze: datetime, n=S.TEST_INITS) -> List[datetime]:
    first = freeze.replace(hour=0, minute=0, second=0, microsecond=0)
    if first < freeze:
        first += timedelta(days=1)
    return [first + timedelta(days=k) for k in range(n)]


def epoch_h(dt: datetime) -> int:
    return int(dt.timestamp() // 3600)


def stamp(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%SZ")


def load_init_arms(evidence, init: datetime, absent=()):
    """({arm: ArmField or region dict}, {arm: drop cause}) for one init. An arm is complete only with every scored step."""
    arms, causes = {}, {}
    for arm in SERVED:
        if arm in absent:
            causes[arm] = "ABSENT"
            continue
        frames = C.load_arm_frames(evidence, arm, stamp(init))
        missing = [h for h in SCORED_STEPS if h not in frames]
        if missing:
            causes[arm] = f"missing steps {missing[:4]}{'...' if len(missing) > 4 else ''}" if frames else "no run saved"
            continue
        try:
            arms[arm] = A.ArmField.from_frames(arm, frames, last_h=max(frames))
        except ValueError as e:
            causes[arm] = f"undecodable: {e}"
    if "CMEMS_083" not in absent:
        regs = {}
        for reg in C.NATIVE_REGIONS:
            p = C.find_native(evidence, stamp(init), reg)
            if p:
                f = A.ArmField.from_native_npz("CMEMS_083", p)
                if all(np.isclose(f.steps_h, h).any() for h in SCORED_STEPS):
                    regs[reg] = f
        if len(regs) == len(C.NATIVE_REGIONS):
            arms["CMEMS_083"] = regs
        else:
            causes["CMEMS_083"] = f"native subset for {sorted(regs)} only"
    else:
        causes["CMEMS_083"] = "ABSENT"
    return arms, causes


def pairing(per_init_causes: Dict[int, Dict[str, str]]):
    """Section 2: an init with CMEMS_025 incomplete drops for all arms; else an arm keeps the inits where it is complete."""
    kept = {a: [] for a in ("CMEMS_025",) + GATED_ARMS}
    dropped = {a: {} for a in kept}
    for k, causes in sorted(per_init_causes.items()):
        if "CMEMS_025" in causes:
            for a in kept:
                dropped[a][k] = f"CMEMS_025 {causes['CMEMS_025']}"
            continue
        kept["CMEMS_025"].append(k)
        for a in GATED_ARMS:
            if a in causes:
                dropped[a][k] = causes[a]
            else:
                kept[a].append(k)
    return kept, dropped


def regional(arms, region):
    """The arms valid in a radar region: the global served arms, CMEMS_083's subset of that region, and every PERSIST."""
    out = {}
    for a, f in arms.items():
        if a == "CMEMS_083":
            if region in f:
                out[a] = f[region]
        else:
            out[a] = f
    for a in list(out):
        out[f"PERSIST_{a}"] = A.persistence(out[a])
    return out


def score(evidence, freeze: datetime, absent=(), B=S.B_DEFAULT, bathy=None, verify=None, log=print):
    inits = test_inits(freeze)
    ih = [epoch_h(t) for t in inits]
    report = {"registration": "docs/weather-program/gates/currents-skill-v1.md", "freeze": freeze.isoformat(),
              "inits": [t.isoformat() for t in inits], "absent": list(absent), "B": B, "not_built": NOT_BUILT}
    # ---- arms and pairing -------------------------------------------------------------------------------------------
    per_init, causes = {}, {}
    for k, t in enumerate(inits):
        per_init[k], causes[k] = load_init_arms(evidence, t, absent)
    kept, dropped = pairing(causes)
    report["pairing"] = {a: {"kept": len(kept[a]), "dropped": {str(k): c for k, c in dropped[a].items()}} for a in kept}
    run_void = S.run_void(S.TEST_INITS - len(kept["CMEMS_025"]))
    arm_void = {a: S.arm_void(len(kept[a])) for a in GATED_ARMS if a not in absent}
    gated = [a for a in GATED_ARMS if a not in absent and not arm_void[a]]
    report["void"] = {"run": run_void, "arms": arm_void}
    all_names = ["CMEMS_025", *GATED_ARMS, *[f"PERSIST_{a}" for a in ("CMEMS_025",) + GATED_ARMS]]
    rot = {f"{K.PLANT_ARM}_rot{d:g}": (K.PLANT_ARM, d) for d in K.DIR_PLANTS.values()}
    # ---- M1 ---------------------------------------------------------------------------------------------------------
    m1, shuffled, cells_by_region = {}, {}, {}
    test_hours = np.arange(ih[0] - A.HALF_WINDOW_H, ih[-1] + 181)
    for region in GATED_REGIONS + REPORTED_REGIONS:
        truth = T.load_region(region, evidence)
        if truth is None:
            cells_by_region[region] = 0
            continue
        cells = T.qualifying_cells(truth, test_hours)
        cells_by_region[region] = int(cells.size)
        batches, sbatches = [], []
        for k in kept["CMEMS_025"]:
            arms = {a: f for a, f in per_init[k].items() if a == "CMEMS_025" or k in kept.get(a, [])}
            ra = regional(arms, region)
            names = all_names + list(rot)
            batches.append(M.m1_rows(truth, cells, ih[k], k, ra, rotations=rot, all_arms=names))
            sh = {a: f for a, f in ra.items() if a in gated or a in [f"PERSIST_{g}" for g in gated]}
            if sh:
                sbatches.append(M.m1_rows(truth, cells, ih[k], k, sh, lead_days=(1,), obs_shift_h=168, all_arms=names))
        for lead, col in M.flatten_m1(batches, all_names + list(rot), region).items():
            m1[(region, lead)] = col
        for lead, col in M.flatten_m1(sbatches, all_names, region).items():
            shuffled[(region, lead)] = col
    report["cells"] = cells_by_region
    # ---- M2 ---------------------------------------------------------------------------------------------------------
    tracks = T.load_tracks(evidence)
    m2 = []
    for k in kept["CMEMS_025"]:
        arms = {a: f for a, f in per_init[k].items() if a == "CMEMS_025" or k in kept.get(a, [])}
        flat = {a: f for a, f in arms.items() if a != "CMEMS_083"}
        for a in list(flat):
            flat[f"PERSIST_{a}"] = A.persistence(flat[a])
        for f in K.LAG_PLANTS.values():
            flat[f"CMEMS_025_x{f:g}"] = A.scaled(arms["CMEMS_025"], f)
        rows = M.m2_rows(tracks, ih[k], flat, bathy=bathy)
        if "CMEMS_083" in arms:                        # native subsets: each drifter uses the box it starts in (else missing)
            for reg, fld in arms["CMEMS_083"].items():
                for r, r2 in zip(rows, M.m2_rows(tracks, ih[k], {"CMEMS_083": fld, "PERSIST_CMEMS_083": A.persistence(fld)},
                                                 bathy=None)):
                    for key in ("sep_km", "sep24_km", "lw_skill", "beached", "stalled"):
                        for a in ("CMEMS_083", "PERSIST_CMEMS_083"):
                            if r2[key].get(a) is not None and r[key].get(a) is None:
                                r[key][a] = r2[key][a]
        for r in rows:
            r["init_index"] = k
        m2 += rows
    report["drifter_inits"] = len(m2)
    report["m1"], report["m2"] = lines_m1(m1, kept, gated, cells_by_region, B), lines_m2(m2, kept, gated, B)
    report["reported"] = reported(m1, m2, B)
    # ---- controls ---------------------------------------------------------------------------------------------------
    regions_floor = [r for r in GATED_REGIONS if cells_by_region.get(r, 0) >= S.FLOOR_CELLS]
    zones_floor = [z for z in G.ZONES if sum(1 for r in m2 if r["zone"] == z) >= S.FLOOR_DRIFTER_INITS]
    controls = [K.null_control(m1, m2, B), K.shuffled_control(shuffled, gated, regions_floor, B),
                K.speed_control(m1, B=B), K.direction_control(m1, B=B), K.lagrangian_control(m2, zones_floor, B),
                K.leak_freeze(evidence, [ih[k] for k in range(len(inits))], freeze.timestamp() / 3600, verify)]
    report["controls"] = controls
    report["void"]["controls"] = K.verdict(controls)
    report["verdict"] = ("VOID" if run_void or report["void"]["controls"] else "SCORED")
    return report


def lines_m1(m1, kept, gated, cells, B):
    out = {}
    for arm in gated:
        fam, skill = {}, {}
        for region in GATED_REGIONS:
            for lead in M.LEAD_DAYS:
                col = m1.get((region, lead))
                key = f"{region}/D{lead}"
                if col is None:
                    fam[key] = skill[key] = {"insufficient": True, "floors": ["no truth"]}
                    continue
                ea, eb, ep = M.err2(col, arm), M.err2(col, "CMEMS_025"), M.err2(col, f"PERSIST_{arm}")
                line = S.paired_line(col["date"], ea, eb, "rmse", B=B)
                miss = S.floors(len(kept[arm]), {f"D{lead}": line.get("dates", 0)}, cells.get(region, 0), S.FLOOR_CELLS)
                line.update(insufficient=bool(miss), floors=miss, missing_rows=col["missing"].get(arm, 0),
                            halves=S.halves_ok(col["date"], col["init_index"], ea, eb, "rmse"),
                            sensitivity={f"{b}d": S.paired_line(col["date"], ea, eb, "rmse", B=B, block=b)["diff_ci"]
                                         for b in S.SENSITIVITY_BLOCKS} if line.get("dates") else {})
                fam[key] = line
                sk = S.paired_line(col["date"], ea, ep, "rmse", B=B)
                skill[key] = dict(sk, insufficient=bool(miss))
        out[arm] = {"labels": S.label_family(fam), "skill_G3": S.skill_family(skill)}
    return out


def lines_m2(m2, kept, gated, B):
    out = {}
    val = lambda r, a: np.nan if r["sep_km"].get(a) is None else r["sep_km"][a]
    for arm in gated:
        fam, skill = {}, {}
        for zone in G.ZONES:
            rows = [r for r in m2 if r["zone"] == zone]
            d = [(r["init_h"] + M.M2_HOURS) // 24 for r in rows]
            ii = [r["init_index"] for r in rows]
            a, b, p = (np.array([val(r, x) for r in rows]) for x in (arm, "CMEMS_025", f"PERSIST_{arm}"))
            n_units = int((np.isfinite(a) & np.isfinite(b)).sum())
            if not rows:
                fam[zone] = skill[zone] = {"insufficient": True, "floors": ["no drifter-inits"]}
                continue
            line = S.paired_line(d, a, b, "mean", B=B)
            miss = S.floors(len(kept[arm]), {"72h": line.get("dates", 0)}, n_units, S.FLOOR_DRIFTER_INITS)
            line.update(insufficient=bool(miss), floors=miss, halves=S.halves_ok(d, ii, a, b, "mean"),
                        still_km=float(np.mean([r["still_km"] for r in rows])),
                        beached={x: int(sum(1 for r in rows if r["beached"].get(x))) for x in (arm, "CMEMS_025")})
            fam[zone] = line
            skill[zone] = dict(S.paired_line(d, a, p, "mean", B=B), insufficient=bool(miss))
        out[arm] = {"labels": S.label_family(fam), "skill_G3": S.skill_family(skill)}
    return out


def reported(m1, m2, B):
    rep = {"m1": {}, "m2": {}}
    for (region, lead), col in m1.items():
        r = {}
        for arm in col["fc"]:
            if arm.startswith(("PERSIST_", K.PLANT_ARM + "_rot")):
                continue
            e = M.err2(col, arm)
            if not np.isfinite(e).any():
                continue
            se = M.speed_err(col, arm)
            de = M.signed_dir_err(col, arm)
            r[arm] = {"rmse": float(np.sqrt(np.nanmean(e))), "rmse_unfiltered": float(np.sqrt(np.nanmean(M.err2(col, arm, raw=True)))),
                      "speed_me": float(np.nanmean(se)), "dir_err_mean": float(np.nanmean(de)) if np.isfinite(de).any() else None,
                      "rows": int(np.isfinite(e).sum())}
        rep["m1"][f"{region}/D{lead}"] = r
    for zone in G.ZONES:
        rows = [x for x in m2 if x["zone"] == zone]
        z = {"drifter_inits": len(rows), "still_km": float(np.mean([x["still_km"] for x in rows])) if rows else None,
             "drogue": {d: sum(1 for x in rows if x["drogue"] == d) for d in ("drogued", "undrogued", "unknown")}}
        for arm in sorted({a for x in rows for a in x["sep_km"]}):
            v = [x["sep_km"][arm] for x in rows if x["sep_km"].get(arm) is not None]
            v24 = [x["sep24_km"][arm] for x in rows if x["sep24_km"].get(arm) is not None]
            lw = [x["lw_skill"][arm] for x in rows if x["lw_skill"].get(arm) is not None]
            z[arm] = {"sep_km": float(np.mean(v)) if v else None, "sep24_km": float(np.mean(v24)) if v24 else None,
                      "lw_skill": float(np.mean(lw)) if lw else None, "beached": sum(1 for x in rows if x["beached"].get(arm))}
        rep["m2"][zone] = z
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--freeze-time", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--absent", action="append", default=[], choices=list(GATED_ARMS))
    ap.add_argument("--first-line", default="", help="JSON of the facts read at freeze (section 9), copied verbatim")
    ap.add_argument("--B", type=int, default=S.B_DEFAULT)
    a = ap.parse_args(argv)
    freeze = datetime.fromisoformat(a.freeze_time.replace("Z", "+00:00")).astimezone(timezone.utc)
    try:
        import currents_skill_archive as AR
        verify = AR.verify
    except ImportError:  # pragma: no cover
        verify = None
    rep = score(a.evidence, freeze, tuple(a.absent), a.B, G.Bathy.from_repo_asset(), verify)
    if a.first_line:
        rep = {"first_line": json.load(open(a.first_line, encoding="utf-8")), **rep}
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=1, sort_keys=False, default=str)
    print(f"verdict {rep['verdict']}; report written (first reader: the advisor, section 8)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
