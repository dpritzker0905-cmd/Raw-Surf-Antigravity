#!/usr/bin/env python3
"""build_swell_exposure_normals.py - write data/swell_exposure_normals.json from the CDIP MOP effective-normal fit.

Input: the fit's per-spot records (JSON list; see docs/research/FINDING-2026-11-11-mop-calibrated-swell-exposure-normals.md
for the method: per spot, the bearing minimising the MSE between the chain's own height factor and MOP's normalised
attenuation, fitted on 2022-01..2023-12, scored on 2024-01..2025-03). The research scripts that produce it live in
scripts/swell_exposure_normals_fit/.

THE GATE (a spot enters the asset only when ALL hold; a miss keeps today's shore normal there):
  * usable: enough data in both periods (the fit's own `usable` flag);
  * out of sample, the fitted normal beats the chain normal (test_fit < test_chain);
  * the optimum is not ambiguous (`curve_width_deg` <= MAX_AMBIGUOUS_DEG: degrees within 10% of the train minimum);
  * the fit sits within MAX_KM of a MOP point (the MOP cell answers for this spot, not a neighbour's coast).

Usage: python scripts/build_swell_exposure_normals.py --fit fit_all.json [--out services/weather_pipeline/data/...]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

MAX_AMBIGUOUS_DEG = 40
MAX_KM = 1.5
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "services", "weather_pipeline", "data",
                   "swell_exposure_normals.json")


def gate(rec):
    """(admit, reason) for one fit record."""
    if not rec.get("usable"):
        return False, "not enough data in both periods"
    tf, tc = rec.get("test_fit"), rec.get("test_chain")
    if tf is None or tc is None or not tf < tc:
        return False, "fit not better than the chain normal out of sample"
    w = rec.get("curve_width_deg", rec.get("ambiguous_width_deg"))
    if w is not None and w > MAX_AMBIGUOUS_DEG:
        return False, f"ambiguous optimum ({w} deg within 10% of the minimum)"
    km = rec.get("mop_km")
    if km is not None and km > MAX_KM:
        return False, f"MOP point {km} km away"
    return True, "admitted"


def build(records):
    entries, rejected = [], []
    for rec in records:
        ok, why = gate(rec)
        if ok:
            entries.append({"name": rec["name"], "spot_id": rec.get("spot_id"), "lat": round(float(rec["lat"]), 5),
                            "lng": round(float(rec["lng"]), 5), "normal": float(rec["fit_normal"]) % 360.0,
                            "chain_normal": rec.get("chain_normal"), "mop_point": rec.get("mop"),
                            "buoy": rec.get("buoy"), "test_mse_chain": rec.get("test_chain"),
                            "test_mse_fit": rec.get("test_fit"), "n_test": rec.get("n_test")})
        else:
            rejected.append({"name": rec.get("name"), "reason": why})
    return {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": "per-spot bearing minimising MSE(chain height factor, CDIP MOP v1.1 attenuation); train 2022-01..2023-12, "
                      "admitted only if better than the chain normal on 2024-01..2025-03",
            "gate": {"max_ambiguous_deg": MAX_AMBIGUOUS_DEG, "max_mop_km": MAX_KM},
            "entries": sorted(entries, key=lambda e: (-e["lat"], e["lng"])), "rejected": rejected}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--fit", required=True)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args(argv)
    with open(a.fit, encoding="utf-8") as fh:
        doc = build(json.load(fh))
    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    print(f"{len(doc['entries'])} admitted, {len(doc['rejected'])} rejected -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
