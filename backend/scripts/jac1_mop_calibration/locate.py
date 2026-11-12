import json, re, urllib.request, math, sys
from concurrent.futures import ThreadPoolExecutor
B = __import__('os').environ.get('JAC1_MOP_DIR', 'jac1_mop_work/')
cat=open(B+'dl/mopcat.xml',encoding='utf8').read()
ids=sorted(set(re.findall(r'name="([A-Z]+[0-9]+)_hindcast\.nc"',cat)))
byp={}
for i in ids:
    p=re.match(r'[A-Z]+',i).group(0); byp.setdefault(p,[]).append(i)
cache={}
try: cache=json.load(open(B+'mopmeta_cache.json'))
except Exception: pass
def meta(i):
    if i in cache: return cache[i]
    u=f'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/{i}_hindcast.nc.ascii?metaLatitude,metaLongitude,metaWaterDepth,metaShoreNormal'
    t=urllib.request.urlopen(u,timeout=60).read().decode()
    v={}
    for k in ['metaLatitude','metaLongitude','metaWaterDepth','metaShoreNormal']:
        m=re.search(k+r'\s*\n?\s*,?\s*([-0-9.eE]+)',t.split(k,1)[1] if False else t[t.rfind(k):])
        v[k]=float(re.findall(r'[-0-9.]+(?:[eE][-0-9]+)?',t[t.rfind(k)+len(k):])[0])
    cache[i]=v; return v
def dist(a,b,c,d):
    return 111.2*math.hypot(a-c,(b-d)*math.cos(math.radians(a)))
spots=json.load(open(B+'spots.json'))
pref={'Ocean Beach SF':'SF','Pacifica - Linda Mar':'SM','Capitola':'SC','Pleasure Point':'SC',"Cowell's Beach":'SC','Steamer Lane':'SC','Carmel Beach':'MO','Leadbetter Beach':'B','Sands Beach':'B','Rincon':'B','Mondos':'VE','C Street Ventura':'VE','Malibu First Point':'L','Zuma Beach':'L','Huntington Beach Pier':'OC','Newport Point':'OC','Trestles':'D','Blacks Beach':'D','La Jolla Shores':'D','Windansea':'D'}
ex=ThreadPoolExecutor(8)
for p in sorted(set(pref.values())):
    lst=byp[p]; samp=lst[::25]+[lst[-1]]
    list(ex.map(meta,samp))
json.dump(cache,open(B+'mopmeta_cache.json','w'))
for s in spots:
    p=pref[s['name']]; lst=byp[p]
    known=[(dist(s['lat'],s['lng'],cache[i]['metaLatitude'],cache[i]['metaLongitude']),i) for i in lst if i in cache]
    known.sort(); c=known[0][1]; k=lst.index(c)
    cand=lst[max(0,k-30):k+31]
    list(ex.map(meta,cand))
    best=min(cand,key=lambda i:dist(s['lat'],s['lng'],cache[i]['metaLatitude'],cache[i]['metaLongitude']))
    m=cache[best]; d=dist(s['lat'],s['lng'],m['metaLatitude'],m['metaLongitude'])
    s['mop']=best; s['mop_meta']=m; s['mop_km']=round(d,3)
    print(s['name'],best,m,round(d,2))
json.dump(cache,open(B+'mopmeta_cache.json','w'))
json.dump(spots,open(B+'spots.json','w'),indent=1)
