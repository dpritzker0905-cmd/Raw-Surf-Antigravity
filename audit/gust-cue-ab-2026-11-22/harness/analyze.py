"""Gust cue A/B: legibility metrics from luminance crops (frames.y8), per view x theme x cue.

Each session holds T frames of 4 band crops (CW x CH, relative luminance 0..255) at G/W = 1.0, 1.4, 1.7, 2.3.
Three MATCHED DETECTORS, each run on every arm (so the no-cue arm is the baseline the cue must beat):
  pulse : per-pixel temporal power at the flicker frequency (0.6-1.2 Hz) / power at 1.5-3.0 Hz, mean over inked pixels
  width : mean ACROSS-FLOW run length of inked pixels (px, device), the marks' thickness
  hatch : 2-D Fourier amplitude at the hatch frequency (both diagonals, +-1 bin), / mean luminance (modulation)
Samples: 8 sub-patches per band crop (2 x 4). d' = (mean_gusty - mean_steady) / pooled sd, gusty = 1.7 and 2.3 bands
pooled, steady = 1.0 band; near = the 1.4 band vs 1.0. 'lift' = the cue arm's d' minus the none arm's d' on the same detector.
Usage: python analyze.py <ab dir> <out json>
"""
import json
import sys
from pathlib import Path

import numpy as np

AB = Path(sys.argv[1])
OUT = Path(sys.argv[2])
SUB = (2, 4)   # sub-patch grid: cols x rows


def load(d):
    m = json.loads((d / 'meta.json').read_text(encoding='utf-8'))
    if m.get('fail') or not (d / 'frames.y8').exists():
        return m, None
    cw, ch = m['crops']['CW'], m['crops']['CH']
    raw = np.frombuffer((d / 'frames.y8').read_bytes(), dtype=np.uint8)
    t = len(raw) // (4 * cw * ch)
    arr = raw[: t * 4 * cw * ch].reshape(t, 4, ch, cw).astype(np.float32)
    return m, arr


def box_blur(img, r):
    k = 2 * r + 1
    p = np.pad(img, r, mode='edge')
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def ink_mask(fr):
    bg = box_blur(fr, 15)
    dev = np.abs(fr - bg)
    mad = np.median(dev) + 1e-3
    return dev > max(3.0, 2.5 * mad)


def subpatches(a):
    """a: (..., H, W) -> list of (..., h, w) sub-patches."""
    h, w = a.shape[-2:]
    hs, ws = h // SUB[1], w // SUB[0]
    return [a[..., r * hs:(r + 1) * hs, c * ws:(c + 1) * ws] for r in range(SUB[1]) for c in range(SUB[0])]


def run_length_vertical(mask):
    """mean length of vertical runs of True (across a mostly zonal flow)."""
    m = mask.astype(np.int8)
    d = np.diff(np.pad(m, ((1, 1), (0, 0))), axis=0)
    starts = (d == 1).sum()
    return float(m.sum() / starts) if starts else 0.0


def pulse_feature(seq, dt):
    """seq: (T, h, w). ratio of temporal power 0.6-1.2 Hz vs 1.5-3.0 Hz over pixels that carry ink at some time."""
    x = seq - seq.mean(0, keepdims=True)
    t = x.shape[0]
    win = np.hanning(t)[:, None, None]
    f = np.fft.rfftfreq(t, dt)
    p = np.abs(np.fft.rfft(x * win, axis=0)) ** 2
    lo = (f >= 0.6) & (f <= 1.2)
    hi = (f >= 1.5) & (f <= 3.0)
    active = seq.std(0) > 2.0
    if active.sum() < 20 or not lo.any() or not hi.any():
        return np.nan
    return float(p[lo][:, active].mean() / (p[hi][:, active].mean() + 1e-9))


def hatch_feature(fr, spacing):
    """spacing: px ACROSS the 45-degree lines (the cased hatch, 2026-11-23). The line repeats every spacing * sqrt(2) along x
    and along y; a cased line (dark core, light halo) carries much of its energy in harmonics, so 1st-3rd are summed."""
    h, w = fr.shape
    x = (fr - fr.mean()) * np.outer(np.hanning(h), np.hanning(w))
    F = np.abs(np.fft.fft2(x)) / (h * w)
    per = spacing * np.sqrt(2)
    tot = 0.0
    for sy in (1, -1):
        for k in (1, 2, 3):
            fy, fx = k * h / per, k * w / per
            if fx > w / 2 - 2 or fy > h / 2 - 2:
                continue
            cy, cx = int(round(sy * fy)) % h, int(round(fx)) % w
            tot += F[np.ix_([(cy + j) % h for j in (-1, 0, 1)], [(cx + j) % w for j in (-1, 0, 1)])].max()
    return float(tot / (fr.mean() + 1e-3))


def dprime(g, s):
    g, s = np.asarray(g, float), np.asarray(s, float)
    g, s = g[np.isfinite(g)], s[np.isfinite(s)]
    if len(g) < 2 or len(s) < 2:
        return np.nan
    sd = np.sqrt((g.var(ddof=1) + s.var(ddof=1)) / 2) + 1e-9
    return float((g.mean() - s.mean()) / sd)


def session(d):
    m, arr = load(d)
    if arr is None:
        return {'fail': m.get('fail') or 'no frames'}
    times = np.asarray(m['times'], float) / 1000.0
    dt = float(np.median(np.diff(times))) if len(times) > 2 else 1 / 30
    phone = m['view'] == 'phone'
    spacing = (14 if phone else 10) * m['DPR']   # across the lines (the cased hatch)
    feats = {'pulse': [], 'width': [], 'hatch': [], 'ink': [], 'level': []}
    for b in range(4):
        band = arr[:, b]
        pulse, width, hatch, ink, level = [], [], [], [], []
        for sp in subpatches(band):
            pulse.append(pulse_feature(sp, dt))
            frames = sp[:: max(1, sp.shape[0] // 12)]   # 12 frames per patch for the spatial detectors
            masks = [ink_mask(f) for f in frames]
            width.append(np.mean([run_length_vertical(mk) for mk in masks]))
            ink.append(np.mean([mk.mean() for mk in masks]))
            hatch.append(np.mean([hatch_feature(f, spacing) for f in frames]))
            level.append(float(sp.mean()))
        feats['pulse'].append(pulse); feats['width'].append(width); feats['hatch'].append(hatch); feats['ink'].append(ink); feats['level'].append(level)
    res = {'T': int(arr.shape[0]), 'dt': dt, 'seconds': float(times[-1] - times[0]) if len(times) > 1 else 0,
           'meanY': [float(arr[:, b].mean()) for b in range(4)]}
    for k, v in feats.items():
        res[k] = {'band_means': [float(np.nanmean(x)) for x in v], 'raw': [[float(y) for y in x] for x in v],
                  'd_gusty': dprime(v[2] + v[3], v[0]), 'd_near': dprime(v[1], v[0]), 'd_very': dprime(v[3], v[0])}
    return res


def main():
    out = {}
    for d in sorted(p for p in AB.iterdir() if p.is_dir() and (p / 'meta.json').exists()):
        view, theme, cue = d.name.split('-')
        out.setdefault(view, {}).setdefault(theme, {})[cue] = session(d)
        print(d.name, 'ok' if 'fail' not in out[view][theme][cue] else out[view][theme][cue]['fail'][:120], flush=True)
    # lift over the none arm on each cue's own detector
    own = {'flicker': 'pulse', 'width': 'level', 'hatch': 'hatch'}
    table = []
    for view, th in out.items():
        for theme, arms in th.items():
            base = arms.get('none', {})
            for cue, det in own.items():
                a = arms.get(cue, {})
                if 'fail' in a or not a or 'fail' in base or not base:
                    continue
                sg = (lambda x: abs(x)) if det == 'level' else (lambda x: x)
                def paired(det):
                    # matched sub-patch ratio cue / none (same crop, same field, same palette): the palette cancels
                    r = [np.asarray(a[det]['raw'][b]) / np.maximum(np.asarray(base[det]['raw'][b]), 1e-6) for b in range(4)]
                    return dprime(list(r[2]) + list(r[3]), r[0]), dprime(r[1], r[0]), [float(np.nanmean(x)) for x in r]
                pg, pn, pr = paired(det)
                row = {'view': view, 'paired_d_gusty': pg, 'paired_d_near': pn, 'paired_ratio_by_band': pr, 'theme': theme, 'cue': cue, 'detector': det,
                       'd_gusty': sg(a[det]['d_gusty']), 'd_gusty_none': sg(base[det]['d_gusty']),
                       'lift_gusty': sg(a[det]['d_gusty']) - sg(base[det]['d_gusty']),
                       'runlen_lift': a['width']['d_gusty'] - base['width']['d_gusty'],
                       'd_near': sg(a[det]['d_near']), 'lift_near': sg(a[det]['d_near']) - sg(base[det]['d_near']),
                       'steady_false': a[det]['band_means'][0] - base[det]['band_means'][0],
                       'ink_steady': a['ink']['band_means'][0], 'ink_gusty': (a['ink']['band_means'][2] + a['ink']['band_means'][3]) / 2,
                       'ink_none_gusty': (base['ink']['band_means'][2] + base['ink']['band_means'][3]) / 2}
                table.append(row)
    OUT.write_text(json.dumps({'sessions': out, 'table': table}, indent=1), encoding='utf-8')
    for r in table:
        print(f"{r['view']:8s} {r['theme']:6s} {r['cue']:8s} {r['detector']:6s} PAIRED d'={r['paired_d_gusty']:6.2f} near={r['paired_d_near']:6.2f} "
              f"cue/none by band={[round(x, 3) for x in r['paired_ratio_by_band']]} | unpaired d'={r['d_gusty']:.2f} (none {r['d_gusty_none']:.2f})")


if __name__ == '__main__':
    main()
