"""fit_effective_normal.py's method, unchanged, applied to all 77 spots of normals.json."""
import json, os
import numpy as np
S = __import__('os').environ.get('SEN_WORK_DIR', 'sen_work/').rstrip('/') + '/'   # work dir (keep out of git)
DIRS = [S + 'jac1_mop/dl/npz/', S + 'normals/ext/npz/']
OUT = S + 'normals/ext/'
edges = np.arange(0, 181, 10)
cent = edges[:-1] + 5
MINN = 30
SPLIT = 1704067200


def fchain(th):
    th = np.asarray(th, float)
    return 0.55 + 0.45 * (0.10 + 0.90 * np.maximum(0, np.cos(np.radians(th))))


def wrap(a):
    return np.abs((a + 180) % 360 - 180)


def npz(i):
    for d in DIRS:
        if os.path.exists(d + i + '.npz'):
            return np.load(d + i + '.npz')
    raise FileNotFoundError(i)


def load(s):
    m = npz(s['mop'])
    b = npz(s['buoy'])
    ok = (b["fl"] == 1) & np.isfinite(b["hs"]) & np.isfinite(b["dp"])
    idx = {int(t): i for i, t in enumerate(b["t"].astype(np.int64)) if ok[i]}
    sel = [(j, idx[int(t)]) for j, t in enumerate(m["t"].astype(np.int64)) if int(t) in idx]
    J = np.array([a for a, _ in sel])
    Ii = np.array([c for _, c in sel])
    hm, hb, dp, tt = m["hs"][J], b["hs"][Ii], b["dp"][Ii], m["t"][J].astype(np.int64)
    g = np.isfinite(hm) & (hm > 0) & (hb >= 0.5)
    return hm[g] / hb[g], dp[g], tt[g]


def mse(r, dp, normal):
    th = wrap(dp - normal)
    k = np.clip(np.digitize(th, edges) - 1, 0, 17)
    ref_sel = th < 30
    if ref_sel.sum() < MINN:
        ref_sel = th < 60
    if ref_sel.sum() < MINN:
        return None
    ref, fref = float(np.median(r[ref_sel])), float(np.mean(fchain(th[ref_sel])))
    w, a, p = [], [], []
    for i in range(18):
        sel = k == i
        if sel.sum() >= MINN:
            w.append(sel.sum())
            a.append(float(np.median(r[sel])) / ref * fref)
            p.append(float(fchain(cent[i])))
    if not w:
        return None
    w, a, p = np.array(w, float), np.array(a), np.array(p)
    return float(np.sum(w * (a - p) ** 2) / np.sum(w))


def nbins(dp, normal):
    k = np.clip(np.digitize(wrap(dp - normal), edges) - 1, 0, 17)
    return int(sum((k == i).sum() >= MINN for i in range(18)))


def buoy_for(s):
    lat, lng = s['lat'], s['lng']
    if lat >= 40.44: return '168p1'      # Humboldt, north of Cape Mendocino
    if lat >= 38.5: return '094p1'       # Cape Mendocino south to Point Arena
    if lat >= 37.2: return '029p1'       # Sonoma / Marin / SF / San Mateo
    if lat >= 36.0: return '157p1'       # Santa Cruz / Monterey / Big Sur
    if lat >= 34.45: return '071p1'      # Central Coast to Point Conception (no closer deep offshore buoy)
    if lng < -119.06: return '071p1'     # Santa Barbara / Ventura (west of Point Mugu)
    return '067p1'                       # LA / OC / SD (incl. County Line, east of Point Mugu)


spots = json.load(open(S + 'normals/work/normals.json'))
rows = []
for s in spots:
    s = dict(s); s['buoy'] = buoy_for(s)
    r, dp, tt = load(s)
    tr, te = tt < SPLIT, tt >= SPLIT
    curve = {n: mse(r[tr], dp[tr], n) for n in range(360)}
    cands = [(v, n) for n, v in curve.items() if v is not None]
    rec = {k: s[k] for k in ('name', 'spot_id', 'lat', 'lng', 'mop', 'mop_km', 'buoy', 'chain_normal', 'chain_src', 'mop_normal')}
    rec.update(n_train=int(tr.sum()), n_test=int(te.sum()), test_days=int(len(np.unique(tt[te] // 86400))))
    if not cands:
        rec.update(fit_normal=None, usable=False); rows.append(rec); continue
    best, fit = min(cands)
    within = [n for n, v in curve.items() if v is not None and v <= 1.1 * best]
    rec.update(fit_normal=fit, train_min_mse=best, curve_width_deg=len(within),
               bins_train=nbins(dp[tr], fit), bins_test=nbins(dp[te], fit),
               test_chain=mse(r[te], dp[te], s['chain_normal']), test_mop=mse(r[te], dp[te], s['mop_normal']),
               test_fit=mse(r[te], dp[te], fit))
    rec['usable'] = bool(rec['bins_train'] >= 3 and rec['bins_test'] >= 3 and None not in (rec['test_chain'], rec['test_mop'], rec['test_fit']))
    rec['fit_better'] = bool(rec['usable'] and rec['test_fit'] < rec['test_chain'])
    rec['d_fit_chain'] = round(float(wrap(fit - s['chain_normal'])), 1)
    rows.append(rec)
    print(f"{rec['name'][:24]:24s} {rec['buoy']} chain {rec['chain_normal']:6.1f} mop {rec['mop_normal']:6.1f} FIT {fit:4d} w{rec['curve_width_deg']:3d} "
          f"bins {rec['bins_train']}/{rec['bins_test']} | chain {rec['test_chain']} mop {rec['test_mop']} fit {rec['test_fit']} n {rec['n_test']}", flush=True)

ok = [x for x in rows if x.get('usable')]
w = np.array([x['n_test'] for x in ok], float)
summ = {'n_spots': len(rows), 'n_usable': len(ok)}
for k in ('test_chain', 'test_mop', 'test_fit'):
    summ['pooled_' + k] = float(np.sum(w * np.array([x[k] for x in ok])) / w.sum())
summ['fit_better'] = sum(x['test_fit'] < x['test_chain'] for x in ok)
summ['fit_better_than_mop'] = sum(x['test_fit'] < x['test_mop'] for x in ok)
rng = np.random.default_rng(7)
d = np.array([x['test_chain'] - x['test_fit'] for x in ok])
boot = [float(np.sum(w[i] * d[i]) / w[i].sum()) for i in (rng.integers(0, len(ok), len(ok)) for _ in range(5000))]
summ['pooled_improvement'] = float(np.sum(w * d) / w.sum())
summ['ci95'] = [float(v) for v in np.percentile(boot, [2.5, 97.5])]
print(json.dumps(summ, indent=1))
json.dump(rows, open(OUT + 'fit_all.json', 'w'), indent=1)
json.dump(summ, open(OUT + 'summary.json', 'w'), indent=1)
