import json, numpy as np, math
B = __import__('os').environ.get('JAC1_MOP_DIR', 'jac1_mop_work/')
spots=json.load(open(B+'spots.json'))
Es=[90,100,110,120,130,140,150,160,170,180]
edges=np.arange(0,181,10); cent=edges[:-1]+5
def fchain(th):
    th=np.asarray(th,float); a=np.cos(np.radians(th)); ex=0.10+0.90*np.maximum(0,a); return 0.55+0.45*ex
def ftaper(th,E):
    th=np.asarray(th,float); f=fchain(th)
    if E<=90: return np.where(th>90,0.0,f)
    t=np.clip((E-th)/(E-90),0,1)*0.595
    return np.where(th>90,t,f)
def wrap(a): return np.abs((a+180)%360-180)
res={'bins_deg':edges.tolist(),'E_candidates':Es,'variants':{}}
MINN=30
for variant,tpmin in [('all',0.0),('swell_Tp>=10s',10.0)]:
    out=[]; pool=[]
    for s in spots:
        m=np.load(B+f"dl/npz/{s['mop']}.npz"); b=np.load(B+f"dl/npz/{s['buoy']}.npz")
        bt=b['t'].astype(np.int64); ok=(b['fl']==1)&np.isfinite(b['hs'])&np.isfinite(b['dp'])
        idx={int(t):i for i,t in enumerate(bt) if ok[i]}
        sel=[(j,idx[int(t)]) for j,t in enumerate(m['t'].astype(np.int64)) if int(t) in idx]
        J=np.array([a for a,_ in sel]); I=np.array([c for _,c in sel])
        hm=m['hs'][J]; hb=b['hs'][I]; dp=b['dp'][I]; tp=b['tp'][I]; tt=m['t'][J]
        g=np.isfinite(hm)&(hm>0)&(hb>=0.5)&(tp>=tpmin)
        hm,hb,dp,tt,tp=hm[g],hb[g],dp[g],tt[g],tp[g]
        r=hm/hb; th=wrap(dp-s['normal'])
        k=np.digitize(th,edges)-1; k=np.clip(k,0,17)
        med=[];n=[];days=[];q25=[];q75=[]
        for i in range(18):
            mm=k==i; n.append(int(mm.sum())); days.append(int(len(set((tt[mm]//86400).tolist()))))
            if mm.sum()>0: med.append(float(np.median(r[mm]))); q25.append(float(np.percentile(r[mm],25))); q75.append(float(np.percentile(r[mm],75)))
            else: med.append(None); q25.append(None); q75.append(None)
        ref_rng=30; mm=th<30
        if mm.sum()<MINN: ref_rng=45; mm=th<45
        if mm.sum()<MINN: ref_rng=60; mm=th<60
        ref=float(np.median(r[mm])) if mm.sum()>0 else None
        # chain factor average in reference range, to put A on the f(0)=1 scale consistently
        fref=float(np.mean(fchain(th[mm]))) if mm.sum()>0 else None
        A=[(x/ref*fref if (x is not None and ref) else None) for x in med]
        # fit over bins with center>=85 (80-90 bin onward), n>=MINN
        use=[i for i in range(18) if cent[i]>=85 and n[i]>=MINN and A[i] is not None]
        def sse(fn):
            if not use: return None
            w=np.array([n[i] for i in use],float); a=np.array([A[i] for i in use]); p=np.array([fn(cent[i]) for i in use],float)
            return float(np.sum(w*(a-p)**2)/np.sum(w))
        errs={str(E):sse(lambda c,E=E: float(ftaper(c,E))) for E in Es}
        flat=sse(lambda c: float(fchain(c)))
        bestE=min(Es,key=lambda E: errs[str(E)]) if use else None
        n90=int((th>90).sum())
        rec=dict(name=s['name'],chain_normal=s['normal'],mop=s['mop'],mop_normal=s['mop_meta']['metaShoreNormal'],mop_depth=s['mop_meta']['metaWaterDepth'],mop_km=s['mop_km'],buoy=s['buoy'],
                 n_matched=int(len(r)),n_beyond90=n90,days_beyond90=int(len(set((tt[th>90]//86400).tolist()))),ref_range=ref_rng,ref_ratio=ref,ref_chain_factor=fref,
                 n=n,days=days,median_r=med,q25=q25,q75=q75,A=A,fit_bins=[int(cent[i]) for i in use],mse_flat=flat,mse_by_E=errs,bestE=bestE,
                 hs_buoy_med_beyond90=float(np.median(hb[th>90])) if n90 else None, hs_mop_med_beyond90=float(np.median(hm[th>90])) if n90 else None)
        out.append(rec)
        for i in use: pool.append((s['name'],i,n[i],A[i]))
    # pooled
    def psse(fn):
        w=np.array([p[2] for p in pool],float); a=np.array([p[3] for p in pool]); pr=np.array([fn(cent[p[1]]) for p in pool]); return float(np.sum(w*(a-pr)**2)/np.sum(w))
    perr={str(E):psse(lambda c,E=E: float(ftaper(c,E))) for E in Es}
    pflat=psse(lambda c: float(fchain(c)))
    # pooled per bin weighted-median-ish: count-weighted mean of A
    pbin=[]
    for i in range(18):
        ps=[p for p in pool if p[1]==i]
        if ps: pbin.append(dict(bin=int(cent[i]),n=int(sum(p[2] for p in ps)),spots=len(ps),A_wmean=float(sum(p[2]*p[3] for p in ps)/sum(p[2] for p in ps))))
    # best constant floor beyond 90 for reference
    res['variants'][variant]=dict(spots=out,pooled=dict(mse_flat=pflat,mse_by_E=perr,bestE=min(Es,key=lambda E: perr[str(E)]),n_spot_bins=len(pool),n_hours=int(sum(p[2] for p in pool)),n_spots=len(set(p[0] for p in pool)),bins=pbin))
json.dump(res,open(B+'binned.json','w'),indent=1)
for v,R in res['variants'].items():
    print('=====',v)
    for s in R['spots']:
        print(f"{s['name']:24s} nrm={s['chain_normal']:6.1f} mopN={s['mop_normal']:6.1f} {s['mop']} {s['buoy']} N={s['n_matched']} n>90={s['n_beyond90']} d>90={s['days_beyond90']} ref{s['ref_range']}={s['ref_ratio']:.3f} best={s['bestE']} flat={s['mse_flat']} bestmse={s['mse_by_E'][str(s['bestE'])] if s['bestE'] else None}")
        print('   A:',' '.join(f"{int(c)}:{(a if a is None else round(a,2))}/{nn}" for c,a,nn in zip(cent,s['A'],s['n']) if nn>0))
    P=R['pooled']; print('POOLED',P['bestE'],'flat',round(P['mse_flat'],4),{k:round(v,4) for k,v in P['mse_by_E'].items()},P['n_spots'],P['n_hours'])
    for b in P['bins']: print('  ',b)
