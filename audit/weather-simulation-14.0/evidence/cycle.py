import json, collections
P=r'C:\Users\dprit\AppData\Local\Temp\claude\C--Users-dprit-Raw-Surf\bfea4750-29ea-4c1e-a90e-bacf09717bf8\scratchpad\products.json'
prods=json.load(open(P))['products']
print("NOW = 2026-09-20T19:07Z (manifest snapshot)")
print()
for model in ('GFS','ICON','EURO'):
    ps=[p for p in prods if p.get('model')==model and p.get('domain')=='marine' and p.get('model_run_time')]
    if not ps: print(f"{model}: no model_run_time on any marine product"); continue
    cyc=collections.Counter(p['model_run_time'] for p in ps)
    print(f"{model} marine: distinct cycles={len(cyc)}  newest={max(cyc)}  oldest={min(cyc)}")
    for c,n in sorted(cyc.items(), reverse=True)[:5]:
        print(f"    {c}  n={n}")
    # per-region newest cycle for 'waves'
    rg=collections.defaultdict(list)
    for p in ps:
        if p.get('layer')=='waves': rg[p.get('region_id')].append(p['model_run_time'])
    if rg:
        print(f"    -- newest cycle per region ({model} waves) --")
        for r,v in sorted(rg.items(), key=lambda x: max(x[1])):
            print(f"       {str(r):<28} newest_cycle={max(v)}  n={len(v)}")
    print()
