import json, urllib.request, collections
P=r'C:\Users\dprit\AppData\Local\Temp\claude\C--Users-dprit-Raw-Surf\bfea4750-29ea-4c1e-a90e-bacf09717bf8\scratchpad\products.json'
prods=json.load(open(P))['products']
# UNION of coverage per region, over ALL GFS marine 0.25 products (any layer)
U={}
for p in prods:
    if p.get('model')=='GFS' and p.get('domain')=='marine' and p.get('resolution')==0.25:
        c=p.get('coverage') or {}; rid=p.get('region_id')
        if not (rid and c): continue
        if rid not in U: U[rid]=dict(c)
        else:
            u=U[rid]
            u['west']=min(u['west'],c['west']); u['south']=min(u['south'],c['south'])
            u['east']=max(u['east'],c['east']);  u['north']=max(u['north'],c['north'])
print("GFS marine 0.25-deg regional tiles (UNION extent): %d"%len(U))
for r,c in sorted(U.items()):
    print("   %-28s W%8.2f S%7.2f E%8.2f N%7.2f"%(r,c['west'],c['south'],c['east'],c['north']))
with urllib.request.urlopen("https://raw-surf-antigravity.onrender.com/api/surf-spots", timeout=180) as r:
    spots=json.loads(r.read())
if isinstance(spots, dict): spots=spots.get('spots') or spots.get('data') or []
def inside(la,lo,c): return c['west']<=lo<=c['east'] and c['south']<=la<=c['north']
cov=0; unc=[]
for s in spots:
    la=s.get('latitude'); lo=s.get('longitude')
    if la is None or lo is None: continue
    (cov:=cov) # noop
    if any(inside(la,lo,c) for c in U.values()): cov+=1
    else: unc.append((s.get('name'),la,lo,s.get('country')))
tot=cov+len(unc)
print("\nspots total with coords: %d"%tot)
print("  INSIDE a 0.25-deg regional tile : %d (%.1f%%)"%(cov,100*cov/tot))
print("  OUTSIDE -> 2-deg global fallback: %d (%.1f%%)"%(len(unc),100*len(unc)/tot))
byc=collections.Counter(str(c) for _,_,_,c in unc)
print("\n  top uncovered countries:")
for k,v in byc.most_common(12): print("     %-28s %d"%(k[:28],v))
