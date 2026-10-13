import json, urllib.request, time
B="https://raw-surf-antigravity.onrender.com"; VT="2026-09-20T18:00:00Z"
cx,cy=-80.0,27.0
for span in (2.0, 0.5, 0.0625):
    bb=f"{cx-span/2:.4f},{cy-span/2:.4f},{cx+span/2:.4f},{cy+span/2:.4f}"
    url=f"{B}/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time={VT}&bbox={bb}"
    with urllib.request.urlopen(url, timeout=90) as r: d=json.loads(r.read())
    g=d['grid']; vecs=g.get('vectors') or []
    print('=== requested span %.4f  bbox=%s'%(span,bb))
    print('   grid.bounds :', json.dumps(g.get('bounds')))
    print('   coverage    :', json.dumps(d.get('coverage')))
    print('   served_bbox :', json.dumps(d.get('served_bbox')))
    print('   cols x rows :', g.get('cols'),'x',g.get('rows'), ' n_vectors:', len(vecs))
    if vecs:
        v0=vecs[0]
        print('   vector keys :', list(v0) if isinstance(v0,dict) else type(v0))
        print('   v[0]        :', json.dumps(v0)[:240])
        # distinct speeds
        def gv(v,*names):
            for n in names:
                if isinstance(v,dict) and n in v: return v[n]
            return None
        sp=[gv(v,'speed','value','height','u') for v in vecs]
        di=[gv(v,'direction','dir') for v in vecs]
        us=sorted({round(float(s),6) for s in sp if s is not None})
        ud=sorted({round(float(x),6) for x in di if x is not None})
        print('   distinct speeds: %d  -> %s'%(len(us), us[:8]))
        print('   distinct dirs  : %d  -> %s'%(len(ud), ud[:8]))
        lats=sorted({round(float(gv(v,'lat','latitude')),6) for v in vecs if gv(v,'lat','latitude') is not None})
        lons=sorted({round(float(gv(v,'lon','lng','longitude')),6) for v in vecs if gv(v,'lon','lng','longitude') is not None})
        print('   distinct lats: %d %s'%(len(lats), lats[:6]))
        print('   distinct lons: %d %s'%(len(lons), lons[:6]))
        if len(lats)>1: print('   lat spacing: %.5f deg'%(lats[1]-lats[0]))
        if len(lons)>1: print('   lon spacing: %.5f deg'%(lons[1]-lons[0]))
    print()
