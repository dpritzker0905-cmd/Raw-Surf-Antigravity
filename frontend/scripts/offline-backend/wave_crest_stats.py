"""Crests under the 16 m height encoding (2026-10-20): are they unchanged where the sea is below 10 m?

Reads scn_wave_palette_ab.js output taken with CRESTS=1 WASH=1 VARIANTS=v2@10,v2,v2@10b,v2b (v2@10 = the 16 m kill, #411 exactly;
v2@10b and v2b = each lever again, the null controls). Per theme:
  * the WASH comparison: each view's crest-free shot, v2@10 against v2, pixel for pixel. Pixels where the two washes agree to
    within TOL (max channel) are "below 10 m" (under 10 m the only difference is the encoder's 8-bit step, 10/255 -> 16/255 m);
    the rest is the storm's eye, where the 16 m table draws what the 10 m one could not. Dark must agree EVERYWHERE (0 pixels);
  * the CREST comparison, in the regional burst: a crest pixel is one that differs from the same run's crest-free frame by more
    than CREST (max channel). Coverage (crest pixels / masked pixels) and the mean crest colour, per frame, in the below-10 m mask
    and in the eye. Pixels where the two null runs' crest-free frames disagree (labels, markers: run-to-run rendering noise) are
    left out of both masks. Coverage BREATHES with the wave sets (6.6-7.4% within one 7 s light burst, 2026-10-20), so a burst
    must span several cycles (CREST_FRAMES=90) and "unchanged" means the 10 m and 16 m runs differ by no more than two runs of
    the same lever do.
Usage:  python wave_crest_stats.py <scn output dir> [--json out.json]     (Pillow + numpy: the backend venv has both)
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

TOL, CREST = 4, 24
VARIANTS = ("v2@10", "v2@10b", "v2", "v2b")


def load(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)


def wash_compare(out, theme, a="v2@10", b="v2"):
    rows = {}
    for f in sorted(glob.glob(os.path.join(out, f"{theme}-*-{a}-wash.png"))):
        view = os.path.basename(f)[len(theme) + 1:].split("-")[0]
        g = os.path.join(out, f"{theme}-{view}-{b}-wash.png")
        if not os.path.exists(g):
            continue
        d = np.abs(load(f) - load(g)).max(axis=2)
        rows[view] = {"pixels": int(d.size), "differ": int((d > 0).sum()), "differ_gt_tol": int((d > TOL).sum()), "max": int(d.max())}
    return rows


def crest_frames(out, theme, v):
    wash = os.path.join(out, f"crest-{theme}-{v}-wash.png")
    frames = sorted(f for f in glob.glob(os.path.join(out, f"crest-{theme}-{v}-*.png")) if not f.endswith("-wash.png"))
    return (load(wash), [load(f) for f in frames]) if os.path.exists(wash) and frames else (None, [])


def crest_stats(wash, frames, mask):
    cov, col = [], []
    n = max(1, int(mask.sum()))
    for fr in frames:
        c = (np.abs(fr - wash).max(axis=2) > CREST) & mask
        cov.append(float(c.sum()) / n)
        if c.any():
            col.append(fr[c].mean(axis=0))
    col = np.array(col) if col else np.zeros((1, 3))
    return {"coverage_mean": float(np.mean(cov)) if cov else 0.0, "coverage_sd": float(np.std(cov)) if cov else 0.0,
            "colour_mean": [round(float(x), 1) for x in col.mean(axis=0)], "frames": len(frames), "mask_px": n}


def main(out, json_out=None):
    report = {}
    for theme in ("light", "beach", "dark"):
        w = wash_compare(out, theme)
        if not w and not glob.glob(os.path.join(out, f"crest-{theme}-*-wash.png")):
            continue   # neither view shots (WASH=1) nor a crest burst (CRESTS=1) for this theme
        r = {"wash_v2@10_vs_v2": w, "wash_v2@10_vs_v2@10b": wash_compare(out, theme, "v2@10", "v2@10b")}
        washes = {v: crest_frames(out, theme, v)[0] for v in VARIANTS}
        if washes["v2@10"] is not None and washes["v2"] is not None:
            d16 = np.abs(washes["v2@10"] - washes["v2"]).max(axis=2)
            quiet = np.ones(d16.shape, bool)   # leave out pixels the same lever renders differently from run to run
            for a, b in (("v2@10", "v2@10b"), ("v2", "v2b")):
                if washes[a] is not None and washes[b] is not None:
                    quiet &= np.abs(washes[a] - washes[b]).max(axis=2) <= TOL
            low, eye = quiet & (d16 <= TOL), quiet & (d16 > TOL)
            r["below10_mask_px"], r["eye_mask_px"], r["noisy_px"] = int(low.sum()), int(eye.sum()), int((~quiet).sum())
            for v in VARIANTS:
                wash, frames = crest_frames(out, theme, v)
                if wash is None:
                    continue
                r[f"crests/{v}"] = {"below10": crest_stats(wash, frames, low), "eye": crest_stats(wash, frames, eye)}
            m = {v: r[f"crests/{v}"]["below10"]["coverage_mean"] for v in VARIANTS if f"crests/{v}" in r}
            if len(m) == 4:
                r["coverage_between_encodings"] = abs((m["v2"] + m["v2b"]) / 2 - (m["v2@10"] + m["v2@10b"]) / 2)
                r["coverage_within_lever"] = max(abs(m["v2"] - m["v2b"]), abs(m["v2@10"] - m["v2@10b"]))
        report[theme] = r
        print(f"\n=== {theme.upper()}")
        for k in ("wash_v2@10_vs_v2", "wash_v2@10_vs_v2@10b"):
            for view, x in r[k].items():
                print(f"  {k:22s} {view:9s} pixels differing {x['differ']:7d} of {x['pixels']} (> {TOL}: {x['differ_gt_tol']}), max {x['max']}")
        if "below10_mask_px" in r:
            print(f"  crest burst (regional): below-10 m mask {r['below10_mask_px']} px, eye {r['eye_mask_px']} px, left out as run-to-run noise {r['noisy_px']} px")
            for v in VARIANTS:
                if f"crests/{v}" in r:
                    a, e = r[f"crests/{v}"]["below10"], r[f"crests/{v}"]["eye"]
                    print(f"  crests {v:7s} below 10 m: coverage {a['coverage_mean'] * 100:.3f}% +- {a['coverage_sd'] * 100:.3f} colour {a['colour_mean']}"
                          f"   eye: {e['coverage_mean'] * 100:.3f}% colour {e['colour_mean']}  ({a['frames']} frames)")
            if "coverage_between_encodings" in r:
                print(f"  below 10 m: 10 m vs 16 m runs differ by {r['coverage_between_encodings'] * 100:.3f} points of coverage; two runs of one lever by up to {r['coverage_within_lever'] * 100:.3f}")
    if json_out:
        with open(json_out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=1)
    return report


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args[0], args[args.index("--json") + 1] if "--json" in args else None)
