"""The float height A/B (2026-10-20): what the wash looks like with the R16F height against the 8-bit height byte, pixel for pixel.

Reads scn_wave_palette_ab.js output taken with WASH=1 VARIANTS=v2@u8,v2,v2@u8b,v2b (v2@u8 = the float kill, #415 exactly; v2 =
the float height; the b runs = each lever again, the null controls) over serve_synthetic.py --calm-patch 27,-111,8. Per theme and
view, on the crest-free (-wash.png) shots:
  * QUIET pixels: where each lever's two runs agree within TOL (max channel). What differs run to run (labels, the land mask's
    async paint, a grid committed at a different moment) is left out, so the comparison is the encoding, not the timing;
  * byte vs float inside the quiet mask: how many pixels move (> TOL), and by how much in CIEDE2000 (max, p99, mean of the moved);
  * the null control: the same numbers for v2@u8 vs v2@u8b and v2 vs v2b over ALL pixels (what "no change" looks like here).
The float run is the reference: R16F carries 11 significant bits, so byte-vs-float IS the byte's error as drawn (wave-quant.mjs
predicts it per texel).
INTERIOR: the land mask's paint lands at different moments (#408), so a coastline can differ between runs, and when both runs of
one lever got the same coast the quiet mask cannot see it. The headline comparison is therefore over the wash INTERIOR: inside the
map (x 200-1030, y 90-800: no sidebar or weather panel), not land-coloured in ANY of the four runs (the fallback basemap's land
is one flat colour per theme, LAND below, read from this harness's world and calm shots), and more than EDGE px from any such
pixel (the anti-aliased coast band).
SAME GRID ONLY: which grid a view commits is timing-dependent (the calm view held the world grid in one run and a 29 x 24
dynamic grid in another), so every pair compared must have held the same grid and valid time (record.json, each shot's `engine`);
a pair that did not is skipped and named.
Usage:  python wave_float_stats.py <scn output dir> [--json out.json]     (Pillow + numpy: the backend venv has both)
"""
import json
import os
import sys

import numpy as np
from PIL import Image

TOL = 2
EDGE = 3
CROP = (slice(90, 800), slice(200, 1030))
LAND = {"light": (255, 255, 255), "beach": (237, 232, 226), "dark": (66, 77, 92)}   # the fallback basemap's land, as drawn
THEMES = ("light", "beach", "dark")
VIEWS = ("world", "regional", "coastal", "calm")


def load(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)


def lab(rgb):
    """sRGB 0-255 (..., 3) -> CIELAB, D65."""
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def de2000(a, b):
    """CIEDE2000 between two CIELAB arrays (..., 3); kL = kC = kH = 1."""
    L1, a1, b1 = a[..., 0], a[..., 1], a[..., 2]
    L2, a2, b2 = b[..., 0], b[..., 1], b[..., 2]
    Cb = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    G = 0.5 * (1 - np.sqrt(Cb ** 7 / (Cb ** 7 + 25.0 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    dh = np.where(C1p * C2p == 0, 0, np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh)))
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    hbp = np.where(C1p * C2p == 0, hs, np.where(np.abs(h1p - h2p) <= 180, hs / 2, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2)))
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + 0.32 * np.cos(np.radians(3 * hbp + 6))
         - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    dth = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25.0 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dth)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def shot(out, theme, view, v):
    p = os.path.join(out, f"{theme}-{view}-{v}-wash.png")
    return load(p) if os.path.exists(p) else None


def interior(shots, theme):
    """Pixels that are wash (not the basemap's flat land colour) in every run, EDGE px clear of land in any of them."""
    land_rgb = np.array(LAND[theme], dtype=np.float64)
    land = np.zeros(shots[0][CROP].shape[:2], bool)
    for im in shots:
        land |= np.abs(im[CROP] - land_rgb).max(axis=2) <= 3
    grown = land.copy()
    for dy in range(-EDGE, EDGE + 1):
        for dx in range(-EDGE, EDGE + 1):
            grown |= np.roll(np.roll(land, dy, axis=0), dx, axis=1)
    m = np.zeros(shots[0].shape[:2], bool)
    m[CROP] = ~grown
    return m, [int(x) for x in land_rgb]


def compare(a, b, mask=None):
    d = np.abs(a - b).max(axis=2)
    m = np.ones(d.shape, bool) if mask is None else mask
    moved = m & (d > TOL)
    de = de2000(lab(a[moved]), lab(b[moved])) if moved.any() else np.zeros(1)
    return {"pixels": int(m.sum()), "moved_gt_tol": int(moved.sum()), "max_channel": int(d[m].max()) if m.any() else 0,
            "de00_max": round(float(de.max()), 2), "de00_p99": round(float(np.percentile(de, 99)), 2),
            "de00_mean_moved": round(float(de.mean()), 2)}


def grids(out):
    try:
        with open(os.path.join(out, "record.json"), encoding="utf-8") as fh:
            rec = json.load(fh)
    except OSError:
        return {}
    key = lambda e: "%sx%s %s %s" % (e.get("cols"), e.get("rows"), json.dumps(e.get("bounds"), sort_keys=True), e.get("valid"))
    return {(x["theme"], x["view"], x["variant"]): key(x.get("engine") or {}) for x in rec.get("shots", [])}


def main(out, json_out=None):
    report, g = {}, grids(out)
    for theme in THEMES:
        for view in VIEWS:
            s = {v: shot(out, theme, view, v) for v in ("v2@u8", "v2@u8b", "v2", "v2b")}
            same = lambda a, b: s[a] is not None and s[b] is not None and g.get((theme, view, a)) == g.get((theme, view, b))
            pair = next(((a, b) for a in ("v2@u8", "v2@u8b") for b in ("v2", "v2b") if same(a, b)), None)
            r = {"grids": {v: g.get((theme, view, v)) for v in s}}
            report[f"{theme}/{view}"] = r
            if pair is None:
                print(f"{theme:5s} {view:8s} no byte/float pair held the same grid: {r['grids']}")
                continue
            quiet = np.ones(s[pair[1]].shape[:2], bool)
            for a, b in (("v2@u8", "v2@u8b"), ("v2", "v2b")):
                if same(a, b):
                    quiet &= np.abs(s[a] - s[b]).max(axis=2) <= TOL
                    r["null_" + ("byte" if a == "v2@u8" else "float")] = compare(s[a], s[b])
            inner, land_rgb = interior([s[v] for v in s if s[v] is not None], theme)
            r.update({"pair": list(pair), "byte_vs_float_quiet": compare(s[pair[0]], s[pair[1]], quiet), "noisy_px": int((~quiet).sum()),
                      "byte_vs_float_interior": compare(s[pair[0]], s[pair[1]], inner & quiet), "land_rgb": land_rgb})
            for a, b in (("v2@u8", "v2@u8b"), ("v2", "v2b")):
                if same(a, b):
                    r["null_" + ("byte" if a == "v2@u8" else "float") + "_interior"] = compare(s[a], s[b], inner)
            x = r["byte_vs_float_quiet"]
            nb, nf = r.get("null_byte", {}), r.get("null_float", {})
            print(f"{theme:5s} {view:8s} {pair[0]} vs {pair[1]}: {x['moved_gt_tol']:7d} px moved of {x['pixels']} quiet (max ch {x['max_channel']}), "
                  f"dE00 max {x['de00_max']} p99 {x['de00_p99']} mean {x['de00_mean_moved']}  | null byte {nb.get('moved_gt_tol')} px "
                  f"(dE max {nb.get('de00_max')}), null float {nf.get('moved_gt_tol')} px (dE max {nf.get('de00_max')}); noisy {r['noisy_px']}"
                  f"  [{g.get((theme, view, pair[1]), '?').split(' ')[0]}]")
            y = r["byte_vs_float_interior"]
            print(f"      interior ({y['pixels']} px, land {land_rgb}): {y['moved_gt_tol']} px moved, dE00 max {y['de00_max']} p99 {y['de00_p99']} "
                  f"mean {y['de00_mean_moved']} | null byte {r.get('null_byte_interior', {}).get('moved_gt_tol')} px "
                  f"(max {r.get('null_byte_interior', {}).get('de00_max')}), null float {r.get('null_float_interior', {}).get('moved_gt_tol')} px "
                  f"(max {r.get('null_float_interior', {}).get('de00_max')})")
    if json_out:
        with open(json_out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=1)
    return report


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args[0], args[args.index("--json") + 1] if "--json" in args else None)
