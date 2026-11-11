import json, numpy as np
B = __import__('os').environ.get('JAC1_MOP_DIR', 'jac1_mop_work/')
spots=json.load(open(B+'spots.json')); R=json.load(open(B+'binned.json'))
def wrap(a): return np.abs((a+180)%360-180)
def fchain(th):
    a=np.cos(np.radians(th)); return 0.55+0.45*(0.10+0.90*np.maximum(0,a))
def ftaper(th,E):
    f=fchain(th); return np.where(th>90,np.clip((E-th)/(E-90),0,1)*0.595,f)
cent=np.arange(5,180,10)
out={}
for s in spots:
    m=np.load(B+f"dl/npz/{s['mop']}.npz"); b=np.load(B+f"dl/npz/{s['buoy']}.npz")
    ok=(b['fl']==1)&np.isfinite(b['hs'])&np.isfinite(b['dp'])
    idx={int(t):i for i,t in enumerate(b['t'].astype(np.int64)) if ok[i]}
    I=np.array([idx[int(t)] for t in m['t'].astype(np.int64) if int(t) in idx]); J=np.array([j for j,t in enumerate(m['t'].astype(np.int64)) if int(t) in idx])
    hb=b['hs'][I]; dp=b['dp'][I]; hm=m['hs'][J]; g=(hb>=0.5)&np.isfinite(hm)&(hm>0)
    th=wrap(dp[g]-s['normal']); thm=wrap(dp[g]-s['mop_meta']['metaShoreNormal'])
    frac=float((th>90).mean()); be=th[th>90]
    rec=dict(frac_hours_beyond90=frac, median_dtheta_beyond90=float(np.median(be)) if len(be) else None, p90_dtheta_beyond90=float(np.percentile(be,90)) if len(be) else None,
             frac_hours_beyond90_mopnormal=float((thm>90).mean()))
    if len(be):
        md=rec['median_dtheta_beyond90']
        for E in (120,150,180):
            rec[f'drop_pct_at_median_E{E}']=float(100*(1-ftaper(md,E)/0.595))
            rec[f'mean_drop_pct_all_beyond90_hours_E{E}']=float(100*(1-np.mean(ftaper(be,E))/0.595))
        sp=[x for x in R['variants']['all']['spots'] if x['name']==s['name']][0]
        k=int(min(md//10,17)); rec['MOP_A_at_median_bin']=sp['A'][k]; rec['MOP_n_at_median_bin']=sp['n'][k]
    out[s['name']]=rec
    print(f"{s['name']:24s} frac>90={frac:.2f} (mopN {rec['frac_hours_beyond90_mopnormal']:.2f}) med={rec['median_dtheta_beyond90']} " + (f"E120 {rec['drop_pct_at_median_E120']:.0f}% E180 {rec['drop_pct_at_median_E180']:.0f}% MOP_A {rec['MOP_A_at_median_bin']:.2f}" if len(be) else ''))
# pooled constant floor beyond 90
for v in R['variants']:
    P=R['variants'][v]['pooled']['bins']; bb=[p for p in P if p['bin']>90]
    c=sum(p['n']*p['A_wmean'] for p in bb)/sum(p['n'] for p in bb)
    # pooled mse of constant c over bins>=85 using spot-level data
    pool=[(sp['n'][i],sp['A'][i],cent[i]) for sp in R['variants'][v]['spots'] for i in range(18) if cent[i]>=85 and sp['n'][i]>=30 and sp['A'][i] is not None]
    def mse(fn): w=np.array([p[0] for p in pool],float); return float(np.sum(w*(np.array([p[1] for p in pool])-np.array([fn(p[2]) for p in pool]))**2)/w.sum())
    best=min(np.arange(0.40,0.90,0.005),key=lambda c2: mse(lambda t: fchain(t) if t<90 else c2))
    print(v,'weighted mean A beyond 90:',round(c,3),'best const floor beyond90:',round(best,3),'mse',round(mse(lambda t: fchain(t) if t<90 else best),4),'flat',round(mse(lambda t: float(fchain(t))),4))
    R['variants'][v]['pooled']['wmean_A_beyond90']=c; R['variants'][v]['pooled']['best_constant_floor_beyond90']=float(best); R['variants'][v]['pooled']['mse_best_constant']=mse(lambda t: fchain(t) if t<90 else best)
    # leave-out sensitivities: excluding La Jolla Shores & Capitola (focusing anomalies)
    pool2=[(sp['n'][i],sp['A'][i],cent[i]) for sp in R['variants'][v]['spots'] if sp['name'] not in ('La Jolla Shores','Capitola','Sands Beach') for i in range(18) if cent[i]>=85 and sp['n'][i]>=30 and sp['A'][i] is not None]
    pool=pool2
    errs={E:mse(lambda t,E=E: float(ftaper(t,E))) for E in (90,120,150,180)}
    print('  excl LJS/Capitola/Sands: flat',round(mse(lambda t: float(fchain(t))),4),{k:round(x,4) for k,x in errs.items()})
    R['variants'][v]['pooled']['excl_focusing_spots']=dict(mse_flat=mse(lambda t: float(fchain(t))),mse_by_E={str(k):x for k,x in errs.items()})
R['losers']=out
json.dump(R,open(B+'binned.json','w'),indent=1)
