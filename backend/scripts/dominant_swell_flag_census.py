"""dominant_swell_flag_census.py -- what does WAVES_ANIM_DOMINANT_SWELL change? (census, no served change)

THE FLAG (services/weather_pipeline/normalizer.py ~167-181): at INGEST, the TOTAL waves layer takes its direction (and
u/v) from the dominant swell partition wherever that partition holds >= WAVES_ANIM_SWELL_MIN_FRAC (0.35) of the energy
(height^2 ratio). Height stays total. The point resolver samples the same grids, so the rating's `swell_from` changes
with it (audit ING-5). Code default '0'; the repo variable has read '1' since 2026-07-13.

INPUT: the .npz written by dominant_swell_fetch_fields.py (raw GFS-Wave fields, 12 variables, a few forecast hours).
The stored products cannot serve as the baseline: their `waves` direction was already stamped (bucket also private).

WHAT IT MEASURES (all offline, no Raw Surf backend, no Supabase):
  A. PRODUCT LEVEL, through the REAL normalizer, flag off then on, over the same raw points: regional 0.25 deg boxes
     and the 2 deg world grid. Reports the coherence-gate diagnostics (swellAvailFrac, swellStampSuppressed), how many
     cells changed direction, and the angle difference. Also checks the vectorised stamp used in B/C against it.
  B. RATING CENSUS through the REAL chain (sim_rating.calculate_surf_rating -> estimate_surf_at -> rating_score):
     every catalogue spot, every forecast hour, four wind scenarios stated relative to the spot's shore normal.
     Counts spot-hours whose score / level change, and by how much. Rows with an unchanged direction are not re-rated
     (identical inputs, identical output); a control re-rates a sample of them to prove that.
  C. LAYER-OPPOSITION TEST for the owner's report of "opposing wave animations in all marine layers": angle between the
     waves layer (flag on / off) and the wind-wave, swell_1 and swell_2 layers over the same water, plus the
     cell-to-cell seam rate inside the waves layer.

LIMITS, stated up front: one cycle, five hours, native-cell sampling (production block-means onto its tiles); the
coherence gate is assumed to pass in B/C (an UPPER bound: if a tile's gate suppresses, that tile changes nothing; part A
reports the gate for the tiles it builds); wind is a scenario, not a forecast.

RUN (from backend/):  python scripts/dominant_swell_flag_census.py --fields fields.npz --spots <catalogue.json>
          [--out census.json] [--max-spots N]
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

MIN_FRAC = 0.35
REGIONS = {  # 0.25 deg boxes the pilot lanes serve (bbox west/south/east/north)
    "hawaii": (-161.0, 18.0, -154.0, 23.0),
    "socal": (-121.0, 31.5, -116.0, 35.0),
    "florida_east": (-82.0, 25.0, -78.5, 31.0),
    "iberia_west": (-12.0, 36.0, -7.0, 43.0),
}
OM = ["wave_height", "wave_period", "wave_direction", "wind_wave_height", "swell_wave_height",
      "secondary_swell_wave_height", "wind_wave_period", "swell_wave_period", "secondary_swell_wave_period",
      "wind_wave_direction", "swell_wave_direction", "secondary_swell_wave_direction"]
UNITS = {k: ("m" if k.endswith("height") else "s" if k.endswith("period") else "°") for k in OM}


def angdiff(a, b):
    return np.abs((a - b + 180.0) % 360.0 - 180.0)


def pct(x, q):
    x = np.asarray(x, dtype=float)
    return float(np.percentile(x, q)) if x.size else float("nan")


def summary(x):
    x = np.asarray(x, dtype=float)
    if not x.size:
        return {"n": 0}
    return {"n": int(x.size), "mean": round(float(x.mean()), 3), "median": round(pct(x, 50), 3),
            "p90": round(pct(x, 90), 3), "p99": round(pct(x, 99), 3), "max": round(float(x.max()), 3)}


class Fields:
    def __init__(self, path):
        z = np.load(path)
        self.lats, self.lons = z["lats"].astype(float), z["lons"].astype(float)
        self.hours = [int(h) for h in z["hours"]]
        self.cycle = str(z["cycle"])
        self.a = {k: z[k].astype(float) for k in OM}
        self.cyc_dt = datetime.fromisoformat(self.cycle)

    def valid_time(self, ti):
        return self.cyc_dt + timedelta(hours=self.hours[ti])

    def cell(self, lat, lon):
        r = int(np.abs(self.lats - lat).argmin())
        c = int(np.abs(self.lons - (lon % 360.0)).argmin())
        return r, c

    def stamped(self, ti):
        """Vectorised stamp rule (normalizer.py 355-377): dominant partition = swell_2 where it is the larger and
        has a direction, else swell_1; stamp where its height^2 >= MIN_FRAC * total^2. Returns (dir_on, mask)."""
        a = self.a
        h, d = a["wave_height"][ti], a["wave_direction"][ti]
        s1h, s1d = a["swell_wave_height"][ti], a["swell_wave_direction"][ti]
        s2h, s2d = a["secondary_swell_wave_height"][ti], a["secondary_swell_wave_direction"][ti]
        use2 = np.isfinite(s2h) & np.isfinite(s2d) & (~np.isfinite(s1h) | (s2h > s1h))
        sh = np.where(use2, s2h, s1h)
        sd = np.where(use2, s2d, s1d)
        ok = np.isfinite(h) & (h > 0) & np.isfinite(d) & np.isfinite(sh) & np.isfinite(sd) & (sh * sh >= MIN_FRAC * h * h)
        return np.where(ok, sd, d), ok


def raw_points(F, ti, lats, lons):
    t = F.valid_time(ti).strftime("%Y-%m-%dT%H:%M")
    pts = []
    for la in lats:
        for lo in lons:
            r, c = F.cell(la, lo)
            hourly = {"time": [t]}
            for k in OM:
                v = F.a[k][ti, r, c]
                hourly[k] = [None if not np.isfinite(v) else float(v)]
            pts.append({"latitude": float(la), "longitude": float(lo), "hourly": hourly, "hourly_units": UNITS})
    return pts


def run_normalizer(F, ti, bbox, res, flag):
    from services.weather_pipeline.normalizer import WeatherNormalizer
    os.environ["WAVES_ANIM_DOMINANT_SWELL"] = "1" if flag else "0"
    w, s, e, n = bbox
    lats = np.arange(s, n + 1e-6, res)
    lons = np.arange(w, e + 1e-6, res)
    pts = raw_points(F, ti, lats, lons)
    p = WeatherNormalizer().normalize(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", raw_results=pts,
        bbox={"west": w, "south": s, "east": e, "north": n}, resolution=res, target_time=F.valid_time(ti))
    return p


def part_a(F):
    out = {}
    cases = [(name, bb, 0.25) for name, bb in REGIONS.items()] + [("world_2deg", (-180.0, -78.0, 178.0, 78.0), 2.0)]
    for name, bb, res in cases:
        rows = []
        for ti in range(len(F.hours)):
            off = run_normalizer(F, ti, bb, res, False)
            on = run_normalizer(F, ti, bb, res, True)
            vo = {(round(v.lat, 3), round(v.lng, 3)): v for v in off.grid.vectors if v.is_valid and v.speed > 0}
            vn = {(round(v.lat, 3), round(v.lng, 3)): v for v in on.grid.vectors if v.is_valid and v.speed > 0}
            keys = [k for k in vo if k in vn]
            d = np.array([angdiff(vo[k].direction, vn[k].direction) for k in keys]) if keys else np.array([])
            diag = on.grid.diagnostics
            changed = d[d > 0.01]
            # control: speed (height) must be identical flag on vs off
            speed_same = all(abs(vo[k].speed - vn[k].speed) < 1e-9 for k in keys)
            rows.append({"fh": F.hours[ti], "active_cells": len(keys), "changed_cells": int(changed.size),
                         "changed_frac": round(changed.size / max(1, len(keys)), 4),
                         "angle_diff_changed": summary(changed),
                         "swellAvailFrac": diag.get("swellAvailFrac"), "swellStampSuppressed": diag.get("swellStampSuppressed"),
                         "swellStampedCount": diag.get("swellStampedCount"), "height_unchanged": speed_same})
        out[name] = rows
    # positive control: the vectorised rule used by B and C reproduces the real normalizer's per-cell stamping
    ti = 0
    bb = REGIONS["hawaii"]
    on = run_normalizer(F, ti, bb, 0.25, True)
    dir_on, ok = F.stamped(ti)
    mism, tot = 0, 0
    for v in on.grid.vectors:
        if not v.is_valid or v.speed <= 0:
            continue
        r, c = F.cell(v.lat, v.lng)
        tot += 1
        exp = dir_on[r, c]
        if on.grid.diagnostics.get("swellStampSuppressed"):
            exp = F.a["wave_direction"][ti, r, c]
        if np.isfinite(exp) and angdiff(round(float(exp), 2), v.direction) > 0.02:
            mism += 1
    out["_vectorised_rule_vs_normalizer_hawaii_f000"] = {"cells": tot, "mismatches": mism}
    return out


def part_c(F):
    res = {}
    rows = {k: [] for k in ["on_vs_ww", "off_vs_ww", "on_vs_s1", "off_vs_s1", "on_vs_off", "s1_vs_ww", "s1_vs_s2"]}
    seam = {"on": [0, 0, 0], "off": [0, 0, 0]}  # pairs, >=90, >=135
    opposed = {"on": 0, "off": 0, "n": 0}
    wind_sea_share = []   # for cells opposed under ON but not OFF: wind-sea energy share
    for ti in range(len(F.hours)):
        a = F.a
        h = a["wave_height"][ti]
        d_off = a["wave_direction"][ti]
        d_on, st = F.stamped(ti)
        ww_d, ww_h = a["wind_wave_direction"][ti], a["wind_wave_height"][ti]
        s1d, s1h = a["swell_wave_direction"][ti], a["swell_wave_height"][ti]
        s2d, s2h = a["secondary_swell_wave_direction"][ti], a["secondary_swell_wave_height"][ti]
        base = np.isfinite(h) & (h >= 1.0) & np.isfinite(d_off)
        m = base & np.isfinite(ww_d) & np.isfinite(ww_h) & (ww_h >= 0.5)
        rows["on_vs_ww"].append(angdiff(d_on[m], ww_d[m]))
        rows["off_vs_ww"].append(angdiff(d_off[m], ww_d[m]))
        opp_on = angdiff(d_on[m], ww_d[m]) >= 135
        opp_off = angdiff(d_off[m], ww_d[m]) >= 135
        opposed["on"] += int(opp_on.sum())
        opposed["off"] += int(opp_off.sum())
        opposed["n"] += int(m.sum())
        newly = opp_on & ~opp_off
        if newly.any():
            wind_sea_share.extend(((ww_h[m] ** 2) / (h[m] ** 2))[newly].tolist())
        m1 = base & np.isfinite(s1d) & np.isfinite(s1h) & (s1h >= 0.5)
        rows["on_vs_s1"].append(angdiff(d_on[m1], s1d[m1]))
        rows["off_vs_s1"].append(angdiff(d_off[m1], s1d[m1]))
        rows["on_vs_off"].append(angdiff(d_on[base], d_off[base]))
        m12 = m1 & np.isfinite(s2d) & np.isfinite(s2h) & (s2h >= 0.5)
        rows["s1_vs_s2"].append(angdiff(s1d[m12], s2d[m12]))
        m2 = m1 & m & True
        rows["s1_vs_ww"].append(angdiff(s1d[m2], ww_d[m2]))
        for tag, dd in (("on", d_on), ("off", d_off)):
            ok = base
            for ax in (0, 1):
                a1 = dd[:-1, :] if ax == 0 else dd[:, :-1]
                a2 = dd[1:, :] if ax == 0 else dd[:, 1:]
                k1 = ok[:-1, :] if ax == 0 else ok[:, :-1]
                k2 = ok[1:, :] if ax == 0 else ok[:, 1:]
                mm = k1 & k2
                dif = angdiff(a1[mm], a2[mm])
                seam[tag][0] += int(dif.size)
                seam[tag][1] += int((dif >= 90).sum())
                seam[tag][2] += int((dif >= 135).sum())
    for k, v in rows.items():
        x = np.concatenate(v) if v else np.array([])
        res[k] = {**summary(x), "frac_ge90": round(float((x >= 90).mean()), 4) if x.size else None,
                  "frac_ge135": round(float((x >= 135).mean()), 4) if x.size else None}
    res["opposed_waves_vs_windwave_ge135"] = {
        "cells": opposed["n"], "flag_on_count": opposed["on"],
        "flag_off_count": opposed["off"], "flag_on_frac": round(opposed["on"] / max(1, opposed["n"]), 4),
        "flag_off_frac": round(opposed["off"] / max(1, opposed["n"]), 4),
        "wind_sea_energy_share_where_ON_creates_opposition": summary(wind_sea_share)}
    res["waves_layer_cell_to_cell_seams"] = {
        t: {"adjacent_pairs": seam[t][0], "frac_ge90": round(seam[t][1] / max(1, seam[t][0]), 4),
            "frac_ge135": round(seam[t][2] / max(1, seam[t][0]), 4)} for t in seam}
    return res


def region_of(lat, lon):
    for name, (w, so, e, n) in REGIONS.items():
        if w <= lon <= e and so <= lat <= n:
            return name
    return "other"


def part_b(F, spots, max_spots=None, gate=None):
    os.environ.setdefault("SIM_PRODUCTION_GEOMETRY", "1")
    from services.weather_pipeline import sim_rating as SRT
    scen_def = {  # name -> (speed_kn, from-bearing offset relative to the seaward shore normal)
        "calm": (2.0, 180.0), "light_offshore": (10.0, 180.0), "onshore": (14.0, 0.0), "cross": (10.0, 90.0)}
    rows = []
    sample_ctrl = []
    nspots = 0
    for sp in spots[: max_spots or None]:
        lat, lon = sp.get("latitude"), sp.get("longitude")
        if lat is None or lon is None:
            continue
        # nearest valid native wave cell within 1.0 deg (a 9x9 window), like a point resolve falling to a neighbour
        r0, c0 = F.cell(lat, lon)
        best = None
        for dr in range(-4, 5):
            for dc in range(-4, 5):
                r, c = r0 + dr, (c0 + dc) % len(F.lons)
                if 0 <= r < len(F.lats) and np.isfinite(F.a["wave_height"][0, r, c]):
                    dist = math.hypot(F.lats[r] - lat, ((F.lons[c] - lon + 180) % 360 - 180) * math.cos(math.radians(lat)))
                    if best is None or dist < best[0]:
                        best = (dist, r, c)
        if best is None or best[0] > 1.0:
            continue
        _, r, c = best
        shore = SRT.shore_normal_for(sp)
        if shore is None:
            continue
        nspots += 1
        for ti in range(len(F.hours)):
            H, T, d_off = F.a["wave_height"][ti, r, c], F.a["wave_period"][ti, r, c], F.a["wave_direction"][ti, r, c]
            if not (np.isfinite(H) and np.isfinite(T) and np.isfinite(d_off) and H > 0 and T > 0):
                continue
            dir_on_all, ok = F.stamped(ti)
            d_on = float(dir_on_all[r, c])
            reg = region_of(lat, lon)
            # gate-aware: inside a region the REAL normalizer was run for, a suppressed hour changes nothing
            suppressed = bool(gate and reg in gate and gate[reg].get(F.hours[ti], False))
            if suppressed:
                d_on = float(d_off)
            changed = angdiff(d_on, d_off) > 0.01
            for sc, (kn, off) in scen_def.items():
                wind_from = (shore + off) % 360.0
                rec = {"spot": sp.get("name"), "region": reg, "fh": F.hours[ti], "scen": sc, "changed_dir": bool(changed),
                       "dir_delta": float(angdiff(d_on, d_off))}
                if changed or len(sample_ctrl) < 400:
                    a = SRT.calculate_surf_rating(sp, float(H), float(T), float(d_off), kn, wind_from)
                    b = SRT.calculate_surf_rating(sp, float(H), float(T), d_on, kn, wind_from)
                    rec.update(score_off=a["quality_raw"], score_on=b["quality_raw"], level_off=a["quality_label"],
                               level_on=b["quality_label"], ft_off=a["breaking_height_ft"], ft_on=b["breaking_height_ft"])
                    if not changed:
                        sample_ctrl.append(rec)
                        continue
                    rows.append(rec)
                else:
                    rows.append({**rec, "score_off": None})
    return rows, sample_ctrl, nspots, scen_def


def part_b_report(rows, ctrl, nspots, F):
    total = len(rows)
    rated = [r for r in rows if r.get("score_off") is not None]
    changed_dir = rated
    dscore = np.array([r["score_on"] - r["score_off"] for r in rated if r["score_on"] is not None and r["score_off"] is not None])
    lev = [r for r in rated if r["level_on"] != r["level_off"]]
    rep = {"spots_with_a_valid_cell": nspots, "forecast_hours": F.hours, "cycle": F.cycle,
           "spot_hours_x_scenarios_total": total + len(ctrl),
           "rows_with_direction_changed": len(changed_dir),
           "frac_rows_direction_changed": round(len(changed_dir) / max(1, total + len(ctrl)), 4),
           "direction_delta_deg_where_changed": summary([r["dir_delta"] for r in changed_dir]),
           "score_delta_signed_where_changed": summary(dscore),
           "score_delta_abs_where_changed": summary(np.abs(dscore)),
           "score_changed_gt_0_05_rows": int((np.abs(dscore) > 0.05).sum()),
           "level_changed_rows": len(lev),
           "frac_all_rows_level_changed": round(len(lev) / max(1, total + len(ctrl)), 4),
           "frac_all_rows_score_changed_gt_1": round(float((np.abs(dscore) > 1).sum()) / max(1, total + len(ctrl)), 4),
           "height_changed_rows_ft_gt_0_05": int(sum(1 for r in rated if abs(r["ft_on"] - r["ft_off"]) > 0.05))}
    by = {}
    for sc in sorted({r["scen"] for r in rated}):
        rs = [r for r in rated if r["scen"] == sc]
        ds = np.array([r["score_on"] - r["score_off"] for r in rs])
        by[sc] = {"rows_changed_dir": len(rs), "score_abs_delta": summary(np.abs(ds)),
                  "level_changed": sum(1 for r in rs if r["level_on"] != r["level_off"]),
                  "mean_signed": round(float(ds.mean()), 3) if ds.size else None}
    rep["by_wind_scenario"] = by
    regs = {}
    all_by_reg = {}
    for r in rows + ctrl:
        all_by_reg[r["region"]] = all_by_reg.get(r["region"], 0) + 1
    for rg, tot in sorted(all_by_reg.items()):
        rs = [r for r in rated if r["region"] == rg]
        ds = np.array([abs(r["score_on"] - r["score_off"]) for r in rs])
        regs[rg] = {"rows": tot, "rows_dir_changed": len(rs), "frac_dir_changed": round(len(rs) / tot, 4),
                    "level_changed": sum(1 for r in rs if r["level_on"] != r["level_off"]),
                    "frac_level_changed": round(sum(1 for r in rs if r["level_on"] != r["level_off"]) / tot, 4),
                    "score_abs_delta_where_changed": summary(ds)}
    rep["by_region"] = regs
    trans = {}
    for r in lev:
        k = f"{r['level_off']} -> {r['level_on']}"
        trans[k] = trans.get(k, 0) + 1
    rep["level_transitions"] = dict(sorted(trans.items(), key=lambda kv: -kv[1])[:12])
    rep["control_unchanged_direction_rows_rerated"] = len(ctrl)
    rep["control_score_mismatches"] = sum(1 for r in ctrl if r["score_on"] != r["score_off"])
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fields", required=True)
    ap.add_argument("--spots", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--max-spots", type=int, default=None)
    ap.add_argument("--gate", default=None, help="a previous run's JSON (part A): hours a region's coherence gate suppressed")
    ap.add_argument("--skip", nargs="*", default=[], choices=["a", "b", "c"])
    a = ap.parse_args()
    F = Fields(a.fields)
    result = {"cycle": F.cycle, "hours": F.hours, "min_frac": MIN_FRAC}
    if "a" not in a.skip:
        result["A_normalizer"] = part_a(F)
        print("A done", flush=True)
    if "c" not in a.skip:
        result["C_layer_opposition"] = part_c(F)
        print("C done", flush=True)
    if "b" not in a.skip:
        spots = json.load(open(a.spots, encoding="utf-8"))
        gate = None
        if a.gate:
            ga = json.load(open(a.gate, encoding="utf-8"))["A_normalizer"]
            gate = {rg: {r["fh"]: bool(r["swellStampSuppressed"]) for r in rs} for rg, rs in ga.items()
                    if not rg.startswith("_") and rg != "world_2deg"}
        rows, ctrl, nspots, scen = part_b(F, spots, a.max_spots, gate)
        result["B_rating_census"] = part_b_report(rows, ctrl, nspots, F)
        result["B_scenarios"] = scen
        print("B done", flush=True)
    txt = json.dumps(result, indent=1, default=float)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(txt)
    print(txt)


if __name__ == "__main__":
    main()
