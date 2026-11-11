import json
B = __import__('os').environ.get('JAC1_MOP_DIR', 'jac1_mop_work/')
R=json.load(open(B+'binned.json'))
V=R['variants']['all']; L=R['losers']
print('| Spot | chain normal | MOP ID (depth, km) | MOP normal | buoy | matched h | h >90° (days) | ref ratio Hs_MOP/Hs_buoy (dθ<'+'30) | best E | MSE flat | MSE E=120 | MSE E=180 |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|')
for s in V['spots']:
    print(f"| {s['name']} | {s['chain_normal']:.1f} | {s['mop']} ({s['mop_depth']:.0f} m, {s['mop_km']:.2f}) | {s['mop_normal']:.1f} | {s['buoy']} | {s['n_matched']} | {s['n_beyond90']} ({s['days_beyond90']}) | {s['ref_ratio']:.2f} | {s['bestE']} | {s['mse_flat']:.4f} | {s['mse_by_E']['120']:.4f} | {s['mse_by_E']['180']:.4f} |")
print()
cols=list(range(45,180,10))
print('| Spot | '+' | '.join(f'{c-5}-{c+5}°' for c in cols)+' |')
print('|---|'+'---|'*len(cols))
for s in V['spots']:
    cells=[]
    for c in cols:
        i=c//10; a=s['A'][i]; n=s['n'][i]
        cells.append('' if n==0 else (f"{a:.2f} ({n})" if n>=30 else f"_{a:.2f} ({n})_"))
    print(f"| {s['name']} | "+' | '.join(cells)+' |')
print('| **chain f(dθ) now** | '+' | '.join(f"{(0.55+0.45*(0.1+0.9*max(0,__import__('math').cos(__import__('math').radians(c))))):.2f}" for c in cols)+' |')
print()
for v in ('all','swell_Tp>=10s'):
    P=R['variants'][v]['pooled']
    print(v, json.dumps({k:round(x,4) for k,x in P['mse_by_E'].items()}), 'flat',round(P['mse_flat'],4),'const',P['best_constant_floor_beyond90'],round(P['mse_best_constant'],4), P['n_spots'],P['n_hours'],P['n_spot_bins'])
    print('| bin | hours | spots | pooled A |'); print('|---|---|---|---|')
    for b in P['bins']: print(f"| {b['bin']-5}-{b['bin']+5}° | {b['n']} | {b['spots']} | {b['A_wmean']:.3f} |")
print()
print('| Spot | share of hours dθ>90 (chain normal / MOP normal) | median dθ when >90 | drop vs today at that dθ, E=120 | E=150 | E=180 | MOP A at that dθ (today 0.595) |')
print('|---|---|---|---|---|---|---|')
for k,x in sorted(L.items(),key=lambda kv:-kv[1]['frac_hours_beyond90']):
    if x['median_dtheta_beyond90'] is None: continue
    print(f"| {k} | {100*x['frac_hours_beyond90']:.0f}% / {100*x['frac_hours_beyond90_mopnormal']:.0f}% | {x['median_dtheta_beyond90']:.0f}° | -{x['drop_pct_at_median_E120']:.0f}% | -{x['drop_pct_at_median_E150']:.0f}% | -{x['drop_pct_at_median_E180']:.0f}% | {x['MOP_A_at_median_bin']:.2f} (n={x['MOP_n_at_median_bin']}) |")
