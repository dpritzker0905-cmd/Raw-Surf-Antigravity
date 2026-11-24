"""Publish-time PHYSICAL-CONSISTENCY check of the published marine frames (2026-11-23, check lane). REPORT-ONLY.

WHY: the data-and-physics rescan of 2026-11-23 (side notes SOTA-RESCAN-DATA-AND-PHYSICS-2026-11-23.md) decoded what users are
actually served and found numbers no ocean can produce, every one invisible to the publisher's own gates (which check that a
frame equals its stored product, not that the product is physically possible):
  * swell_1 above the TOTAL wave height in 19-22 % of cells of the ICON / EURO estimated tail (worst: total 0.33 m, swell 6.22 m);
  * the "EURO" partitions mostly Copernicus MFWAM 00Z while the "EURO" total is ECMWF 12Z, energy closure failing 2.9 % -> 16.8 %
    of cells from 24 h to 168 h;
  * EURO total frames interleaved from runs one to three days older (native_time_interpolation brackets of older runs);
  * ICON serving 0.00 m / 0 s as VALID data in 11.4 % of valid cells.

WHAT THIS MODULE IS: pure functions over decoded frame planes and run indexes; no I/O, no flag, no network. The script
(scripts/frame_physics_report.py) reads the published sets and writes the report. NOTHING HERE BLOCKS A PUBLISH OR CHANGES A
VALUE: the result is a dict of counts, rates and worst examples. Each rule is a LAW, not a calibration:

  R1 PARTITION_LE_TOTAL  a partition's Hs cannot exceed the total Hs of the same sea (Hs = 4 sqrt(m0), and every partition's m0 is
                         a part of the total's m0). Violation: max(partition) > total + TOL_PARTITION_M.
  R2 ENERGY_CLOSURE      the partitions' energies cannot add up to more than the total's: sum(p^2) <= total^2. Violation:
                         sum(p^2) > (1 + TOL_ENERGY_FRAC) * total^2. The partitions need not ADD UP to the total (a model may
                         leave energy unpartitioned), so only the upper side is a law; the under side is reported, not failed.
  R3 NO_VALID_ZERO       a cell published as valid with height 0 and period 0 (or no period) is "data-shaped nothing": the
                         source had no value there and it was not masked. Violation: valid height == 0 and period in (0, None).
  R4 ONE_SOURCE_ONE_RUN  one model button = one model and one run: across that model's marine layers, the AUTHORITATIVE frames and
                         the native_time_interpolation frames (an interpolation between two of the model's OWN frames) carry ONE
                         source dataset and ONE model run. The estimated tail blends (euro_persistence_*: the LOCKED 14-day
                         extension, BRAIN_RULES "14-Day Forecast Horizon") are by design another source and are listed, not failed.

Cells checked by R1 / R2: total valid and > MIN_TOTAL_M (a near-calm cell is dominated by quantisation), and at least one valid
partition. Tolerances sit above the codec's own error (frame_binary TOLERANCE: height 0.0005 m) by two orders of magnitude.
"""
from __future__ import annotations

import math

LAYER_TOTAL = "waves"
LAYER_PARTITIONS = ("swell_1", "swell_2", "wind_waves")
MARINE_LAYERS = (LAYER_TOTAL,) + LAYER_PARTITIONS
TOL_PARTITION_M = 0.05        # the rescan's threshold (5 cm)
TOL_ENERGY_FRAC = 0.10        # the rescan's threshold (sum of partition energies > 1.10 x total energy)
MIN_TOTAL_M = 0.25            # the rescan's floor for R1 / R2
NATIVE_BASIS = "native_time_interpolation"
WORST_KEEP = 5                # worst examples kept per rule per frame group

RULES = ("partition_le_total", "energy_closure", "no_valid_zero", "one_source_one_run")


def frame_meta(index, frame):
    """A frame's full meta: the index's common_meta under the frame's own (frame_set.factor_common's inverse)."""
    return {**((index or {}).get("common_meta") or {}), **((frame or {}).get("meta") or {})}


def basis_type(meta):
    basis = (meta or {}).get("estimate_basis")
    if isinstance(basis, dict):
        return str(basis.get("type") or "estimated")
    return "estimated" if (meta or {}).get("is_estimated") else "authoritative"


def frame_class(frame, meta):
    """'authoritative', 'native_interp' (an interpolation of the model's own frames) or 'tail:<basis type>'."""
    if not (frame or {}).get("is_estimated") and not (meta or {}).get("is_estimated"):
        return "authoritative"
    b = basis_type(meta)
    return "native_interp" if b == NATIVE_BASIS else f"tail:{b}"


def source_label(meta):
    """The dataset a frame's numbers come from: source_dataset, else upstream_model, else provider, else model."""
    m = meta or {}
    return str(m.get("source_dataset") or m.get("upstream_model") or m.get("provider") or m.get("model") or "unknown")


def _lead_h(valid_time, run):
    from datetime import datetime
    try:
        v = datetime.fromisoformat(str(valid_time).replace("Z", "+00:00"))
        r = datetime.fromisoformat(str(run).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return round((v - r).total_seconds() / 3600.0, 1)


# ---------------------------------------------------------------- R4: provenance (index only, no frame bytes)

def provenance(model, indexes):
    """R4 for one model button. `indexes`: {layer: run index dict or None}. Returns the per-class histograms and the verdict.

    The verdict counts only the classes that must be the button's own model: 'authoritative' and 'native_interp'. A native
    interpolation whose run differs from the newest authoritative run is how an older run gets interleaved between fresh
    frames (rescan finding 4); a partition layer whose source differs from the total's is rescan finding 2."""
    by_class, own_sources, own_runs, examples = {}, {}, {}, []
    for layer in MARINE_LAYERS:
        index = (indexes or {}).get(layer)
        if not index:
            continue
        for f in index.get("frames") or []:
            if not f.get("path"):
                continue
            meta = frame_meta(index, f)
            cls = frame_class(f, meta)
            src = source_label(meta)
            run = meta.get("model_run_time") or (f.get("source") or {}).get("model_run_time")
            row = by_class.setdefault(cls, {"frames": 0, "sources": {}, "runs": {}})
            row["frames"] += 1
            row["sources"][src] = row["sources"].get(src, 0) + 1
            row["runs"][str(run)] = row["runs"].get(str(run), 0) + 1
            if cls in ("authoritative", "native_interp"):
                if cls == "authoritative":   # an interpolation is labelled `estimated_interpolation`: its source is its brackets'
                    own_sources.setdefault(src, set()).add(layer)
                own_runs.setdefault(str(run), []).append((layer, f.get("valid_time"), cls))
    newest = max((r for r in own_runs if r != "None"), default=None)
    stale = [(layer, vt, cls, run) for run, rows in own_runs.items() if run != newest for layer, vt, cls in rows]
    seen = set()
    for layer, vt, cls, run in sorted(stale, key=lambda x: (x[1] or "", x[0])):   # the first of each (layer, class, run)
        if (layer, cls, run) not in seen and len(examples) < 2 * WORST_KEEP:
            seen.add((layer, cls, run))
            examples.append({"layer": layer, "valid_time": vt, "class": cls, "run": run, "newest_run": newest})
    violation = len(own_sources) > 1 or len(own_runs) > 1
    return {
        "model": model, "rule": "one_source_one_run", "violation": violation,
        "sources": {s: sorted(layers) for s, layers in sorted(own_sources.items())},
        "runs": {r: len(rows) for r, rows in sorted(own_runs.items())},
        "newest_run": newest, "frames_off_newest_run": len(stale), "examples": examples,
        "by_class": by_class,
    }


# ---------------------------------------------------------------- R1-R3: one valid time of one model (decoded planes)

def _np():
    import numpy as np
    return np


def zero_cells(height, period):
    """R3 for one layer plane: (valid cells, valid cells with height 0 and period 0 or missing)."""
    np = _np()
    h = np.asarray(height, dtype=float)
    valid = np.isfinite(h)
    zero_h = valid & (np.abs(h) < 1e-9)
    p = None if period is None else np.asarray(period, dtype=float)
    if p is None or p.shape != h.shape:   # no period plane (or another grid): zero height alone is the signal
        zero = zero_h
    else:
        zero = zero_h & (~np.isfinite(p) | (np.abs(p) < 1e-9))
    return int(valid.sum()), zero


def check_time(model, valid_time, planes, lat=None, lng=None):
    """R1-R3 at one valid time. `planes`: {layer: {'height_m': 2-D array, 'period_s': 2-D array or None, 'class', 'run'}} for
    the layers published there. Returns counts, rates and the worst cells (lat / lng when given, else row / col)."""
    np = _np()
    out = {"model": model, "valid_time": valid_time, "layers": sorted(planes), "skipped": []}
    total = planes.get(LAYER_TOTAL)
    # R3 on every layer present
    zeros = {}
    for layer, p in sorted(planes.items()):
        n_valid, zmask = zero_cells(p["height_m"], p.get("period_s"))
        zeros[layer] = {"valid": n_valid, "zero": int(zmask.sum()),
                        "rate": round(int(zmask.sum()) / n_valid, 4) if n_valid else 0.0, "class": p.get("class")}
    out["no_valid_zero"] = zeros
    parts = [layer for layer in LAYER_PARTITIONS if layer in planes]
    if total is None or not parts:
        out["skipped"].append("no total" if total is None else "no partition")
        return out
    H = np.asarray(total["height_m"], dtype=float)
    shapes = {layer: np.asarray(planes[layer]["height_m"]).shape for layer in parts}
    if any(s != H.shape for s in shapes.values()):
        out["skipped"].append(f"grid mismatch: total {H.shape} vs {shapes}")
        return out
    P = np.stack([np.asarray(planes[layer]["height_m"], dtype=float) for layer in parts])
    pvalid = np.isfinite(P)
    any_part = pvalid.any(axis=0)
    base = np.isfinite(H) & (H > MIN_TOTAL_M)
    cells = base & any_part
    Pz = np.where(pvalid, P, 0.0)
    pmax = Pz.max(axis=0)
    psum2 = (Pz ** 2).sum(axis=0)
    r1 = cells & (pmax > H + TOL_PARTITION_M)
    r2 = cells & (psum2 > (1.0 + TOL_ENERGY_FRAC) * H ** 2)
    n = int(cells.sum())

    def worst(mask, score):
        idx = np.argwhere(mask)
        if not len(idx):
            return []
        s = score[mask]
        order = np.argsort(-s)[:WORST_KEEP]
        rows = []
        for k in order:
            r, c = (int(v) for v in idx[k])
            row = {"row": r, "col": c, "total_m": round(float(H[r, c]), 3),
                   "partitions_m": {layer: (round(float(P[i, r, c]), 3) if pvalid[i, r, c] else None) for i, layer in enumerate(parts)}}
            if lat is not None and lng is not None:
                row["lat"], row["lng"] = round(float(lat[r]), 3), round(float(lng[c]), 3)
            rows.append(row)
        return rows

    with np.errstate(divide="ignore", invalid="ignore"):
        excess = np.where(cells, pmax - H, 0.0)
        ratio = np.where(cells & (H > 0), psum2 / np.maximum(H ** 2, 1e-12), 0.0)
    out["cells_checked"] = n
    out["total_without_partition"] = int((base & ~any_part).sum())
    out["partition_le_total"] = {"violations": int(r1.sum()), "rate": round(int(r1.sum()) / n, 4) if n else 0.0,
                                 "tolerance_m": TOL_PARTITION_M, "worst": worst(r1, excess)}
    out["energy_closure"] = {"violations": int(r2.sum()), "rate": round(int(r2.sum()) / n, 4) if n else 0.0,
                             "tolerance_frac": TOL_ENERGY_FRAC,
                             "under_closed_lt_half": int((cells & (psum2 < 0.5 * H ** 2)).sum()),
                             "worst": worst(r2, ratio)}
    out["classes"] = {layer: planes[layer].get("class") for layer in planes}
    out["runs"] = {layer: planes[layer].get("run") for layer in planes}
    return out


# ---------------------------------------------------------------- sampling and roll-up

def pick_frame(index, valid_time):
    """The frame the client would draw at `valid_time` (frame_set's selection rule restricted to an exact time):
    authoritative before estimated; None when the set lists no built frame there."""
    best = None
    for f in (index or {}).get("frames") or []:
        if f.get("valid_time") != valid_time or not f.get("path"):
            continue
        if best is None or (best.get("is_estimated") and not f.get("is_estimated")):
            best = f
    return best


def sample_times(index, step_h, max_times):
    """Valid times of the total set to check: lead 0 and then one every `step_h` hours (the nearest built frame at or after
    each target), at most `max_times`. Leads count from the index's run."""
    frames = sorted({f["valid_time"] for f in (index or {}).get("frames") or [] if f.get("path") and f.get("valid_time")})
    run = (index or {}).get("run")
    if not frames:
        return []
    leads = [(vt, _lead_h(vt, run)) for vt in frames]
    out, target = [], 0.0
    for vt, lead in leads:
        if lead is None:
            continue
        if lead >= target - 1e-6:
            out.append(vt)
            target = (math.floor(lead / step_h) + 1) * step_h if step_h > 0 else lead + 1
        if len(out) >= max_times:
            break
    return out


def summarize(provenance_rows, time_rows):
    """Run-level roll-up: per model and rule, the frames (valid times) with a violation, the cells and the worst rate."""
    out = {}
    for p in provenance_rows:
        m = out.setdefault(p["model"], {})
        m["one_source_one_run"] = {"violation": p["violation"], "sources": len(p["sources"]), "runs": len(p["runs"]),
                                   "frames_off_newest_run": p["frames_off_newest_run"]}
    for t in time_rows:
        m = out.setdefault(t["model"], {})
        for rule in ("partition_le_total", "energy_closure"):
            if rule not in t:
                continue
            r = m.setdefault(rule, {"times_checked": 0, "times_violating": 0, "cells": 0, "violations": 0, "max_rate": 0.0,
                                    "max_rate_at": None})
            r["times_checked"] += 1
            r["cells"] += t.get("cells_checked", 0)
            r["violations"] += t[rule]["violations"]
            r["times_violating"] += 1 if t[rule]["violations"] else 0
            if t[rule]["rate"] > r["max_rate"]:
                r["max_rate"], r["max_rate_at"] = t[rule]["rate"], t["valid_time"]
        for layer, z in (t.get("no_valid_zero") or {}).items():
            r = m.setdefault("no_valid_zero", {}).setdefault(layer, {"times_checked": 0, "valid": 0, "zero": 0, "max_rate": 0.0})
            r["times_checked"] += 1
            r["valid"] += z["valid"]
            r["zero"] += z["zero"]
            r["max_rate"] = max(r["max_rate"], z["rate"])
    for m in out.values():
        for rule in ("partition_le_total", "energy_closure"):
            if rule in m:
                m[rule]["rate"] = round(m[rule]["violations"] / m[rule]["cells"], 4) if m[rule]["cells"] else 0.0
        for z in (m.get("no_valid_zero") or {}).values():
            z["rate"] = round(z["zero"] / z["valid"], 4) if z["valid"] else 0.0
    return out


def verdicts(summary):
    """{rule: [models violating]}: R1 / R2 / R3 count as violating when ANY checked cell violates (a law has no allowed rate)."""
    out = {r: [] for r in RULES}
    for model, m in sorted(summary.items()):
        if (m.get("one_source_one_run") or {}).get("violation"):
            out["one_source_one_run"].append(model)
        for rule in ("partition_le_total", "energy_closure"):
            if (m.get(rule) or {}).get("violations"):
                out[rule].append(model)
        if any(z["zero"] for z in (m.get("no_valid_zero") or {}).values()):
            out["no_valid_zero"].append(model)
    return out


def markdown(report):
    """The step-summary table (GitHub-flavoured markdown)."""
    lines = ["### Frame physics check (report-only; never blocks or changes a frame)", ""]
    if report.get("killed"):
        return "\n".join(lines + ["Killed: FRAME_PHYSICS_CHECK=0. Nothing was read.", ""])
    if report.get("error"):
        lines += [f"**Check error (the publish is unaffected):** `{report['error']}`", ""]
    lines += ["| Model | R1 swell<=total | R2 energy closure | R3 valid zeros | R4 one source + run |", "|---|---|---|---|---|"]
    for model, m in sorted((report.get("summary") or {}).items()):
        def cell(rule):
            r = m.get(rule)
            if not r:
                return "n/a"
            return f"{r['violations']:,} / {r['cells']:,} cells ({r['rate']:.1%}); worst {r['max_rate']:.1%} @ {r['max_rate_at'] or '-'}"
        zs = m.get("no_valid_zero") or {}
        z = "; ".join(f"{layer} {v['zero']:,}/{v['valid']:,} ({v['rate']:.1%})" for layer, v in sorted(zs.items()) if v["zero"]) or (
            "0" if zs else "n/a")
        p = m.get("one_source_one_run")
        prov = "n/a" if not p else (f"**{p['sources']} sources, {p['runs']} runs**, {p['frames_off_newest_run']} frames off newest"
                                    if p["violation"] else "ok")
        lines.append(f"| {model} | {cell('partition_le_total')} | {cell('energy_closure')} | {z} | {prov} |")
    v = report.get("verdicts") or {}
    lines += ["", "Violating models per rule: " + ", ".join(f"{r}: {', '.join(v.get(r) or []) or 'none'}" for r in RULES),
              f"Frames read: {report.get('frames_read', 0)} ({report.get('bytes_read', 0):,} bytes). "
              f"Tolerances: R1 {TOL_PARTITION_M} m, R2 {TOL_ENERGY_FRAC:.0%}, cells with total > {MIN_TOTAL_M} m.", ""]
    return "\n".join(lines)
