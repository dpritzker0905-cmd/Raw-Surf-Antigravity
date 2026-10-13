import json, urllib.request, math, time
B="https://raw-surf-antigravity.onrender.com"
VT="2026-09-20T18:00:00Z"
# Florida east coast, centre 27.0N 80.0W. Halve the span each step ~ one zoom level.
cx,cy=-80.0,27.0
print(f"{'span_deg':>9} {'http':>5} {'t_s':>6} {'res':>7} {'coords':>7} {'cols x rows':>12} {'product_id':<52} {'served_vt':<22} {'sub':>4} {'stale':>5}")
for i in range(8):
    span=8.0/(2**i)
    bb=f"{cx-span/2:.4f},{cy-span/2:.4f},{cx+span/2:.4f},{cy+span/2:.4f}"
    url=f"{B}/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time={VT}&bbox={bb}"
    t0=time.time()
    try:
        with urllib.request.urlopen(url, timeout=90) as r:
            d=json.loads(r.read()); code=r.status
    except Exception as e:
        print(f"{span:9.4f} ERROR {e}"); continue
    dt=time.time()-t0
    g=d.get('grid') or {}
    print(f"{span:9.4f} {code:>5} {dt:6.2f} {str(d.get('resolution')):>7} {str(d.get('coordinate_count')):>7} {str(g.get('cols'))+'x'+str(g.get('rows')):>12} {str(d.get('product_id'))[:52]:<52} {str(d.get('served_valid_time'))[:22]:<22} {str(d.get('frame_substituted')):>5} {str(d.get('stale')):>5}")
