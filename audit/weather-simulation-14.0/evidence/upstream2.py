import json, urllib.request
B="https://raw-surf-antigravity.onrender.com"; VT="2026-09-20T18:00:00Z"
url=f"{B}/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time={VT}&bbox=-81.0,26.0,-79.0,28.0"
with urllib.request.urlopen(url, timeout=90) as r: d=json.loads(r.read())
V=[v for v in d['grid']['vectors'] if v.get('is_valid')]
print("Raw-Surf served: model=GFS upstream_model=%s cycle=%s ingested=%s"%(d.get('upstream_model'),d.get('model_run_time'),d.get('ingested_at')))
print("Open-Meteo queried with models=ncep_gfswave025 (MATCHED)\n")
pts=V[::max(1,len(V)//6)][:6]
print(f"{'lat':>8}{'lon':>9} | {'RS_ht':>7}{'OM_ht':>7}{'d_ht':>7}{'pct':>7} | {'RS_dir':>7}{'OM_dir':>7}{'d_dir':>7} | {'RS_per':>7}{'OM_per':>7}")
dhs=[]
for v in pts:
    la,lo=v['lat'],v['lng']
    om=(f"https://marine-api.open-meteo.com/v1/marine?latitude={la}&longitude={lo}"
        f"&hourly=wave_height,wave_direction,wave_period&models=ncep_gfswave025"
        f"&start_date=2026-09-20&end_date=2026-09-20&timezone=UTC")
    try:
        with urllib.request.urlopen(om, timeout=60) as r: o=json.loads(r.read())
        h=o['hourly']; i=h['time'].index('2026-09-20T18:00')
        oh,od,op=h['wave_height'][i],h['wave_direction'][i],h['wave_period'][i]
    except Exception as e:
        print(f"{la:8.3f}{lo:9.3f} | OM ERROR {str(e)[:60]}"); continue
    if oh is None: print(f"{la:8.3f}{lo:9.3f} | OM null"); continue
    dh=v['speed']-oh; pct=100*dh/oh if oh else 0; dhs.append(pct)
    dd=((v['direction']-od+180)%360)-180 if od is not None else float('nan')
    print(f"{la:8.3f}{lo:9.3f} | {v['speed']:7.3f}{oh:7.3f}{dh:7.3f}{pct:7.1f} | {v['direction']:7.1f}{od:7.1f}{dd:7.1f} | {v['period']:7.1f}{op:7.1f}")
if dhs:
    import statistics
    print("\nheight %% diff: mean=%.1f%% median=%.1f%% max|%%|=%.1f%%"%(statistics.mean(dhs),statistics.median(dhs),max(abs(x) for x in dhs)))
