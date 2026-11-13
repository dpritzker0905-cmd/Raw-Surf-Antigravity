#!/usr/bin/env python3
"""Regenerate the tide-cell rounding oracle (follow-up to #791, review finding 6).

The client's tide cell (frontend/src/components/map/tideClient.js, roundTideCoordinate) must land
on the SAME ~0.1 degree cell as the backend's tide._round_key, which is Python round(x, 1). The
two languages disagree on exact decimal ties (toFixed rounds them away from zero, Python to even),
so the client carries a tie rule. This script writes Python's own answers for the hard inputs to
a fixture that BOTH sides test against:

  * frontend: src/components/map/tideRoundOracle.test.js (the client agrees exactly)
  * backend:  tests/test_tide_round_key_oracle.py (tide._round_key still equals the fixture)

Inputs: every multiple of 0.25 in [-180, 180] (the exactly representable x.x5 ties are the .25 and
.75 ones) and its two adjacent binary floats; x +/- Number.EPSILON where that is a distinct float;
every x.x5 decimal in [-180, 180] (not exactly representable, so the binary error decides); signed
zero; the +/-90 and +/-180 bounds and their neighbours; and a seeded sweep of 3000 values (1500
full-precision, 1500 at two decimals, the way spot coordinates are usually stored).

Deterministic (fixed seed, sorted, deduplicated). Run from the repo root:

    python frontend/scripts/gen_tide_round_oracle.py

JSON floats are written with repr (shortest round-trip), which JSON.parse reads back as the same
double, -0.0 included.
"""
import json
import math
import os
import random

SEED = 791
EPS = 2.0 ** -52  # Number.EPSILON
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "src", "components", "map", "tideRoundOracle.fixture.json"
)


def _neighbours(x):
    return (math.nextafter(x, -math.inf), x, math.nextafter(x, math.inf))


def inputs():
    vals = set()
    for k in range(-720, 721):  # every multiple of 0.25 in [-180, 180]
        x = k / 4
        vals.update(_neighbours(x))
        vals.update((x - EPS, x + EPS))
    for k in range(-1800, 1800):  # every x.x5 decimal in [-180, 180]
        vals.add(float(f"{k / 10 + 0.05:.2f}"))
    for b in (90.0, 180.0, 89.95, 179.95, 0.05, 0.15):
        for s in (1.0, -1.0):
            vals.update(_neighbours(s * b))
    rng = random.Random(SEED)
    for _ in range(1500):
        vals.add(rng.uniform(-180.0, 180.0))
    for _ in range(1500):
        vals.add(round(rng.uniform(-180.0, 180.0), 2))
    vals = {v for v in vals if -180.0 <= v <= 180.0 and v != 0.0}
    # signed zero: a set keeps only one of 0.0 / -0.0, so add both explicitly
    return [0.0, -0.0] + sorted(vals)


def main():
    xs = inputs()
    doc = {
        "about": "Python round(x, 1) for the tide-cell oracle; regenerate with frontend/scripts/gen_tide_round_oracle.py",
        "seed": SEED,
        "count": len(xs),
        "inputs": xs,
        "expected": [round(x, 1) for x in xs],
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(xs)} cases to {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
