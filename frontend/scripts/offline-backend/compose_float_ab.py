"""Owner sheets for the float height A/B (2026-10-20): per theme and view, the byte (today) | the float (this PR) | where they differ.

Reads scn_wave_palette_ab.js output (WASH=1, VARIANTS=v2@u8,v2,v2@u8b,v2b) and writes, per theme and view, a WebP strip of the map
area: the crest-free wash under the float kill (v2@u8, what the app draws today), with the float height (v2), and a difference
map: the float shot in grey with every pixel that moved coloured by its CIEDE2000 distance (yellow 1 -> red 6 -> magenta 12+),
except pixels where one lever's own two runs disagree (the land mask's paint landing at a different moment, labels): those are
run-to-run noise, not the encoding, and are drawn in flat blue.
The byte and float shots compared are a pair that held the same grid (record.json), as wave_float_stats.py requires.
Usage:  python compose_float_ab.py <scn output dir> <out dir>      (Pillow + numpy: the backend venv has both)
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

from wave_float_stats import CROP, TOL, de2000, grids, lab, load, THEMES, VIEWS

STOPS = [(1.0, (250, 214, 60)), (6.0, (226, 40, 30)), (12.0, (200, 30, 200))]


def heat(de):
    """dE00 -> RGB along STOPS (below the first stop: no colour)."""
    out = np.zeros(de.shape + (3,), np.float64)
    for (d0, c0), (d1, c1) in zip(STOPS, STOPS[1:]):
        t = np.clip((de - d0) / (d1 - d0), 0, 1)[..., None]
        seg = (de >= d0)[..., None]
        out = np.where(seg, np.array(c0) + (np.array(c1) - np.array(c0)) * t, out)
    return out


NOISE = (90, 150, 230)


def diff_map(byte, flt, noisy):
    de = de2000(lab(byte), lab(flt))
    grey = flt.mean(axis=2, keepdims=True).repeat(3, axis=2) * 0.55 + 100
    out = np.where((de >= 1.0)[..., None], heat(de), grey)
    return np.where(noisy[..., None], np.array(NOISE, np.float64), out), np.where(noisy, 0, de)


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 8 + 7 * len(text), 22), fill=(0, 0, 0))
    d.text((5, 5), text, fill=(255, 255, 255))
    return im


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    g = grids(src)
    for theme in THEMES:
        for view in VIEWS:
            pair = next(((a, b) for a in ("v2@u8", "v2@u8b") for b in ("v2", "v2b")
                         if g.get((theme, view, a)) and g.get((theme, view, a)) == g.get((theme, view, b))
                         and os.path.exists(os.path.join(src, f"{theme}-{view}-{a}-wash.png"))
                         and os.path.exists(os.path.join(src, f"{theme}-{view}-{b}-wash.png"))), None)
            if pair is None:
                continue
            byte = load(os.path.join(src, f"{theme}-{view}-{pair[0]}-wash.png"))[CROP]
            flt = load(os.path.join(src, f"{theme}-{view}-{pair[1]}-wash.png"))[CROP]
            noisy = np.zeros(byte.shape[:2], bool)
            for a, b in (("v2@u8", "v2@u8b"), ("v2", "v2b")):
                pa, pb = (os.path.join(src, f"{theme}-{view}-{v}-wash.png") for v in (a, b))
                if g.get((theme, view, a)) == g.get((theme, view, b)) and os.path.exists(pa) and os.path.exists(pb):
                    noisy |= np.abs(load(pa)[CROP] - load(pb)[CROP]).max(axis=2) > TOL
            dm, de = diff_map(byte, flt, noisy)
            tiles = [label(Image.fromarray(x.astype(np.uint8)), t) for x, t in
                     ((byte, "today: 8-bit height"), (flt, "this PR: R16F height"), (dm, "differ: dE00 >= 1 (blue: run noise)"))]
            w, h = tiles[0].size
            sheet = Image.new("RGB", (w * 3 + 16, h), (255, 255, 255))
            for i, t in enumerate(tiles):
                sheet.paste(t, (i * (w + 8), 0))
            sheet.save(os.path.join(dst, f"float-{theme}-{view}.webp"), quality=88, method=6)
            print(theme, view, pair, f"px >= 1 dE00 (noise left out): {int((de >= 1).sum())}, max {de.max():.2f}; noise px {int(noisy.sum())}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
