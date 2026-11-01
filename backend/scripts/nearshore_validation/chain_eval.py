"""The REAL surf chain (services.weather_pipeline, defaults, no flag changes) against the measured transfer and the
observation log. Run from backend/ with the BACKEND venv (numpy + the app's code):
  cd backend ; ..\\..\\raw-surf\\backend\\.venv\\Scripts\\python.exe scripts\\nearshore_validation\\chain_eval.py
(any backend venv works; system python silently degrades the chain to offshore Hs, so it is refused below).

Three questions, each with its truth named:
 A. SHELTERING SHAPE. Truth = measured nearshore/offshore total-Hs ratio by offshore swell direction (transfer.json).
    Model = the chain's own direction factor at the beach (_height_exposure_factor x REFRACTION_KR). Compared as
    absolute values AND normalised by each curve's best direction (the shape is what a shadow model must get right).
 B. BREAKING STEP ON NEARSHORE INPUT. For every hold-out pair: chain(offshore partitions), chain(offshore total, the
    served form) and chain(NEARSHORE partitions). Truth here is internal consistency only: if the chain's sheltering
    were right, chain(offshore) ~ chain(nearshore input) (both describe the same surf). NOTE chain(nearshore input)
    re-applies shoaling/exposure to a 10-16 m spectrum, so it is a diagnostic, not a forecast.
 C. OBSERVATION LOG. Truth = observations.csv face heights. Every arm vs the observed range; n is printed.
"""
import csv
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(HERE))
os.chdir(BACKEND)

from config import BEACHES, COMPASS, OUT, PAIRS, STATIONS  # noqa: E402
from services.weather_pipeline import surf_transform  # noqa: E402
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry  # noqa: E402
from transfer import load, match  # noqa: E402

FT = 3.28084


def refuse_degraded():
    g = resolve_surf_geometry(28.3655, -80.5995)
    if g.depth_m is None:
        sys.exit('REFUSED: bathymetry unavailable (wrong venv?); the chain would serve offshore Hs')


def kr():
    return float(os.environ.get('SURF_REFRACTION_KR', surf_transform.REFRACTION_KR))


def part_list(d, i):
    out = []
    for tag, kind in (('sw', 'swell'), ('ws', 'windsea')):
        h, tp, dr = d[f'h_{tag}'][i], d[f'tp_{tag}'][i], d[f'dir_{tag}'][i]
        if np.isfinite(h) and h > 0.05 and np.isfinite(tp) and np.isfinite(dr):
            out.append({'h': float(h), 'tp': float(tp), 'dir': float(dr), 'kind': kind})
    return out


def surf_ft(lat, lng, g, d, i, mode):
    """mode 'parts': partitions; 'total': served form = total Hs with the dominant partition's period+direction."""
    parts = part_list(d, i)
    if not parts:
        return math.nan
    if mode == 'total':
        dom = max(parts, key=lambda p: p['h'])
        h, _ = estimate_surf_at(lat, lng, float(d['hs'][i]), dom['tp'], swell_from_deg=dom['dir'], geometry=g)
    else:
        big = max(parts, key=lambda p: p['h'])
        h, _ = estimate_surf_at(lat, lng, float(d['hs'][i]), big['tp'], swell_from_deg=big['dir'], geometry=g,
                                partitions=parts)
    return (h or 0.0) * FT


def sheltering_shape(transfer, nearshore, lat, lng, g):
    rows = {}
    pr = next(p for p in transfer['pairs'] if p['nearshore'] == nearshore)
    meas = pr['holdout'].get('by_offshore_swell_dir') or pr['explore'].get('by_offshore_swell_dir', {})
    for b, name in enumerate(COMPASS):
        m = meas.get(name, {}).get('total')
        chain = surf_transform._height_exposure_factor(b * 22.5, g.shore_normal_deg) * kr()
        rows[name] = dict(measured_p50=m['p50'] if m else None, n=m['n'] if m else 0, chain_factor=round(chain, 3))
    have = {k: v for k, v in rows.items() if v['measured_p50'] is not None and v['n'] >= 30}
    if have:
        mmax = max(v['measured_p50'] for v in have.values())
        cmax = max(v['chain_factor'] for v in have.values())
        for v in have.values():
            v['measured_shape'] = round(v['measured_p50'] / mmax, 3)
            v['chain_shape'] = round(v['chain_factor'] / cmax, 3)
    return rows


def obs_rows():
    path = HERE / 'observations.csv'
    if not path.exists():
        return []
    with path.open(newline='', encoding='utf-8') as fh:
        return [r for r in csv.DictReader(fh) if r.get('utc_time') and not r['utc_time'].startswith('#')]


def main():
    refuse_degraded()
    transfer = json.loads((OUT / 'transfer.json').read_text(encoding='utf-8'))
    report = dict(defaults_note='chain at repo defaults; no env flag changed', sheltering=[], breaking=[], observations=[])
    off_cache = {}
    for pr in PAIRS:
        sid_o, sid_n = pr['offshore'], pr['nearshore']
        off = off_cache.setdefault(sid_o, load(sid_o))
        near = load(sid_n)
        io, inn = match(off, near)
        yr = np.array([datetime.fromtimestamp(x, timezone.utc).year for x in near['time'][inn]])
        hold = np.isin(yr, transfer['config']['holdout'])
        io, inn = io[hold], inn[hold]
        step = max(1, len(io) // 1500)              # ~1,500 hold-out pairs per beach is plenty for medians
        io, inn = io[::step], inn[::step]
        for name, lat, lng in BEACHES.get(sid_n, []):
            g = resolve_surf_geometry(lat, lng)
            shape = sheltering_shape(transfer, sid_n, lat, lng, g)
            report['sheltering'].append(dict(beach=name, nearshore=sid_n, shore_normal=g.shore_normal_deg,
                                             normal_src=g.shore_normal_src, by_dir=shape))
            served = np.array([surf_ft(lat, lng, g, off, i, 'total') for i in io])
            parts_o = np.array([surf_ft(lat, lng, g, off, i, 'parts') for i in io])
            parts_n = np.array([surf_ft(lat, lng, g, near, j, 'parts') for j in inn])
            with np.errstate(divide='ignore', invalid='ignore'):
                ratio = parts_n / parts_o
            dirs = off['dir_sw'][io]
            by_dir = {}
            for b, cname in enumerate(COMPASS):
                m = np.isfinite(dirs) & (np.round((dirs % 360) / 22.5).astype(int) % 16 == b) & np.isfinite(ratio)
                if m.sum() >= 15:
                    by_dir[cname] = dict(n=int(m.sum()), served_ft_p50=round(float(np.nanmedian(served[m])), 2),
                                         nearshore_input_ft_p50=round(float(np.nanmedian(parts_n[m])), 2),
                                         nearshore_over_offshore_p50=round(float(np.nanmedian(ratio[m])), 3))
            report['breaking'].append(dict(beach=name, nearshore=sid_n, n=int(np.isfinite(ratio).sum()),
                                           served_ft_p50=round(float(np.nanmedian(served)), 2),
                                           offshore_parts_ft_p50=round(float(np.nanmedian(parts_o)), 2),
                                           nearshore_input_ft_p50=round(float(np.nanmedian(parts_n)), 2),
                                           by_offshore_swell_dir=by_dir))
            print(f"{name}: normal {g.shore_normal_deg} ({g.shore_normal_src}); hold-out pairs {int(np.isfinite(ratio).sum())};"
                  f" served p50 {np.nanmedian(served):.1f} ft, offshore-partitions p50 {np.nanmedian(parts_o):.1f} ft,"
                  f" NEARSHORE-input p50 {np.nanmedian(parts_n):.1f} ft")
            for cname, v in shape.items():
                if v.get('measured_shape') is not None:
                    print(f"   {cname:>4}: measured {v['measured_p50']:.2f} (shape {v['measured_shape']:.2f}, n {v['n']})"
                          f"   chain {v['chain_factor']:.2f} (shape {v['chain_shape']:.2f})")
        for ob in obs_rows():
            if ob['nearshore'] != sid_n:
                continue
            t = datetime.fromisoformat(ob['utc_time']).replace(tzinfo=timezone.utc).timestamp()
            jn = int(np.argmin(np.abs(near['time'] - t)))
            jo = int(np.argmin(np.abs(off['time'] - (t - 1800))))
            if abs(near['time'][jn] - t) > 3600:
                report['observations'].append(dict(obs=ob, note='no nearshore record within 1 h'))
                continue
            lat, lng = float(ob['lat']), float(ob['lng'])
            g = resolve_surf_geometry(lat, lng)
            arms = dict(served_total=surf_ft(lat, lng, g, off, jo, 'total'),
                        offshore_partitions=surf_ft(lat, lng, g, off, jo, 'parts'),
                        nearshore_input=surf_ft(lat, lng, g, near, jn, 'parts'))
            lo, hi = float(ob['face_ft_low']), float(ob['face_ft_high'])
            mid = (lo + hi) / 2
            row = dict(obs=ob, buoy_offshore_hs=float(off['hs'][jo]), buoy_nearshore_hs=float(near['hs'][jn]),
                       arms_ft={k: round(v, 2) for k, v in arms.items()},
                       error_vs_mid_ft={k: round(v - mid, 2) for k, v in arms.items()},
                       ratio_vs_mid={k: round(v / mid, 2) for k, v in arms.items()})
            report['observations'].append(row)
            print(f"OBS {ob['utc_time']} {ob['spot']}: observed {lo}-{hi} ft face; " +
                  ', '.join(f'{k} {v:.1f} ft' for k, v in arms.items()))
    (OUT / 'chain_eval.json').write_text(json.dumps(report, indent=1, default=str), encoding='utf-8')
    print(f"wrote {OUT / 'chain_eval.json'}")


if __name__ == '__main__':
    main()
