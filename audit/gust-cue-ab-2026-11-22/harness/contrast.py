"""Hatch line contrast against EVERY background the hatch can sit on (WCAG 1.4.11, 3:1).
Backgrounds: the no-hatch stills (gust ramp 0 -> 75 kn under the field, land and sea, no marks), every pixel.
The map canvas blends the premultiplied hatch with ONE, ONE_MINUS_SRC_ALPHA on 8-bit sRGB values, so a line pixel is
  out = ink * a + bg * (1 - a)   (cased: halo first, then the core over it)
The model is checked against the rendered hatch stills before it is used.
Usage: python contrast.py <static dir> [mode: check|search|report <json params>]
"""
import itertools
import json
import sys
from pathlib import Path

import numpy as np

D = Path(sys.argv[1])
MODE = sys.argv[2] if len(sys.argv) > 2 else 'check'


def load(name):
    m = json.loads((D / name / 'meta.json').read_text(encoding='utf-8'))
    a = np.frombuffer((D / name / 'canvas.rgba').read_bytes(), dtype=np.uint8).reshape(m['h'], m['w'], 4)[::-1]
    return a[..., :3].astype(np.float64) / 255.0


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def Y(c):
    l = lin(c)
    return 0.2126 * l[..., 0] + 0.7152 * l[..., 1] + 0.0722 * l[..., 2]


def cr(a, b):
    ya, yb = Y(a), Y(b)
    return (np.maximum(ya, yb) + 0.05) / (np.minimum(ya, yb) + 0.05)


def over(ink, a, bg):
    return np.asarray(ink) * a + bg * (1 - a)


INK_V1 = {'dark': ([1, 1, 1], 0.30), 'light': ([0.04, 0.09, 0.22], 0.34), 'beach': ([0.16, 0.11, 0.05], 0.34)}
CASES = [(v, t) for v in ('desktop', 'phone') for t in ('dark', 'light', 'beach')]


def backgrounds(theme):
    bgs = [load(f'{v}-{theme}-none') for v in ('desktop', 'phone') if (D / f'{v}-{theme}-none').exists()]
    px = np.concatenate([b.reshape(-1, 3) for b in bgs])
    # unique colours (8-bit) keep the search fast and weight every distinct background once
    return np.unique(np.round(px * 255).astype(np.int32), axis=0) / 255.0


def check():
    for v, t in CASES:
        bg, h = load(f'{v}-{t}-none'), load(f'{v}-{t}-hatch')
        ink, a = INK_V1[t]
        pred = over(ink, a, bg)
        diff = np.abs(h - bg).sum(-1)
        core = diff >= np.quantile(diff, 0.95)   # line centres
        err = np.abs(h[core] - pred[core]).mean() * 255
        print(f'{v:7s} {t:5s} model vs rendered line centres: mean |err| {err:.2f} / 255 over {core.sum()} px')


def stats(c):
    return {'min': float(c.min()), 'p1': float(np.quantile(c, 0.01)), 'p5': float(np.quantile(c, 0.05)), 'median': float(np.median(c))}


def cased(bg, core, ac, halo, ah):
    hp = over(halo, ah, bg)                  # the halo ring
    cp = over(core, ac, hp)                  # the core, over the halo
    return cp, hp


def search():
    out = {}
    for t in ('dark', 'light', 'beach'):
        bg = backgrounds(t)
        ink, a0 = INK_V1[t]
        res = {'n_backgrounds': int(len(bg)), 'v1_alpha_only': stats(cr(over(ink, a0, bg), bg))}
        # alpha only: the smallest alpha whose worst background reaches 3:1 (if any)
        best = None
        for a in np.arange(0.30, 1.001, 0.02):
            m = cr(over(ink, a, bg), bg).min()
            if m >= 3.0:
                best = (float(a), float(m)); break
        res['alpha_only_for_3to1'] = best or {'none_reaches_3to1': True, 'at_alpha_1': stats(cr(over(ink, 1.0, bg), bg))}
        # cased: light core / dark halo or dark core / light halo; the lightest weight that holds 3:1 everywhere
        darks = {'dark': [0.0, 0.0, 0.0], 'light': [0.04, 0.09, 0.22], 'beach': [0.16, 0.11, 0.05]}[t]
        lights = {'dark': [1.0, 1.0, 1.0], 'light': [1.0, 1.0, 1.0], 'beach': [1.0, 0.98, 0.92]}[t]
        cands = []
        for core, halo, label in ((lights, darks, 'light core, dark halo'), (darks, lights, 'dark core, light halo')):
            for ac, ah in itertools.product(np.arange(0.5, 1.001, 0.05), np.arange(0.3, 1.001, 0.05)):
                cp, hp = cased(bg, core, ac, halo, ah)
                c_ch = cr(cp, hp).min()
                c_edge = np.maximum(cr(cp, bg), cr(hp, bg)).min()
                if c_ch >= 3.0 and c_edge >= 3.0:
                    cands.append((ac + ah, label, float(ac), float(ah), float(c_ch), float(c_edge)))
        cands.sort()
        res['cased_lightest'] = [dict(zip(('weight', 'style', 'core_alpha', 'halo_alpha', 'min_core_vs_halo', 'min_edge_vs_bg'), c)) for c in cands[:3]]
        out[t] = res
        print(t, json.dumps(res, indent=1))
    (D / 'search.json').write_text(json.dumps(out, indent=1), encoding='utf-8')


if __name__ == '__main__' and MODE in ('check', 'search'):
    {'check': check, 'search': search}[MODE]()


FINAL = {'dark': ([1, 1, 1], 0.58, [0, 0, 0], 0.0), 'light': ([0.04, 0.09, 0.22], 1.0, [1, 1, 1], 0.68),
         'beach': ([0.16, 0.11, 0.05], 1.0, [1, 0.98, 0.92], 0.72)}


def report():
    out = {}
    for t, (core, ac, halo, ah) in FINAL.items():
        bg = backgrounds(t)
        cp, hp = cased(bg, core, ac, halo, ah)
        edge = np.maximum(cr(cp, bg), cr(hp, bg))
        ch = cr(cp, hp) if ah > 0 else cr(cp, bg)
        out[t] = {'n_backgrounds': int(len(bg)), 'edge_vs_background': stats(edge), 'core_vs_halo': stats(ch)}
        print(t, json.dumps(out[t]))
    (D / 'final_model.json').write_text(json.dumps(out, indent=1), encoding='utf-8')


def rendered():
    """Rendered stills (cased hatch everywhere): in every spacing-sized window, the best line pixel's contrast against its own
    background pixel; the worst window over the whole canvas is the number."""
    out = {}
    for v, t in CASES:
        if not (D / f'{v}-{t}-hatch').exists():
            continue
        bg, h = load(f'{v}-{t}-none'), load(f'{v}-{t}-hatch')
        c = cr(h, bg)
        win = 20 if v == 'desktop' else 28            # 2 x the line spacing in device px
        H, W = c.shape
        c = c[: H // win * win, : W // win * win].reshape(H // win, win, W // win, win).max(axis=(1, 3))
        out[f'{v}-{t}'] = stats(c)
        print(v, t, {k: round(x, 2) for k, x in stats(c).items()})
    (D / 'rendered.json').write_text(json.dumps(out, indent=1), encoding='utf-8')


if __name__ == '__main__' and MODE in ('report', 'rendered'):
    {'report': report, 'rendered': rendered}[MODE]()
