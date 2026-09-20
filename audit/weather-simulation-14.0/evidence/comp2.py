import json, urllib.request
B="https://raw-surf-antigravity.onrender.com"
def J(u,t=150):
    with urllib.request.urlopen(u,timeout=t) as r: return json.loads(r.read())
la,lo=27.86,-80.45; VT="2026-09-20T21:00:00Z"
p=J(f"{B}/api/weather/point?model=GFS&domain=marine&layer=waves&lat={la}&lng={lo}&valid_time={VT}")
print("=== /api/weather/point @ Sebastian Inlet ===")
for k in ['model','provider','upstream_model','value_kind','value_unit','display_unit_hint','speed','direction','period',
          'is_estimated','model_run_time','model_run_time_status','run_time','valid_time','warnings',
          'surf_height_ft','surf','directional_conflict','forecast_confidence','sampled_product_id','source','is_valid']:
    if k in p: print(f"   {k:<24}= {json.dumps(p[k])[:160]}")
print("   ALL KEYS:", list(p))
print()
sr=J(f"{B}/api/weather/spot-ratings?bbox={lo-0.5},{la-0.5},{lo+0.5},{la+0.5}&valid_time={VT}&limit=25")
print("=== /api/weather/spot-ratings ===")
print("   top keys:", list(sr), " count:", sr.get('count'), " source:", sr.get('source'))
for r in (sr.get('spots') or [])[:5]:
    print("   ", json.dumps(r)[:460])
