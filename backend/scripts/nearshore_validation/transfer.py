"""MEASURED offshore -> nearshore transfer, by offshore swell direction and period (numpy only; either venv).

  python transfer.py            -> out/transfer.json + a table on stdout

For every PAIR in config: each nearshore record is matched with the offshore record LAG_MIN earlier (within
PAIR_TOLERANCE_MIN). Ratios (nearshore / offshore) of TOTAL Hs, SWELL-partition height and WIND-SEA height, binned by
the OFFSHORE swell partition's direction (16-point) and peak period. Explore and hold-out years are reported apart:
a number that only holds in one of them is not a finding.

CONTROLS (refused if they fail):
  null     - the offshore station paired with ITSELF at lag 0: every ratio must be exactly 1.000;
  positive - the offshore station paired with itself scaled x0.5: every ratio must be exactly 0.500.
"""
import json
import sys
from datetime import datetime, timezone

import numpy as np

from config import (COMPASS, DIR_BIN_DEG, EXPLORE_YEARS, HOLDOUT_YEARS, LAG_MIN, MIN_OFFSHORE_HS, OUT, PAIRS,
                    PAIR_TOLERANCE_MIN, PERIOD_BANDS, STATIONS)


def load(sid):
    return dict(np.load(OUT / f'{sid}_parts.npz'))


def match(off, near, lag_min=LAG_MIN, tol_min=PAIR_TOLERANCE_MIN):
    """Index pairs (i_off, i_near) with |t_near - lag - t_off| <= tol."""
    to, tn = off['time'], near['time'] - lag_min * 60
    j = np.searchsorted(to, tn)
    j0, j1 = np.clip(j - 1, 0, len(to) - 1), np.clip(j, 0, len(to) - 1)
    pick = np.where(np.abs(to[j0] - tn) <= np.abs(to[j1] - tn), j0, j1)
    ok = np.abs(to[pick] - tn) <= tol_min * 60
    return pick[ok], np.where(ok)[0]


def dir_bin(d):
    return np.where(np.isfinite(d), np.round((d % 360) / DIR_BIN_DEG).astype(int) % 16, -1)


_RNG = np.random.default_rng(20261023)
BOOT = 300


def q(x):
    """Quartiles + a bootstrap 95% CI on the median (Reflection review 2026-10-23: report uncertainty)."""
    x = x[np.isfinite(x)]
    if x.size < 6:
        return None
    p25, p50, p75 = np.percentile(x, [25, 50, 75])
    boots = np.median(_RNG.choice(x, size=(BOOT, x.size), replace=True), axis=1) if x.size <= 20000 else None
    ci = [round(float(v), 3) for v in np.percentile(boots, [2.5, 97.5])] if boots is not None else None
    return dict(n=int(x.size), p25=round(float(p25), 3), p50=round(float(p50), 3), p75=round(float(p75), 3),
                p50_ci95=ci)


SEASONS = {'DJF': (12, 1, 2), 'MAM': (3, 4, 5), 'JJA': (6, 7, 8), 'SON': (9, 10, 11)}


def season_table(off, near, io, inn, bins=('NNE', 'NE', 'ENE', 'E', 'ESE')):
    """Direction x season, so a seasonal direction climatology cannot masquerade as a direction effect."""
    r = ratios(off, near, io, inn)['total']
    db = dir_bin(off['dir_sw'][io])
    mo = np.array([datetime.fromtimestamp(x, timezone.utc).month for x in near['time'][inn]])
    out = {}
    for name in bins:
        b = COMPASS.index(name)
        out[name] = {s: q(r[(db == b) & np.isin(mo, ms)]) for s, ms in SEASONS.items()}
    return out


def ratios(off, near, io, inn):
    o_hs, o_sw, o_ws = off['hs'][io], off['h_sw'][io], off['h_ws'][io]
    with np.errstate(divide='ignore', invalid='ignore'):
        return dict(
            total=np.where(o_hs >= MIN_OFFSHORE_HS, near['hs'][inn] / o_hs, np.nan),
            swell=np.where(o_sw >= MIN_OFFSHORE_HS, near['h_sw'][inn] / o_sw, np.nan),
            windsea=np.where(o_ws >= MIN_OFFSHORE_HS, near['h_ws'][inn] / o_ws, np.nan))


def years(t):
    return np.array([datetime.fromtimestamp(x, timezone.utc).year for x in t])


def table(off, near, io, inn):
    r = ratios(off, near, io, inn)
    db = dir_bin(off['dir_sw'][io])
    tp = off['tp_sw'][io]
    turn = (near['dir_sw'][inn] - off['dir_sw'][io] + 180) % 360 - 180
    by_dir = {}
    for b, name in enumerate(COMPASS):
        m = db == b
        if m.sum() < 6:
            continue
        by_dir[name] = {k: q(v[m]) for k, v in r.items()}
        by_dir[name]['swell_turn_deg'] = q(turn[m])
        bands = {}
        for lo, hi in PERIOD_BANDS:
            mm = m & (tp >= lo) & (tp < hi)
            if mm.sum() >= 6:
                bands[f'{lo}-{hi}s'] = {k: q(v[mm]) for k, v in r.items()}
        by_dir[name]['by_period'] = bands
    return dict(n_pairs=int(len(io)), all={k: q(v) for k, v in r.items()}, by_offshore_swell_dir=by_dir)


def controls(off):
    io = inn = np.arange(len(off['time']))
    r = ratios(off, off, io, inn)
    null_ok = all(np.allclose(v[np.isfinite(v)], 1.0) for v in r.values())
    half = {k: (v * 0.5 if k in ('hs', 'h_sw', 'h_ws') else v) for k, v in off.items()}
    r2 = ratios(off, half, io, inn)
    pos_ok = all(np.allclose(v[np.isfinite(v)], 0.5) for v in r2.values())
    pm, pn = match(off, off, lag_min=0)
    match_ok = len(pm) == len(off['time']) and np.array_equal(pm, pn)
    return dict(null_ratio_is_1=bool(null_ok), positive_ratio_is_half=bool(pos_ok), self_match_exact=bool(match_ok))


def main():
    result = dict(config=dict(lag_min=LAG_MIN, tol_min=PAIR_TOLERANCE_MIN, min_offshore_hs=MIN_OFFSHORE_HS,
                              explore=EXPLORE_YEARS, holdout=HOLDOUT_YEARS), pairs=[])
    off_cache = {}
    for pr in PAIRS:
        off = off_cache.setdefault(pr['offshore'], load(pr['offshore']))
        near = load(pr['nearshore'])
        if 'controls' not in result:
            result['controls'] = controls(off)
            print('CONTROLS', result['controls'])
            if not all(result['controls'].values()):
                sys.exit('REFUSED: a control failed; no transfer numbers are reported')
        io, inn = match(off, near)
        yr = years(near['time'][inn])
        entry = dict(label=pr['label'], offshore=pr['offshore'], nearshore=pr['nearshore'],
                     nearshore_name=STATIONS[pr['nearshore']]['name'])
        for split, ys in (('explore', EXPLORE_YEARS), ('holdout', HOLDOUT_YEARS)):
            m = np.isin(yr, ys)
            entry[split] = table(off, near, io[m], inn[m]) if m.sum() else dict(n_pairs=0)
        lag = {}
        for L in (0, 30, 60, 90):
            a, b = match(off, near, lag_min=L)
            v = ratios(off, near, a, b)['total']
            lag[str(L)] = q(v)
        entry['lag_sensitivity_total'] = lag
        entry['by_dir_x_season_all_years'] = season_table(off, near, io, inn)
        result['pairs'].append(entry)
        print(f"\n== {pr['label']}  (explore n {entry['explore']['n_pairs']}, holdout n {entry['holdout']['n_pairs']})")
        print('  season check (total p50 [95% CI], all years):')
        for name, row in entry['by_dir_x_season_all_years'].items():
            cells = [f"{s} {v['p50']:.2f} [{v['p50_ci95'][0]:.2f}-{v['p50_ci95'][1]:.2f}] n{v['n']}" if v and v['p50_ci95']
                     else f'{s} -' for s, v in row.items()]
            print(f'    {name:>4}: ' + '   '.join(cells))
        for split in ('explore', 'holdout'):
            t = entry[split].get('by_offshore_swell_dir', {})
            for name, v in t.items():
                tot, sw = v['total'], v['swell']
                print(f"  {split:8} {name:>4}  total p50 {tot['p50'] if tot else '-':>6} (n {tot['n'] if tot else 0:5})"
                      f"   swell p50 {sw['p50'] if sw else '-':>6}   turn p50 {v['swell_turn_deg']['p50'] if v['swell_turn_deg'] else '-'}")
    OUT.mkdir(exist_ok=True)
    (OUT / 'transfer.json').write_text(json.dumps(result, indent=1), encoding='utf-8')
    print(f"\nwrote {OUT / 'transfer.json'}")


if __name__ == '__main__':
    main()
