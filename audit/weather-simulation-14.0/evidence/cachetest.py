import json, urllib.request, time
B="https://raw-surf-antigravity.onrender.com"; VT="2026-09-20T18:00:00Z"
def get(bb,label):
    url=f"{B}/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time={VT}&bbox={bb}"
    t0=time.time()
    with urllib.request.urlopen(url, timeout=90) as r: d=json.loads(r.read())
    print(f"{label:<26} t={time.time()-t0:5.2f}s cache_hit={str(d.get('cache_hit')):<6} cache_key={str(d.get('cache_key'))[:44]:<44}")
    print(f"{'':26} product_id={d.get('product_id')}")
    print(f"{'':26} model_run_time={d.get('model_run_time')} ({d.get('model_run_time_status')})  run_time={d.get('run_time')}  ingested_at={d.get('ingested_at')}")
    V=d['grid'].get('vectors') or []
    sp=[v['speed'] for v in V if v.get('is_valid')]
    print(f"{'':26} n={len(V)} valid={len(sp)} mean_speed={sum(sp)/len(sp) if sp else None}")
    print()
    return d
print("MANIFEST (19:07Z) says: cycle=2026-09-20T06:00:00Z ingested=2026-09-20T15:39:09Z\n")
a=get("-81.0,26.0,-79.0,28.0","A repeat exact bbox")
b=get("-81.0,26.0,-79.0,28.0","B repeat exact bbox")
c=get("-81.0001,26.0,-79.0,28.0","C cache-busted bbox")
d=get("-81.5,25.5,-78.5,28.5","D wider bbox")
