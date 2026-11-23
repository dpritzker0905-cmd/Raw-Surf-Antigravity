"""Hatch discrimination by PATTERN ALONE: luminance only (grayscale), reduced motion on, desktop and 375 px.
Bands G/W [1.0, 1.3] are steady (expect: no pattern), 1.6 is gusty (expect: single hatch), 2.2 very gusty (expect: cross).
Classifier, fixed before looking at the hatch arm: per patch, the 2-D Fourier amplitude at the hatch frequency along each
diagonal (3x3 bins, Hann window, over mean luminance). A diagonal is 'on' above a threshold calibrated on the NO-CUE arm
alone (its patches, every band: max x 1.25). Neither on = steady, one = gusty, both = very gusty.
Direction: the marks' orientation (structure tensor) on the residual frame - session temporal median (the static hatch and
field drop out), hatch arm vs no-cue arm, per band; plus the marks' residual contrast (sd) hatch / no-cue.
Usage: python classify.py <disc dir> <out json>
"""
import json
import sys
from pathlib import Path

import numpy as np

D, OUT = Path(sys.argv[1]), Path(sys.argv[2])
import os
if os.environ.get('HARMONICS') == '1':
    pass
EXPECT = ['steady', 'steady', 'gusty', 'very gusty']


def load(name):
    d = D / name
    m = json.loads((d / 'meta.json').read_text(encoding='utf-8'))
    cw, ch = m['crops']['CW'], m['crops']['CH']
    raw = np.frombuffer((d / 'frames.y8').read_bytes(), dtype=np.uint8)
    t = len(raw) // (4 * cw * ch)
    return m, raw[: t * 4 * cw * ch].reshape(t, 4, ch, cw).astype(np.float64)


def patches(img, P):
    h, w = img.shape
    return [img[r:r + P, c:c + P] for r in range(0, h - P + 1, P) for c in range(0, w - P + 1, P)]


HARM = (1, 2, 3) if __import__('os').environ.get('HARMONICS') == '1' else (1,)   # v1: the fundamental only; v2 (HARMONICS=1): the fundamental and the 2nd and 3rd harmonics


def diag_energy(p, spacing):
    P = p.shape[0]
    x = (p - p.mean()) * np.outer(np.hanning(P), np.hanning(P))
    F = np.abs(np.fft.fft2(x)) / (P * P)
    f = P / (spacing * np.sqrt(2))                      # cycles per patch along x and y for a 45-degree line
    out = []
    for sy in (1, -1):
        for h in HARM:
            if h * f > P / 2 - 2:
                continue
            cy, cx = int(round(sy * h * f)) % P, int(round(h * f)) % P
            out.append(F[np.ix_([(cy + k) % P for k in (-1, 0, 1)], [(cx + k) % P for k in (-1, 0, 1)])].max() / (p.mean() + 1e-3))
    return out


def diag_on(e, thr):
    # each (diagonal, harmonic) has its own no-cue threshold; a diagonal is on if any of its harmonics is
    on = np.array(e) > thr
    n = len(on) // 2
    return np.array([on[:n].any(), on[n:].any()])


def box(img, r):
    k = 2 * r + 1; p = np.pad(img, r, mode='edge'); c = np.pad(p.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def orientation(img):
    g = box(img, 1); gy, gx = np.gradient(g)
    jxx, jyy, jxy = (gx * gx).mean(), (gy * gy).mean(), (gx * gy).mean()
    theta = 0.5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy))        # dominant GRADIENT direction
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-9)
    return (theta + 90.0) % 180.0, float(coh)                         # the streaks run across the gradient


def adiff(a, b):
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def main():
    res = {}
    for view in ('desktop', 'phone'):
        for theme in ('dark', 'light', 'beach'):
            try:
                mn, none = load(f'{view}-{theme}-none'); mh, hat = load(f'{view}-{theme}-hatch')
            except FileNotFoundError:
                continue
            spacing = (14 if view == 'phone' else 10) * mn['DPR']
            P = 64 if view == 'desktop' else 120
            fr_n = range(0, none.shape[0], 4); fr_h = range(0, hat.shape[0], 4)
            e_none = np.array([diag_energy(p, spacing) for k in fr_n for b in range(4) for p in patches(none[k, b], P)])
            thr = e_none.max(axis=0) * 1.25
            bands = []
            med_n, med_h = np.median(none, axis=0), np.median(hat, axis=0)
            for b in range(4):
                cls = []
                for k in fr_h:
                    for p in patches(hat[k, b], P):
                        on = diag_on(diag_energy(p, spacing), thr)
                        cls.append('very gusty' if on.all() else 'gusty' if on.any() else 'steady')
                acc = float(np.mean([c == EXPECT[b] for c in cls]))
                # direction on the marks: residuals, a few frames
                th_n, th_h, sd_n, sd_h, coh_h = [], [], [], [], []
                for k in list(fr_h)[:6]:
                    rn, rh = none[k, b] - med_n[b], hat[k, b] - med_h[b]
                    a1, _ = orientation(rn); a2, c2 = orientation(rh)
                    th_n.append(a1); th_h.append(a2); coh_h.append(c2); sd_n.append(rn.std()); sd_h.append(rh.std())
                # direction 2: where the marks TRAVEL (per-pixel temporal sd over the session): static hatch has none
                tn, _ = orientation(none[:, b].std(axis=0)); thh, coh_t = orientation(hat[:, b].std(axis=0))
                bands.append({'gw': mh['factors'][b], 'expect': EXPECT[b], 'n': len(cls), 'accuracy': acc,
                              'travel_dir_none_deg': tn, 'travel_dir_hatch_deg': thh, 'travel_dir_diff_deg': adiff(tn, thh),
                              'counts': {c: cls.count(c) for c in ('steady', 'gusty', 'very gusty')},
                              'dir_none_deg': float(np.median(th_n)), 'dir_hatch_deg': float(np.median(th_h)),
                              'dir_diff_deg': adiff(float(np.median(th_n)), float(np.median(th_h))),
                              'mark_contrast_ratio': float(np.mean(sd_h) / (np.mean(sd_n) + 1e-9))})
            steady = [c for b in bands[:2] for c in [b]]
            res[f'{view}-{theme}'] = {
                'reduced_motion': bool(mh.get('reducedSeen')), 'threshold': thr.tolist(), 'bands': bands,
                'gusty_accuracy': float(np.mean([bands[2]['accuracy'], bands[3]['accuracy']])),
                'steady_false_rate': float(1 - np.mean([b['accuracy'] for b in steady])),
            }
            r = res[f'{view}-{theme}']
            print(f"{view:7s} {theme:5s} RM={r['reduced_motion']} gusty acc {r['gusty_accuracy']:.3f} steady false {r['steady_false_rate']:.3f} | "
                  + ' | '.join(f"{b['gw']}: acc {b['accuracy']:.2f} dir d {b['dir_diff_deg']:.1f} travel d {b['travel_dir_diff_deg']:.1f} ({b['travel_dir_none_deg']:.0f} deg) marks x{b['mark_contrast_ratio']:.2f}" for b in bands))
    OUT.write_text(json.dumps(res, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
