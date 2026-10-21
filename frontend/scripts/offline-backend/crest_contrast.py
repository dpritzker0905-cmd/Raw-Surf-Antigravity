"""CREST CONTRAST read off the real engine's frames: how far the strongest local features (the crests) stand off the wash
around them, for normal vision and the three dichromats. Model-free: no crest colour, height or position is assumed.

Per frame (scn_wave_palette_ab.js clip frames: the map's central 60% x 70%, no panels), the wash under each pixel is the
PAIRED frame when the harness ran with PAIRED=1 (clipw-...: the same instant with the crest pass off, so the exact wash), else
an estimate by a separable median (15 px across, then 15 px down). The median is biased where crests are big and dense (coastal
zoom: a 6 px ribbon fills much of a 15 px window, 2026-10-20), so prefer the paired run. Each pixel's distance to its wash is
taken as CIEDE2000 in each vision model (coloraide's own simulations, through the lattice wind-color/cvd_lut.py exports) and as
APCA |Lc| (pixel on wash: the brightness contrast every vision keeps, and the cue motion needs). Land (the basemap's land
colour, drawn over the wash) and 8 px around it are left out. Per variant and view, over its frames: the 99th and 99.5th
percentile over sea pixels (a frame's crests are a few per cent of its sea) and the share of sea pixels at >= 15.
Checks: with a paired wash, the share of sea pixels within 1 dE00 of it (the pixels no crest touches; a moved map would show
as a low share); null control, the first and second halves of one variant's frames (other particles, later forecast hours).

Usage (the backend venv has numpy and Pillow):
  python crest_contrast.py <ab dir> <cvd_lut.json> [--pairs c1:sunset,v1:sunset] [--views world,regional,coastal] [--theme beach] [--json out]
         [--crop 0,0.06,0.93,1]   (fractions x0,y0,x1,y1 of the clip frame kept: the clip's right edge holds a sliver of the
                                    weather panel and its top-left corner a chip, the same in every pane but not sea)
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

LAND = {"beach": (237, 232, 226), "light": (255, 255, 255)}
KINDS = ("normal", "protan", "deutan", "tritan", "lc")
M_XYZ = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
WHITE = np.array([0.95047, 1.0, 1.08883])


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab_of_lin(l):
    xyz = (l @ M_XYZ.T) / WHITE
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def de2000(a, b):
    L1, a1, b1 = a[..., 0], a[..., 1], a[..., 2]
    L2, a2, b2 = b[..., 0], b[..., 1], b[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cb = (C1 + C2) / 2
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
    hbp = np.where(C1p * C2p == 0, hs, np.where(np.abs(h1p - h2p) > 180, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2), hs / 2))
    T = 1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25.0 ** 7)) * np.sin(np.radians(60 * np.exp(-(((hbp - 275) / 25) ** 2))))
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def slide(a, axis, k, fn):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (k // 2, k // 2)
    w = np.lib.stride_tricks.sliding_window_view(np.pad(a, pad, mode="edge"), k, axis=axis)
    return fn(w, axis=-1)


def simulate(l, lut, n):
    """Trilinear lookup of a dichromat simulation on the linear-sRGB lattice (lut: n^3 x 3, r-major)."""
    x = np.clip(l, 0, 1) * (n - 1)
    i = np.minimum(np.floor(x).astype(int), n - 2)
    f = x - i
    out = np.zeros_like(l)
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (f[..., 0] if dr else 1 - f[..., 0]) * (f[..., 1] if dg else 1 - f[..., 1]) * (f[..., 2] if db else 1 - f[..., 2])
                out += w[..., None] * lut[((i[..., 0] + dr) * n + (i[..., 1] + dg)) * n + (i[..., 2] + db)]
    return out


def apca_abs(txt, bg):
    """|APCA-W3 Lc| of encoded sRGB 0-1 `txt` over `bg`, per pixel (the formula wave-lib.mjs apcaLc and Leonardo use)."""
    def y(c):
        v = 0.2126729 * c[..., 0] ** 2.4 + 0.7151522 * c[..., 1] ** 2.4 + 0.0721750 * c[..., 2] ** 2.4
        return np.where(v > 0.022, v, v + (0.022 - np.minimum(v, 0.022)) ** 1.414)
    yt, yb = y(txt), y(bg)
    norm = (yb ** 0.56 - yt ** 0.57) * 1.14
    rev = (yb ** 0.65 - yt ** 0.62) * 1.14
    lc = np.where(yb > yt, np.where(norm < 0.1, 0, (norm - 0.027) * 100), np.where(rev > -0.1, 0, (rev + 0.027) * 100))
    return np.where(np.abs(yb - yt) < 0.0005, 0, np.abs(lc))


def load(path, crop):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    im = im.crop((round(crop[0] * w), round(crop[1] * h), round(crop[2] * w), round(crop[3] * h)))
    return np.asarray(im, dtype=np.float64) / 255


def frame_stats(path, luts, n, land, crop, wash_path=None):
    rgb = load(path, crop)
    wash = load(wash_path, crop) if wash_path else slide(slide(rgb, 0, 15, np.median), 1, 15, np.median)
    lp, lw = lin(rgb), lin(wash)
    land_lab = lab_of_lin(lin(np.array(land, dtype=np.float64) / 255))
    on_land = de2000(lab_of_lin(lw), land_lab) < 10
    near_land = slide(slide(on_land, 0, 17, np.max), 1, 17, np.max)
    sea = ~near_land
    out = {"sea_px": int(sea.sum()), "wash": "paired" if wash_path else "median"}
    for kind in KINDS:
        if kind == "lc":
            d = apca_abs(rgb, wash)[sea]
        else:
            a, b = (lp, lw) if kind == "normal" else (simulate(lp, luts[kind], n), simulate(lw, luts[kind], n))
            d = de2000(lab_of_lin(a), lab_of_lin(b))[sea]
            if kind == "normal":
                out["untouched"] = float((d < 1).mean())
        out[kind] = {"p99": float(np.percentile(d, 99)), "p995": float(np.percentile(d, 99.5)), "share15": float((d >= 15).mean())}
    return out


def summarize(frames):
    return {k: {m: float(np.mean([f[k][m] for f in frames])) for m in ("p99", "p995", "share15")} for k in KINDS}


def main(ab, lut_path):
    L = json.load(open(lut_path))
    n = L["n"]
    luts = {k: np.array(L[k]) for k in ("protan", "deutan", "tritan")}
    theme = opt("--theme", "beach")
    pairs = [p.split(":") for p in opt("--pairs", "c1:sunset,v1:sunset").split(",")]
    views = opt("--views", "world,regional,coastal").split(",")
    crop = [float(x) for x in opt("--crop", "0,0.06,0.93,1").split(",")]
    result, cache = {}, {}   # a variant's frames are read once, however many pairs name it
    for view in views:
        at = "" if view == "regional" else "@" + view
        for before, after in pairs:
            row = {}
            for v in (before, after):
                files = sorted(glob.glob(os.path.join(ab, f"clip-{theme}-{v}{at}-*.png")))
                if not files:
                    continue
                if (v, view) not in cache:
                    pairs_w = [os.path.join(os.path.dirname(f), "clipw-" + os.path.basename(f)[len("clip-"):]) for f in files]
                    cache[(v, view)] = [frame_stats(f, luts, n, LAND[theme], crop, w if os.path.exists(w) else None) for f, w in zip(files, pairs_w)]
                frames = cache[(v, view)]
                half = len(frames) // 2
                row[v] = {"frames": len(frames), "wash": frames[0]["wash"], "untouched": float(np.mean([f.get("untouched", 0) for f in frames])),
                          "all": summarize(frames), "first_half": summarize(frames[:half]), "second_half": summarize(frames[half:])}
            result[f"{view}/{before}:{after}"] = row
            if len(row) == 2:
                print(f"\n{view}: {before} (before) vs {after} (after), {row[before]['frames']}/{row[after]['frames']} frames, {row[after]['wash']} wash"
                      f" (sea untouched by crests {100 * row[before]['untouched']:.0f}% / {100 * row[after]['untouched']:.0f}%);"
                      " p99 off the wash, dE00 and APCA |Lc| (null: half vs half)")
                for kind in KINDS:
                    b, a = row[before], row[after]
                    nb = abs(b["first_half"][kind]["p99"] - b["second_half"][kind]["p99"])
                    na = abs(a["first_half"][kind]["p99"] - a["second_half"][kind]["p99"])
                    print(f"  {kind:7s} {b['all'][kind]['p99']:6.1f} -> {a['all'][kind]['p99']:6.1f}   p99.5 {b['all'][kind]['p995']:6.1f} -> {a['all'][kind]['p995']:6.1f}"
                          f"   share >= 15: {100 * b['all'][kind]['share15']:5.2f}% -> {100 * a['all'][kind]['share15']:5.2f}%   null {nb:.1f} / {na:.1f}")
    if opt("--json"):
        json.dump(result, open(opt("--json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
