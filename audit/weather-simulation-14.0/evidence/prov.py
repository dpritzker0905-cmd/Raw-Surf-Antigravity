import json, collections
P=r'C:\Users\dprit\AppData\Local\Temp\claude\C--Users-dprit-Raw-Surf\bfea4750-29ea-4c1e-a90e-bacf09717bf8\scratchpad\products.json'
prods=json.load(open(P))['products']
print("=== model_run_time_status by MODEL ===")
c=collections.Counter((p.get('model'), p.get('model_run_time_status')) for p in prods)
tot=collections.Counter(p.get('model') for p in prods)
for (m,s),n in sorted(c.items(), key=lambda x:(-x[1])):
    print(f"  {str(m):<6} {str(s):<10} {n:>6}  ({100*n/tot[m]:5.1f}% of {m})")
print()
print("=== is_forecast_authoritative ===")
print(" ", collections.Counter(p.get('is_forecast_authoritative') for p in prods))
print()
print("=== resolution census (non-island) ===")
non=[p for p in prods if not (p.get('provider')=='copernicus' and p.get('resolution')==0.0833)]
print(" ", sorted(collections.Counter(p.get('resolution') for p in non).items(), key=lambda x: (x[0] is None, x[0])))
print("  FINEST non-island resolution:", min(p['resolution'] for p in non if p.get('resolution')))
print()
print("=== layers x model (non-island) ===")
lm=collections.Counter((p.get('model'),p.get('layer')) for p in non)
models=sorted({p.get('model') for p in non}); layers=sorted({p.get('layer') for p in non})
print("  %-14s"%"layer" + "".join("%10s"%m for m in models))
for L in layers:
    print("  %-14s"%L + "".join("%10s"%lm.get((m,L),0) for m in models))
print()
print("=== domains ===", collections.Counter(p.get('domain') for p in non))
