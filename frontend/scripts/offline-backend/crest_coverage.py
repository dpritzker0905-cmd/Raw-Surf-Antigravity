"""CREST COVERAGE read off the real engine's PAIRED clip frames (scn_wave_palette_ab.js PAIRED=1): the share of the frame the crests
cover, i.e. pixels that differ from the same instant drawn with the crest pass off (clipw-...) by more than a small step in any
channel. Built for the crest-density change (2026-10-20): the same view and data in two variants (dk = the density kill, v2 = on),
so land and UI cancel in the comparison. Per variant and view: the mean coverage over its frames, the change between variants, and a
null control (first half of one variant's frames against its second half).

Usage (the backend venv has numpy and Pillow):
  python crest_coverage.py <ab dir> [--themes light,beach,dark] [--pairs dk:v2] [--views mid,coastal,close] [--step 10] [--json out]
         [--crop 0,0.06,0.93,1]   (fractions x0,y0,x1,y1 of the clip frame: the right edge holds a sliver of the weather panel)
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load(path, crop):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    im = im.crop((round(crop[0] * w), round(crop[1] * h), round(crop[2] * w), round(crop[3] * h)))
    return np.asarray(im, dtype=np.int16)


def coverage(files, step, crop):
    out = []
    for f in files:
        w = os.path.join(os.path.dirname(f), "clipw-" + os.path.basename(f)[len("clip-"):])
        if not os.path.exists(w):
            continue
        a, b = load(f, crop), load(w, crop)
        out.append(float((np.abs(a - b).max(axis=-1) > step).mean()))
    return out


def main(ab):
    themes = opt("--themes", "light,beach,dark").split(",")
    pairs = [p.split(":") for p in opt("--pairs", "dk:v2").split(",")]
    views = opt("--views", "mid,coastal,close").split(",")
    step = int(opt("--step", "10"))
    crop = [float(x) for x in opt("--crop", "0,0.06,0.93,1").split(",")]
    result = {}
    for theme in themes:
        for view in views:
            at = "" if view == "regional" else "@" + view
            for before, after in pairs:
                row = {}
                for v in (before, after):
                    files = sorted(glob.glob(os.path.join(ab, f"clip-{theme}-{v}{at}-*.png")))
                    cov = coverage(files, step, crop)
                    if not cov:
                        continue
                    half = len(cov) // 2
                    row[v] = {"frames": len(cov), "mean": float(np.mean(cov)), "null": abs(float(np.mean(cov[:half])) - float(np.mean(cov[half:])))}
                if len(row) == 2:
                    b, a = row[before]["mean"], row[after]["mean"]
                    row["change"] = (a - b) / b if b else None
                    print(f"{theme:6s} {view:8s} {before} {100 * b:5.1f}% -> {after} {100 * a:5.1f}% of the frame covered"
                          f"  ({100 * row['change']:+.1f}%)  null {100 * row[before]['null']:.1f} / {100 * row[after]['null']:.1f} pts")
                result[f"{theme}/{view}/{before}:{after}"] = row
    if opt("--json"):
        json.dump(result, open(opt("--json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
