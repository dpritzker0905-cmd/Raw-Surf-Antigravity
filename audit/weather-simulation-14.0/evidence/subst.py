import json, urllib.request, urllib.error
B="https://raw-surf-antigravity.onrender.com"; VT="2026-09-20T18:00:00Z"
BB="-81.0,26.0,-79.0,28.0"
cases=[("ICON","swell_2"),("ICON","swell_1"),("EURO","swell_2"),("EURO","wind_waves"),("GFS","swell_2"),("EURO","waves")]
hdr=f"{'req model':<10}{'req layer':<12}{'http':<6}{'resp.model':<11}{'provider':<12}{'upstream_model':<16}{'product_id':<50}{'stale':<7}{'fallbackReason':<22}{'sub':<6}{'served_vt':<22}"
print(hdr); print('-'*len(hdr))
for m,l in cases:
    url=f"{B}/api/weather/grid?model={m}&domain=marine&layer={l}&valid_time={VT}&bbox={BB}"
    try:
        with urllib.request.urlopen(url, timeout=90) as r: d=json.loads(r.read()); code=r.status
    except urllib.error.HTTPError as e:
        body=e.read()[:200]; print(f"{m:<10}{l:<12}{e.code:<6} BODY={body}"); continue
    except Exception as e:
        print(f"{m:<10}{l:<12}ERR {e}"); continue
    g=d.get('grid') or {}
    nv=len(g.get('vectors') or [])
    valid=sum(1 for v in (g.get('vectors') or []) if v.get('is_valid'))
    print(f"{m:<10}{l:<12}{code:<6}{str(d.get('model')):<11}{str(d.get('provider')):<12}{str(d.get('upstream_model')):<16}{str(d.get('product_id'))[:50]:<50}{str(d.get('stale')):<7}{str(d.get('fallbackReason'))[:22]:<22}{str(d.get('frame_substituted')):<6}{str(d.get('served_valid_time'))[:22]:<22}  n={nv} valid={valid}")
