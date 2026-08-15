"""MC-01 cap-seam band census: what the repair changes, where, and what ratings do about it.

Runs the production transform under BOTH flag states (SURF_CAP_SEAM_MONOTONE=0/1) over the audit
probe's coastal grid and reports:
  1. the seam scan (negative jumps) per state — the repair's headline number must be ZERO;
  2. the over-ceiling BAND: which (geometry, Tp, offset, Hs) cells legacy publishes above the cap,
     the fraction of swept cells in-band, and the height correction distribution inside it;
  3. downstream rating migration: compute_surf_rating on legacy vs repaired heights inside the
     band (probe-convention rating inputs: reference_size_m=1.2, break_depth from the geometry,
     8 kt cross wind) — score deltas and bucket crossings.

Caveats stated up front: synthetic grid (the audit probe's), NOT population-weighted; the cap binds
on 0.145% of served spot-hours (n=227,088, 2026-08-07), so in-band fractions here describe the
sweep, not production traffic. Rating inputs use the probe's reference-size convention; production
supplies per-spot references (the local size curve), so deltas are indicative, not served values.

Usage:  python mc01_capseam_census.py > mc01-capseam-census.json     (ASCII-only output)
"""
from __future__ import annotations

import itertools
import json
import os
import sys

BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND))

from services.weather_pipeline.surf_point import SurfGeometry, estimate_surf_at  # noqa: E402
from services.weather_pipeline.surf_rating import compute_surf_rating           # noqa: E402

FLAG = "SURF_CAP_SEAM_MONOTONE"

GEOMETRIES = {
    "wide_shelf": SurfGeometry(20.0, 200.0, True, 90.0, "audit", 1.0, None, 4.0, True),
    "steep_shelf": SurfGeometry(100.0, 10.0, True, 90.0, "audit", 1.0, None, 8.0, True),
    "unknown_bearing": SurfGeometry(50.0, 30.0, True, None, "none", 1.0, None, 5.0, True),
}
PERIODS = (6.0, 10.0, 14.0, 18.0)
OFFSETS = (0.0, 45.0, 90.0, 135.0)


def sweep(state: str):
    os.environ[FLAG] = state
    rows = []
    for name, geom in GEOMETRIES.items():
        for tp, off in itertools.product(PERIODS, OFFSETS):
            prev = None
            for i in range(10, 1201):
                hs = i / 100.0
                h, regime = estimate_surf_at(0.0, 0.0, hs, tp, 90.0 + off, geometry=geom)
                h = float(h)
                rows.append((name, tp, off, hs, h, regime))
                prev = (hs, h)
    return rows


def seam_jumps(rows):
    jumps = []
    key = None
    prev = None
    for name, tp, off, hs, h, regime in rows:
        k = (name, tp, off)
        if k != key:
            key, prev = k, None
        if prev is not None and h - prev[1] < -0.05:
            jumps.append({"trace": list(k), "hs": [prev[0], hs],
                          "out": [round(prev[1], 4), round(h, 4)],
                          "drop_m": round(prev[1] - h, 4)})
        prev = (hs, h)
    return jumps


def main():
    legacy = sweep("0")
    fixed = sweep("1")
    os.environ[FLAG] = "0"

    jl, jf = seam_jumps(legacy), seam_jumps(fixed)

    # the band: cells where the two states disagree (legacy over-ceiling)
    band = []
    for (n, tp, off, hs, hl, rl), (_, _, _, _, hf, rf) in zip(legacy, fixed):
        if abs(hl - hf) > 1e-9:
            band.append((n, tp, off, hs, hl, hf, rl, rf))
    # the repair may only LOWER a value (clip to the cap) -- an increase anywhere is a defect
    raised = [b for b in band if b[5] > b[4] + 1e-9]
    assert not raised, f"repair RAISED a published height: {raised[:3]}"
    corrections = sorted((b[4] - b[5]) / b[4] for b in band)
    per_trace = {}
    for b in band:
        per_trace.setdefault((b[0], b[1], b[2]), []).append(b[3])

    # rating migration inside the band (probe rating conventions; see module docstring caveats)
    migrations = []
    bucket_cross = 0
    for n, tp, off, hs, hl, hf, rl, rf in band[:: max(1, len(band) // 400)]:
        bd = {"wide_shelf": 4.0, "steep_shelf": 8.0, "unknown_bearing": 5.0}[n]
        args = dict(reference_size_m=1.2, break_depth_m=bd)
        s_l, lvl_l = compute_surf_rating(hl, tp, 4.0, 90.0 + off + 90.0, 90.0, 90.0 + off, **args)
        s_f, lvl_f = compute_surf_rating(hf, tp, 4.0, 90.0 + off + 90.0, 90.0, 90.0 + off, **args)
        d = (s_f or 0.0) - (s_l or 0.0)
        migrations.append(round(d, 1))
        bucket_cross += lvl_f != lvl_l
    migrations.sort()

    def pct(vals, q):
        if not vals:
            return None
        return vals[min(len(vals) - 1, int(q * (len(vals) - 1)))]

    out = {
        "flag": FLAG,
        "sweep": {"traces": len(GEOMETRIES) * len(PERIODS) * len(OFFSETS),
                  "steps_per_trace": 1191, "hs_range_m": [0.10, 12.00], "step_m": 0.01},
        "seam_scan": {
            "legacy_negative_jumps": len(jl),
            "legacy_traces_with_jump": len({tuple(j["trace"]) for j in jl}),
            "legacy_largest": sorted(jl, key=lambda j: -j["drop_m"])[:3],
            "fixed_negative_jumps": len(jf),
            "fixed_traces_with_jump": len({tuple(j["trace"]) for j in jf}),
        },
        "band": {
            "cells_in_band": len(band),
            "cells_total": len(legacy),
            "fraction_of_sweep": round(len(band) / len(legacy), 5),
            "traces_touched": len(per_trace),
            "correction_rel": {"min": round(corrections[0], 4) if corrections else None,
                               "median": round(pct(corrections, 0.5), 4) if corrections else None,
                               "max": round(corrections[-1], 4) if corrections else None},
            "note": "correction_rel = (legacy - fixed)/legacy inside the band; max is bounded by "
                    "1 - 1/1.27 = 0.2126 by construction",
        },
        "rating_migration_in_band": {
            "sampled": len(migrations),
            "score_delta": {"min": migrations[0] if migrations else None,
                            "median": pct(migrations, 0.5),
                            "max": migrations[-1] if migrations else None},
            "bucket_crossings": bucket_cross,
            "caveat": "probe rating conventions (reference_size_m=1.2); production supplies "
                      "per-spot references -- indicative, not served values",
        },
        "production_reach_context": "depth-limited cap binds 0.145% of served spot-hours "
                                    "(n=227,088, 2026-08-07); the band is the sub-neighbourhood "
                                    "of that where legacy overshoots the cap",
    }
    print(json.dumps(out, indent=2, sort_keys=False))


if __name__ == "__main__":
    main()
