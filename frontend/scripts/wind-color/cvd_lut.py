"""Export coloraide's dichromat simulations as a lookup table on a linear-sRGB lattice, for numpy instruments that judge
whole screenshots (offline-backend/crest_contrast.py) without a per-pixel coloraide call.

The models are the checkers' own (cvd_check.py, wave_cvd_check.py): Vienot 1999 protan/deutan, Brettel 1997 tritan. Both are
(piecewise) linear in linear sRGB, so trilinear interpolation on a 33-point lattice reproduces them closely: worst 3.4e-3 linear
on 300 random colours (Brettel's fold between its two planes; Vienot is exact). The script prints that check on every run.

Usage:  .venv/Scripts/python cvd_lut.py <out.json> [--n 33]
"""
import json
import random
import sys

from coloraide import Color

MODELS = (("protan", "vienot"), ("deutan", "vienot"), ("tritan", "brettel"))


def sim(rgb_lin, kind, method):
    return Color("srgb-linear", list(rgb_lin)).filter(kind, method=method).convert("srgb-linear").coords()


def trilinear(lut, n, c):
    x = [min(n - 1 - 1e-9, max(0.0, v * (n - 1))) for v in c]
    i = [int(v) for v in x]
    f = [v - k for v, k in zip(x, i)]
    out = [0.0, 0.0, 0.0]
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (f[0] if dr else 1 - f[0]) * (f[1] if dg else 1 - f[1]) * (f[2] if db else 1 - f[2])
                v = lut[((i[0] + dr) * n + (i[1] + dg)) * n + (i[2] + db)]
                out = [o + w * q for o, q in zip(out, v)]
    return out


def main(out, n):
    grid = [k / (n - 1) for k in range(n)]
    lut = {kind: [sim((r, g, b), kind, method) for r in grid for g in grid for b in grid] for kind, method in MODELS}
    random.seed(1)
    worst = {kind: 0.0 for kind, _ in MODELS}
    for _ in range(300):
        c = [random.random() for _ in range(3)]
        for kind, method in MODELS:
            a, b = sim(c, kind, method), trilinear(lut[kind], n, c)
            worst[kind] = max(worst[kind], max(abs(x - y) for x, y in zip(a, b)))
    json.dump({"n": n, "space": "srgb-linear", "order": "r-major, then g, then b", "models": dict(MODELS), **lut}, open(out, "w"))
    print(f"wrote {out}: {n}^3 lattice x {len(MODELS)} models; worst trilinear error vs coloraide on 300 random colours (linear) " + ", ".join(f"{k} {w:.1e}" for k, w in worst.items()))


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 33)
