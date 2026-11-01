"""Wave palette Jacobian, measured (wave-jacobian.mjs lays the colours; this reads them in CAM16-UCS with coloraide).

Columns, per palette and theme, every colour as composited over the theme's water at world alpha unless said:
  length     the ramp's perceptual length (sum of CAM16-UCS dE along the legend axis): how many steps a viewer can tell
             apart, ~ length / 2 at a dE of 2 per distinguishable step
  even       the shortest anchor segment's length over the longest (1 = every legend step looks equally big, Kovesi 2015;
             low = some steps dead, some jumping)
  light      the share of the length carried by lightness (CAM16 J), and whether J falls at every sample (grey-scale and
             colour-blind safety come from here, Crameri et al. 2020)
  cvd        the length a protan / deutan / tritan viewer keeps, the worst of the three, over normal vision
  zoom       how far one height's colour moves from world (alpha 0.65) to coastal zoom (0.77), in legend steps (mean, max)
  swell      the swell lighting's texture inside one frame (lighting 0 vs 1), in legend steps (mean, max)
  water      the basemap water 4% lighter vs 4% darker, in legend steps (mean)
  texel      the largest dE one 8-bit height step (10 m / 255 = 3.9 cm) makes anywhere on the ramp (banding above ~1)
  levels     the heights a viewer can tell apart on screen with the swell texture present: sum over the ramp of each
             sample's step over max(2, the swell texture there)
A legend step = the ramp's length / its number of anchor segments.
"""
import json
import statistics
import sys

from coloraide.everything import ColorAll as Color

KINDS = (("protan", "vienot"), ("deutan", "vienot"), ("tritan", "brettel"))


def de(a, b):
    return Color("srgb", a).delta_e(Color("srgb", b), method="cam16")


def de_cvd(a, b, kind, method):
    return Color("srgb", a).filter(kind, method=method).delta_e(Color("srgb", b).filter(kind, method=method), method="cam16")


def J(c):
    return Color("srgb", c).convert("cam16-jmh")["j"]


def measure(t, anchors):
    base = t["base"]
    n = len(base)
    steps = [de(base[i], base[i + 1]) for i in range(n - 1)]
    length = sum(steps)
    segs = anchors - 1
    per = (n - 1) // segs
    seg_len = [sum(steps[k * per:(k + 1) * per]) for k in range(segs)]
    js = [J(c) for c in base]
    j_share = sum(abs(js[i + 1] - js[i]) for i in range(n - 1)) / length
    j_mono = all(js[i + 1] < js[i] for i in range(n - 1))
    cvd = min(sum(de_cvd(base[i], base[i + 1], k, m) for i in range(n - 1)) / length for k, m in KINDS)
    step = length / segs
    zoom = [de(base[i], t["coastal"][i]) / step for i in range(n)]
    swell = [de(t["lit0"][i], t["lit1"][i]) for i in range(n)]
    water = [de(t["waterUp"][i], t["waterDn"][i]) / 2 / step for i in range(n)]
    texel = max(de(base[i], t["texel"][i]) for i in range(n))
    levels = sum(steps[i] / max(2.0, swell[i]) for i in range(n - 1))
    return {
        "length": length, "even": min(seg_len) / max(seg_len), "seg_len": seg_len, "light": j_share, "light_mono": j_mono,
        "cvd": cvd, "zoom_mean": statistics.mean(zoom), "zoom_max": max(zoom),
        "swell_mean": statistics.mean(swell) / step, "swell_max": max(swell) / step,
        "water": statistics.mean(water), "texel": texel, "levels": levels, "step": step,
    }


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    out = {}
    for theme in ("light", "beach"):
        print(f"\n=== {theme.upper()} (CAM16-UCS; composited over the {theme} water at world alpha; nuisances in legend steps)")
        print(f"{'palette':22} {'length':>6} {'levels':>6} {'even':>5} {'light':>9} {'cvd':>5} {'zoom':>11} {'swell':>11} {'water':>5} {'texel':>5}")
        for pid, p in data["palettes"].items():
            m = measure(p[theme], p["anchors"])
            out.setdefault(pid, {})[theme] = m
            mono = "" if m["light_mono"] else "*"
            print(f"{pid:22} {m['length']:6.1f} {m['levels']:6.1f} {m['even']:5.2f} {m['light']:8.2f}{mono:1} {m['cvd']:5.2f} "
                  f"{m['zoom_mean']:5.2f}/{m['zoom_max']:5.2f} {m['swell_mean']:5.2f}/{m['swell_max']:5.2f} {m['water']:5.2f} {m['texel']:5.2f}")
        print("(* = lightness does not fall at every sample)")
    if "--out" in sys.argv:
        json.dump(out, open(sys.argv[sys.argv.index("--out") + 1], "w", encoding="utf-8"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
