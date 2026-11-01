"""CREST CONTRAST BY HEIGHT, read off the real engine's PAIRED frames (scn_wave_palette_ab.js PAIRED=1): crest_contrast.py pools
every crest in a frame, so a storm's few crests drown in the calm sea's many. This bins them by the height of the wash under them.

Per clip frame and its paired wash (clipw-..., the same instant with the crest pass off): each sea pixel's height (and swell lighting)
is read off its wash colour by the nearest row of the wash ramp the checker models for that view (../wind-color/dark-storm-crest.mjs
--lut: h 0-10 m every 0.025 m x lighting 0-1, CIELAB distance; pixels further than --fit dE00 from every row are not this wash: land,
labels, the coast's feather, a ring-filled edge). A crest pixel is one at least --touch dE00 off its wash. Per height bin, per variant:
crest pixels, APCA |Lc| of pixel on wash (median, 90th and 99th percentile: a crest's core is its strongest pixels), the share at
|Lc| >= 15, and colour-blind dE00 (the weakest of protan/deutan/tritan, coloraide's models via ../wind-color/cvd_lut.py), p90.
Controls: bins below the switch must agree between variants (the crests there are byte-identical: the difference is run-to-run noise,
other particles and wave sets), and the fit residual is reported.

Usage (backend venv: numpy + Pillow):
  python crest_by_height.py <ab dir> <lut.json> <cvd_lut.json> [--theme dark] [--variants d1,v2,de] [--views regional,eye,coastal]
         [--bins 0,2,4,5,6,7,8,9,9.75,10.01] [--fit 4] [--touch 4] [--crop 0,0.06,0.93,1] [--json out.json]
"""
import glob
import json
import os
import sys

import numpy as np

from crest_contrast import apca_abs, de2000, lab_of_lin, lin, load, opt, simulate


def realpha(lut_view, water, alpha):
    """The LUT's rows at another wash alpha: the ramp is premultiplied over the water (lit * a + water * (1 - a)), unclamped where
    the checker's model stays inside 0-1, so the lit colour is recovered exactly and re-laid."""
    rows = np.array(lut_view["rows"], dtype=np.float64)
    a0, w = lut_view["alpha"], np.array(water, dtype=np.float64) / 255
    rows[:, 2:5] = np.clip((rows[:, 2:5] - w * (1 - a0)) / a0 * alpha + w * (1 - alpha), 0, 1)
    return rows


def calibrate(lut_view, water, wash_frames):
    """The wash alpha the engine actually drew in this view: heatmapZoomOpacity a, or with BLEND BOTH engaged (a regional tile
    resident over a held coarse base, #425) 1 - (1 - a)(1 - 0.72 a) at storm heights; the coarse fade can dim either. The alpha whose
    ramp fits the paired wash frames best (median dE00 residual over 20k sampled sea pixels). Under a blend the regional pass fades
    below 1.4 m (alpha x smoothstep(0.05, 1.4, h)), so one alpha per view is right for storm heights, not for calm water."""
    rng = np.random.default_rng(1)
    px = np.concatenate([w.reshape(-1, 3)[rng.choice(w.shape[0] * w.shape[1], 7000, replace=False)] for w in wash_frames])
    keys, inv = np.unique(np.round(px * 255).astype(np.int64) @ np.array([1 << 16, 1 << 8, 1]), return_inverse=True)
    lab = lab_of_lin(lin(np.stack([(keys >> 16) & 255, (keys >> 8) & 255, keys & 255], -1) / 255.0))
    best = None
    for a in np.arange(0.50, 0.951, 0.01):
        ref = lab_of_lin(lin(realpha(lut_view, water, a)[:, 2:5]))
        r = de2000(lab, ref[nearest(lab, ref)])[inv]
        med = float(np.median(r[r < 8])) if (r < 8).any() else 99.0
        if best is None or med < best[1]:
            best = (float(a), med, float((r < 4).mean()))
    return best


def nearest(lab, ref_lab):
    best = np.zeros(len(lab), dtype=int)
    for s in range(0, len(lab), 2048):
        best[s:s + 2048] = ((lab[s:s + 2048, None, :] - ref_lab[None, :, :]) ** 2).sum(-1).argmin(1)
    return best


class HeightFit:
    """Nearest wash-ramp row per wash colour (CIELAB distance for the search, the residual re-measured in dE00). A screenshot holds
    far fewer distinct wash colours than pixels, and they repeat frame to frame: each 8-bit colour is searched once and cached."""

    def __init__(self, lut_rows):
        self.rows = np.asarray(lut_rows)
        self.ref_lab = lab_of_lin(lin(self.rows[:, 2:5]))
        self.h = np.full(1 << 24, np.nan, dtype=np.float32)
        self.resid = np.zeros(1 << 24, dtype=np.float32)

    def __call__(self, wash):
        key = np.round(wash * 255).astype(np.int64)
        key = (key[..., 0] << 16) | (key[..., 1] << 8) | key[..., 2]
        todo = np.unique(key[np.isnan(self.h[key])])
        if len(todo):
            rgb = np.stack([(todo >> 16) & 255, (todo >> 8) & 255, todo & 255], -1) / 255.0
            lab = lab_of_lin(lin(rgb))
            best = nearest(lab, self.ref_lab)
            self.h[todo] = self.rows[best, 0]
            self.resid[todo] = de2000(lab, self.ref_lab[best])
        return self.h[key].astype(np.float64), self.resid[key].astype(np.float64)


def main(ab, lut_path, cvd_path):
    lut = json.load(open(lut_path))
    L = json.load(open(cvd_path))
    n, luts = L["n"], {k: np.array(L[k]) for k in ("protan", "deutan", "tritan")}
    theme = opt("--theme", "dark")
    variants = opt("--variants", "d1,v2,de").split(",")
    views = opt("--views", "regional,eye,coastal").split(",")
    bins = [float(x) for x in opt("--bins", "0,2,4,5,6,7,8,9,9.75,10.01").split(",")]
    fit_max, touch = float(opt("--fit", "4")), float(opt("--touch", "4"))
    crop = [float(x) for x in opt("--crop", "0,0.06,0.93,1").split(",")]
    result = {"bins": bins, "fit": fit_max, "touch": touch, "views": {}}
    for view in views:
        at = "" if view == "regional" else "@" + view
        washes = sorted(glob.glob(os.path.join(ab, f"clipw-{theme}-{variants[0]}{at}-*.png")))
        alpha, med, share4 = calibrate(lut["views"][view], lut["water"], [load(w, crop) for w in washes[:3]])
        fit = HeightFit(realpha(lut["views"][view], lut["water"], alpha))
        print(f"\n{view}: wash alpha {alpha:.2f} fits best (model {lut['views'][view]['alpha']:.3f}): median residual {med:.2f} dE00, {100 * share4:.0f}% of pixels within 4")
        result.setdefault("alpha", {})[view] = {"fitted": alpha, "model": lut["views"][view]["alpha"], "median_resid": med, "share4": share4}
        per = {}
        for v in variants:
            files = sorted(glob.glob(os.path.join(ab, f"clip-{theme}-{v}{at}-*.png")))
            acc = {"lc": [], "cvd": [], "h": [], "sea_h": [], "resid": [], "frames": 0}
            for f in files:
                w = os.path.join(os.path.dirname(f), "clipw-" + os.path.basename(f)[len("clip-"):])
                if not os.path.exists(w):
                    continue
                rgb, wash = load(f, crop), load(w, crop)
                lp, lw = lin(rgb), lin(wash)
                lab_w = lab_of_lin(lw)
                h, resid = fit(wash)
                sea = resid < fit_max
                d = de2000(lab_of_lin(lp), lab_w)
                crest = sea & (d >= touch)
                lc = apca_abs(rgb, wash)
                cvd = np.min([de2000(lab_of_lin(simulate(lp, luts[k], n)), lab_of_lin(simulate(lw, luts[k], n))) for k in luts], axis=0)
                acc["lc"].append(lc[crest]); acc["cvd"].append(cvd[crest]); acc["h"].append(h[crest]); acc["sea_h"].append(h[sea])
                acc["resid"].append(resid[sea]); acc["frames"] += 1
            if not acc["frames"]:
                continue
            lc, cvd, hh, sea_h = (np.concatenate(acc[k]) for k in ("lc", "cvd", "h", "sea_h"))
            out = {"frames": acc["frames"], "fit_resid_p90": float(np.percentile(np.concatenate(acc["resid"]), 90)), "bins": []}
            for lo, hi in zip(bins[:-1], bins[1:]):
                m = (hh >= lo) & (hh < hi)
                sea_n = int(((sea_h >= lo) & (sea_h < hi)).sum())
                if m.sum() < 30:
                    out["bins"].append({"lo": lo, "hi": hi, "crest_px": int(m.sum()), "sea_px": sea_n})
                    continue
                x, c = lc[m], cvd[m]
                out["bins"].append({"lo": lo, "hi": hi, "crest_px": int(m.sum()), "sea_px": sea_n, "lc_p50": float(np.median(x)),
                                    "lc_p90": float(np.percentile(x, 90)), "lc_p99": float(np.percentile(x, 99)),
                                    "share15": float((x >= 15).mean()), "cvd_p90": float(np.percentile(c, 90))})
            per[v] = out
        result["views"][view] = per
        print(f"\n{view} ({theme}): crest pixels by the wash's height; APCA |Lc| p50 / p90 / p99, share >= 15, colour-blind dE00 p90"
              + "".join(f"\n  {v}: {per[v]['frames']} frames, fit residual p90 {per[v]['fit_resid_p90']:.2f} dE00" for v in per))
        for k in range(len(bins) - 1):
            line = f"  {bins[k]:5.2f}-{bins[k + 1]:5.2f} m |"
            for v in per:
                b = per[v]["bins"][k]
                line += (f" {v}: {b['crest_px']:7d} px {b['lc_p50']:5.1f} {b['lc_p90']:5.1f} {b['lc_p99']:5.1f} {100 * b['share15']:5.1f}% cvd {b['cvd_p90']:5.1f} |"
                         if "lc_p50" in b else f" {v}: {b['crest_px']:7d} px (too few) |")
            print(line)
    if opt("--json"):
        json.dump(result, open(opt("--json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
