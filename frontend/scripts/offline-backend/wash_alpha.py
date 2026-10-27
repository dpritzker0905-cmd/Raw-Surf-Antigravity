"""WASH ALPHA FIT (2026-10-20): how opaque the real engine drew the light/beach wave-height wash, per view, read off the paired
crest-off frames of scn_wash_alpha.js, against the alpha the colour checkers assume (../wind-color/wave-lib.mjs ALPHAS).

Inputs: <ab dir> (scn_wash_alpha.js: clipw-<theme>-<variant>-<view>-NN.png, bare-<theme>-<view>.png, record.json) and <lut.json>
(../wind-color/wash-lut.mjs: each palette's wash BEFORE its alpha, rows [h, lighting, R, G, B], wave-lib's composite at a = 1).

1. Ground: the bare basemap per view (Waves off), its modal colour (the water), vs wave-lib's BASEMAP water.
2. One alpha per view (the way crest_by_height.py calibrate() fits dark's): each candidate a lays the LUT as lit * a + water * (1 - a)
   over THIS view's measured water; every sampled wash colour takes its nearest row (CIELAB), residual in CIEDE2000. The sea set is
   fixed across candidates (pixels within --sea dE00 of SOME candidate's ramp: land, labels and coast feather drop out), and the
   fitted a minimises the median residual over it. Reported with the residual at wave-lib's ALPHAS, at heatmapZoomOpacity(z), at
   the engine's own read-back (a_eff = heat + washEff * (1 - heat) where BLEND BOTH engaged), and with a height-dependent
   BLEND BOTH ramp (the regional pass fades below 1.4 m: a_eff(h) = 1 - (1 - heat * smoothstep(0.05, 1.4, h)) * (1 - washEff)).
3. Per-pixel effective alpha, model-free (variant `nb` = the same build with window.__RAW_DISABLE_BLEND_BOTH__, the same hour and
   camera): in an nb frame the wash is lit * a_nb + water * (1 - a_nb) with a_nb the read-back u_opacity, so per pixel
   a_eff = a_nb * <c - water, c_nb - water> / |c_nb - water|^2 (where |c_nb - water| >= --signal), binned by the nb frame's height.

Usage (backend venv: numpy + Pillow): python wash_alpha.py <ab dir> <lut.json> [--themes light,beach] [--variants v2,v1,nb]
       [--views world,regional,r55,coastal,close] [--crop 0,0.06,0.93,1] [--sea 4] [--signal 0.08] [--json out.json]
"""
import glob
import json
import os
import sys
from collections import Counter

import numpy as np
from PIL import Image


def opt(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d


# --- colour (encoded sRGB 0..1 -> CIELAB D65; CIEDE2000, Sharma 2005) ---
def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
WHITE = np.array([0.95047, 1.0, 1.08883])


def lab(c):
    xyz = lin(np.asarray(c, dtype=np.float64)) @ M.T / WHITE
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def de2000(a, b):
    L1, a1, b1 = a[..., 0], a[..., 1], a[..., 2]
    L2, a2, b2 = b[..., 0], b[..., 1], b[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    dh = np.where(C1p * C2p == 0, 0, np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh)))
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lpm, Cpm = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    hpm = np.where(C1p * C2p == 0, hs, np.where(np.abs(h1p - h2p) <= 180, hs / 2, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2)))
    T = 1 - 0.17 * np.cos(np.radians(hpm - 30)) + 0.24 * np.cos(np.radians(2 * hpm)) + 0.32 * np.cos(np.radians(3 * hpm + 6)) - 0.20 * np.cos(np.radians(4 * hpm - 63))
    dth = 30 * np.exp(-(((hpm - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lpm - 50) ** 2 / np.sqrt(20 + (Lpm - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cpm, 1 + 0.015 * Cpm * T
    Rt = -np.sin(np.radians(2 * dth)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def nearest(q, ref):
    """Index of the nearest ref row (CIELAB Euclidean) per query row."""
    out = np.empty(len(q), dtype=np.int64)
    rr = (ref ** 2).sum(1)
    for s in range(0, len(q), 4096):
        x = q[s:s + 4096]
        out[s:s + 4096] = (rr[None, :] - 2 * x @ ref.T).argmin(1)
    return out


def load(f, crop):
    im = np.asarray(Image.open(f).convert('RGB'), dtype=np.float64) / 255.0
    h, w = im.shape[:2]
    return im[int(h * crop[1]):int(h * crop[3]), int(w * crop[0]):int(w * crop[2])]


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def zoom_opacity(z):   # heatmapZoomOpacity (marineEngineDecisions.js), the flat curve
    return 0.65 if z <= 3 else 0.65 + (z - 3) / 5 * 0.10 if z <= 8 else 0.75 + (z - 8) / 5 * 0.05 if z <= 13 else 0.80


MODEL_VIEW = {'world': 'world', 'regional': 'regional', 'r55': 'regional', 'coastal': 'coastal', 'close': 'coastal',
              'worldOut': 'world', 'regionalOut': 'regional', 'r55Out': 'regional',
              'calm05': 'coastal', 'calm08': 'coastal', 'calm10': 'coastal', 'calm12': 'coastal', 'calm14': 'coastal',
              'calm05c': 'coastal', 'calm10c': 'coastal', 'calm14c': 'coastal', 'calmCoast': 'coastal', 'calmCoastC': 'coastal'}
CAMERA = {'worldOut': 'world', 'regionalOut': 'regional', 'r55Out': 'r55'}   # zoom-out views reuse these cameras' bare frames


def water_of(f, crop):
    px = np.round(load(f, crop).reshape(-1, 3) * 255).astype(int)
    cnt = Counter(map(tuple, px))
    (c, n), = cnt.most_common(1)
    return np.array(c, dtype=np.float64), n / len(px)


class Fit:
    """Every sampled wash colour against the LUT laid at a candidate alpha over the view's water."""

    def __init__(self, rows, water, colours):
        self.h, self.lit = rows[:, 0], rows[:, 2:5]
        self.w = water / 255.0
        self.keys, self.inv = np.unique(np.round(colours * 255).astype(np.int64) @ np.array([1 << 16, 1 << 8, 1]), return_inverse=True)
        rgb = np.stack([(self.keys >> 16) & 255, (self.keys >> 8) & 255, self.keys & 255], -1) / 255.0
        self.lab = lab(rgb)

    def at(self, a):   # a: scalar or per-row alpha
        a = np.asarray(a, dtype=np.float64).reshape(-1, 1) if np.ndim(a) else a
        ref = lab(np.clip(self.lit * a + self.w * (1 - a), 0, 1))
        k = nearest(self.lab, ref)
        return de2000(self.lab, ref[k]), self.h[k]


def main(ab, lut_path):
    lut = json.load(open(lut_path))
    rec = json.load(open(os.path.join(ab, 'record.json')))
    themes = opt('--themes', 'light,beach').split(',')
    variants = opt('--variants', 'v2,v1,nb').split(',')
    views = opt('--views', 'world,regional,r55,coastal,close').split(',')
    crop = [float(x) for x in opt('--crop', '0,0.06,0.93,1').split(',')]
    sea_max, signal = float(opt('--sea', '4')), float(opt('--signal', '0.08'))
    alphas = np.round(np.arange(0.15, 1.0001, 0.01), 2)   # calm water at z 10 under BLEND BOTH is drawn near 0.3
    # Which LUT palette each theme/variant drew: default v1 for the `v1` variant, else v2. --palette-map overrides per theme/variant,
    # e.g. on dev 5fe62b5f2 (light v2 at 16 m, beach locked on v1 by D-035): light/v2=v2@16,light/nb=v2@16,beach/v2=v1,beach/nb=v1
    pmap = dict(kv.split('=') for kv in opt('--palette-map', '').split(',') if kv)

    def pal_for(theme, v):
        return pmap.get(f'{theme}/{v}', 'v1' if v == 'v1' else 'v2')

    rng = np.random.default_rng(1)
    out = {'alphas_model': lut['alphas'], 'water': {}, 'fit': {}, 'pixel': {}}
    shots = {}
    for s in rec['shots']:
        shots.setdefault((s['theme'], s['variant'], s['view']), []).append(s)

    for theme in themes:
        print(f'\n=== {theme} ===  wave-lib BASEMAP water {lut["basemap"][theme]["water"]}, ALPHAS {lut["alphas"]}')
        for view in views:
            wf = os.path.join(ab, f'bare-{theme}-{view}.png')
            if not os.path.exists(wf) and view in CAMERA:
                wf = os.path.join(ab, f'bare-{theme}-{CAMERA[view]}.png')
            if os.path.exists(wf):
                w, share = water_of(wf, crop)
                out['water'][f'{theme}/{view}'] = {'rgb': w.tolist(), 'share': share}
                print(f'  bare water {view:8s} {tuple(int(x) for x in w)}  ({100 * share:.0f}% of the frame)')
        for v in variants:
            rows = np.array(lut['palettes'][pal_for(theme, v)][theme], dtype=np.float64)
            for view in views:
                sh = shots.get((theme, v, view))
                if not sh:
                    continue
                states = {(s['engine'].get('blend'), s['engine'].get('heat'), s['engine'].get('washEff'), s['engine'].get('cols')) for s in sh}
                if len(states) > 1:   # the resident grid or an opacity changed between this view's frames: keep the first state's frames
                    first = (sh[0]['engine'].get('blend'), sh[0]['engine'].get('heat'), sh[0]['engine'].get('washEff'), sh[0]['engine'].get('cols'))
                    print(f'  [mixed] {v} {view}: {len(states)} engine states {sorted(map(str, states))}; using the first')
                    sh = [s for s in sh if (s['engine'].get('blend'), s['engine'].get('heat'), s['engine'].get('washEff'), s['engine'].get('cols')) == first]
                files = [os.path.join(ab, s['file']) for s in sh]
                e = sh[0]['engine']
                z = e['z']
                water = np.array(out['water'].get(f'{theme}/{view}', {'rgb': lut['basemap'][theme]['water']})['rgb'])
                frames = [load(f, crop) for f in files]
                px = np.concatenate([fr.reshape(-1, 3)[rng.choice(fr.shape[0] * fr.shape[1], min(20000, fr.shape[0] * fr.shape[1]), replace=False)] for fr in frames])
                fit = Fit(rows, water, px)
                R = np.stack([fit.at(a)[0] for a in alphas])           # candidates x unique colours
                sea = R.min(0)[fit.inv] < sea_max                      # fixed sea set (pixels)
                med = np.array([np.median(r[fit.inv][sea]) for r in R])
                best = int(med.argmin())
                heat, wash = e.get('heat'), e.get('washEff')
                eng = (heat + wash * (1 - heat)) if (e.get('blend') and heat is not None and wash is not None) else heat
                a_model = lut['alphas'][MODEL_VIEW[view]]
                cand = {'fitted': float(alphas[best]), 'model': a_model, 'zoom': zoom_opacity(z), 'engine': eng}

                def resid(a):
                    if a is None:
                        return None
                    r = fit.at(a)[0][fit.inv][sea]
                    return {'a': round(float(a), 3), 'median': float(np.median(r)), 'p90': float(np.percentile(r, 90)), 'share2': float((r < 2).mean())}

                res = {k: resid(a) for k, a in cand.items()}
                if e.get('blend') and heat is not None and wash is not None:   # the height-dependent BLEND BOTH ramp
                    a_h = 1 - (1 - heat * ss(0.05, 1.4, rows[:, 0])) * (1 - wash)
                    r = fit.at(a_h)[0][fit.inv][sea]
                    res['blend_h'] = {'a': 'h', 'median': float(np.median(r)), 'p90': float(np.percentile(r, 90)), 'share2': float((r < 2).mean())}
                # the sea's heights at the fitted alpha (what this view shows)
                hh = fit.at(alphas[best])[1][fit.inv][sea]
                out['fit'][f'{theme}/{v}/{view}'] = {'z': z, 'telemetry': e, 'sea_px': int(sea.sum()), 'px': int(len(sea)), 'water': water.tolist(),
                                                    'h_p10_p50_p90': [float(np.percentile(hh, q)) for q in (10, 50, 90)], **res}
                fmt = lambda d: '   -   ' if d is None else f"{d['a'] if isinstance(d['a'], str) else format(d['a'], '.3f')}: {d['median']:.2f}"
                print(f"  {v:3s} {view:8s} z {z:5.2f} blend {str(e.get('blend')):5s} heat {heat} washEff {wash} | sea {100 * sea.mean():3.0f}% "
                      f"h p10/50/90 {np.percentile(hh, 10):.1f}/{np.percentile(hh, 50):.1f}/{np.percentile(hh, 90):.1f} m | median dE00 at "
                      f"fitted {fmt(res['fitted'])}  model {fmt(res['model'])}  zoom {fmt(res['zoom'])}  engine {fmt(res['engine'])}  "
                      f"blend(h) {fmt(res.get('blend_h'))}")

        # 3. per-pixel effective alpha: v2 against the blend-off control at the same hour and camera
        if 'nb' in variants:
            rows = np.array(lut['palettes'][pal_for(theme, 'nb')][theme], dtype=np.float64)   # the control's own table
            for v in [x for x in variants if x != 'nb']:
                for view in views:
                    a_sh, b_sh = shots.get((theme, v, view)), shots.get((theme, 'nb', view))
                    if not a_sh or not b_sh:
                        continue
                    if a_sh[0]['engine'].get('valid') != b_sh[0]['engine'].get('valid'):
                        print(f'  [skip] {v} vs nb {view}: valid times differ ({a_sh[0]["engine"].get("valid")} vs {b_sh[0]["engine"].get("valid")})')
                        continue
                    if pal_for(theme, v) != pal_for(theme, 'nb'):
                        continue   # pair only a variant that draws the control's table
                    ea, eb = a_sh[0]['engine'], b_sh[0]['engine']
                    if ea.get('cols') != eb.get('cols') or ea.get('bounds') != eb.get('bounds'):
                        print(f'  [skip] {v} vs nb {view}: different resident grids ({ea.get("cols")} vs {eb.get("cols")} cols), not the same field')
                        continue
                    water = np.array(out['water'][f'{theme}/{view}']['rgb']) / 255.0
                    ca = np.mean([load(os.path.join(ab, s['file']), crop) for s in a_sh], axis=0)
                    cb = np.mean([load(os.path.join(ab, s['file']), crop) for s in b_sh], axis=0)
                    a_nb = b_sh[0]['engine']['heat']
                    db, da = cb - water, ca - water
                    n2 = (db ** 2).sum(-1)
                    ok = n2 >= signal ** 2
                    a_eff = a_nb * (da * db).sum(-1) / np.maximum(n2, 1e-12)
                    # height under each pixel: the nb frame against the LUT at a_nb
                    fit = Fit(rows, water * 255, cb.reshape(-1, 3))
                    r, h = fit.at(a_nb)
                    r, h = r[fit.inv].reshape(n2.shape), h[fit.inv].reshape(n2.shape)
                    ok &= r < sea_max
                    bins = [0, 0.3, 0.7, 1.0, 1.4, 2, 3, 4, 6, 8, 10.01, 99]
                    line, per = [], []
                    for lo, hi in zip(bins[:-1], bins[1:]):
                        m = ok & (h >= lo) & (h < hi)
                        if m.sum() >= 200:
                            q = np.percentile(a_eff[m], [10, 50, 90])
                            per.append({'lo': lo, 'hi': hi, 'n': int(m.sum()), 'p10': float(q[0]), 'p50': float(q[1]), 'p90': float(q[2])})
                            line.append(f'{lo:g}-{hi:g} m {q[1]:.3f} (n {m.sum()})')
                    alla = a_eff[ok]
                    out['pixel'][f'{theme}/{v}/{view}'] = {'a_nb': a_nb, 'n': int(ok.sum()), 'p50': float(np.median(alla)) if ok.any() else None, 'bins': per}
                    print(f'  per-pixel a_eff {v} vs nb, {view} (a_nb {a_nb}): all {np.median(alla) if ok.any() else float("nan"):.3f} | ' + ' | '.join(line))
    if opt('--json'):
        json.dump(out, open(opt('--json'), 'w'), indent=1)
        print('wrote', opt('--json'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
