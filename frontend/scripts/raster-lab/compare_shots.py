"""Per-pixel CIEDE2000 between two screenshots of the same view (2026-10-23, own-frames colour parity).

    python compare_shots.py A.png B.png [--box x0,y0,x1,y1] [--null C.png]

Reports dE00 percentiles and the share of pixels over 1, 2 and 5 inside the box (default: the map area right of the side nav,
below the search bar, left of the weather panel at 1280 x 800). --null C.png also reports A vs C, a second screenshot of the
SAME arm, as the noise floor the A vs B numbers are read against. numpy + Pillow (the backend venv).
"""
import sys

import numpy as np
from PIL import Image


def srgb_to_lab(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def de2000(lab1, lab2):
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1 = np.hypot(a1, b1); C2 = np.hypot(a2, b2)
    Cb7 = ((C1 + C2) / 2) ** 7
    G = 0.5 * (1 - np.sqrt(Cb7 / (Cb7 + 25 ** 7)))
    a1p = (1 + G) * a1; a2p = (1 + G) * a2
    C1p = np.hypot(a1p, b1); C2p = np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360; h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp = L2 - L1; dCp = C2p - C1p
    dh = h2p - h1p
    dh = np.where(C1p * C2p == 0, 0, np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh)))
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp = (L1 + L2) / 2; Cbp = (C1p + C2p) / 2
    hs = h1p + h2p
    hbp = np.where(C1p * C2p == 0, hs, np.where(np.abs(h1p - h2p) <= 180, hs / 2, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2)))
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + 0.32 * np.cos(np.radians(3 * hbp + 6))
         - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    dth = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc = 1 + 0.045 * Cbp; Sh = 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dth)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def load(p, box):
    x0, y0, x1, y1 = box
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.float64)[y0:y1, x0:x1]


def report(a, b, box):
    d = de2000(srgb_to_lab(load(a, box)), srgb_to_lab(load(b, box))).ravel()
    q = np.percentile(d, [50, 95, 99, 99.9])
    return {'p50': round(q[0], 2), 'p95': round(q[1], 2), 'p99': round(q[2], 2), 'p99.9': round(q[3], 2), 'max': round(float(d.max()), 2),
            'over1': round(float((d > 1).mean()) * 100, 2), 'over2': round(float((d > 2).mean()) * 100, 2),
            'over5': round(float((d > 5).mean()) * 100, 3), 'pixels': int(d.size)}


if __name__ == '__main__':
    args = sys.argv[1:]
    box = (200, 180, 1030, 800)
    if '--box' in args:
        i = args.index('--box'); box = tuple(int(v) for v in args[i + 1].split(',')); del args[i:i + 2]
    null = None
    if '--null' in args:
        i = args.index('--null'); null = args[i + 1]; del args[i:i + 2]
    print('A vs B   ', report(args[0], args[1], box))
    if null:
        print('A vs null', report(args[0], null, box))
