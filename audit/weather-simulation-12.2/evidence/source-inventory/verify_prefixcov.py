import os, re, json
ROOT = r"C:\Users\dprit\Raw-Surf\frontend\src"
PREFIXES = ['[WebGLMarine','[WebGLWind','[Backend Weather Service]','[Backend Precipitation Service]',
 '[Backend Pressure Service]','[MapWebGL]','[ExactPoint]','[Safe Cache]','[Fallback]','[CopernicusGrid]',
 '[WebGLGuardrail]','[TRANSITION]','[WebGLOverlay]','[WebGLMarine-Validate]','[OceanMask]',
 '[LayerAccessResolver]','[LayerRegistry]','[FETCH]','[extractMarineAtOffset]','[Pressure]','[PressureController]']
print("n_prefixes=%d" % len(PREFIXES))
pat = re.compile(r"""console\.(error|warn)\(\s*(['"`])(\[[^'"`\]]{1,60}\])""")
files=[]
for dp,dn,fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d not in ('__tests__','tests','node_modules','__mocks__')]
    for f in fn:
        if f.endswith(('.js','.jsx','.ts','.tsx')) and '.test.' not in f and '.spec.' not in f:
            files.append(os.path.join(dp,f))
print("n_files=%d" % len(files))
cap=[]; unc=[]
for p in files:
    try: src=open(p,encoding='utf-8').read()
    except: continue
    for m in pat.finditer(src):
        pre=m.group(3); line=src[:m.start()].count('\n')+1
        rel=os.path.relpath(p,ROOT).replace(chr(92),'/')
        rec=(pre, rel, line, m.group(1))
        if any(x in pre for x in PREFIXES): cap.append(rec)
        else: unc.append(rec)
tot=len(cap)+len(unc)
print("total_sites=%d distinct_prefixes=%d" % (tot, len(set(r[0] for r in cap+unc))))
print("captured_sites=%d captured_prefixes=%d" % (len(cap), len(set(r[0] for r in cap))))
print("uncaptured_sites=%d uncaptured_prefixes=%d" % (len(unc), len(set(r[0] for r in unc))))
print("uncaptured_pct=%.1f" % (100.0*len(unc)/tot))
from collections import Counter
print("--- top uncaptured prefixes ---")
for k,v in Counter(r[0] for r in unc).most_common(15): print("  %-38s %d" % (k,v))
print("--- named-in-claim uncaptured sites ---")
for want in ['[GridWorker]','[ErrorBoundary]','[apiClient]','[MapLibre Error]','[WEATHER_TRUTH]','[Orchestrator Fatal Exception]']:
    hits=[r for r in unc if r[0]==want]
    for h in hits[:2]: print("  %-32s %s:%d (console.%s)" % (h[0],h[1],h[2],h[3]))
    if not hits: print("  %-32s NOT FOUND" % want)
json.dump({"captured":cap,"uncaptured":unc}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"prefixcov_result.json"),"w"), indent=1)
