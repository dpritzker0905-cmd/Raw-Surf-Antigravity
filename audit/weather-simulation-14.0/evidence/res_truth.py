import json, urllib.request
B="https://raw-surf-antigravity.onrender.com"; VT="2026-09-20T18:00:00Z"; BB="-81.0,26.0,-79.0,28.0"
M=json.load(open(r'C:\Users\dprit\AppData\Local\Temp\claude\C--Users-dprit-Raw-Surf\bfea4750-29ea-4c1e-a90e-bacf09717bf8\scratchpad\products.json'))['products']
byid={}
for p in M:
    byid.setdefault(p.get('filename') or p.get('product_id'), p)
for m,l in [("EURO","swell_2"),("EURO","wind_waves"),("EURO","waves"),("GFS","waves"),("ICON","swell_1")]:
    url=f"{B}/api/weather/grid?model={m}&domain=marine&layer={l}&valid_time={VT}&bbox={BB}"
    with urllib.request.urlopen(url, timeout=90) as r: d=json.loads(r.read())
    g=d['grid']; V=g.get('vectors') or []
    lats=sorted({round(v['lat'],5) for v in V}); lons=sorted({round(v['lng'],5) for v in V})
    dlat=round(lats[1]-lats[0],5) if len(lats)>1 else None
    dlon=round(lons[1]-lons[0],5) if len(lons)>1 else None
    pid=d.get('product_id'); mp=byid.get(pid,{})
    print(f"--- {m}/{l}")
    print(f"    product_id           : {pid}")
    print(f"    manifest.resolution  : {mp.get('resolution')}   (manifest provider={mp.get('provider')}, region={mp.get('region_id')})")
    print(f"    DELIVERED spacing    : dlat={dlat} dlon={dlon}  (cols={g.get('cols')} rows={g.get('rows')}, n={len(V)})")
    print(f"    response.resolution  : {d.get('resolution')}   coverage_scope={d.get('coverage_scope')} coverage_mode={d.get('coverage_mode')}")
    print(f"    upstream             : provider={d.get('provider')} upstream_model={d.get('upstream_model')} source_dataset={d.get('source_dataset')}")
    print(f"    stale={d.get('stale')} staleReason={d.get('staleReason')} fallbackReason={d.get('fallbackReason')} partial={d.get('partial_coverage')}")
    print(f"    run_time={d.get('run_time')} model_run_time={d.get('model_run_time')} ({d.get('model_run_time_status')}) ingested_at={d.get('ingested_at')}")
    print()
