"""Generate isolated native mask profiling/prototype artifacts; run from repo root.

Generated modules stay under ignored visual/. No app-source edit, backend or GPU.
The distance cache is an unshipped experiment, not an accepted performance fix.
"""
from pathlib import Path
p=Path('frontend/src/components/map/WebGLMarineMaskRenderer.js'); s=p.read_text(encoding='utf-8')
s=s.replace("from './", "from '../../../frontend/src/components/map/")
s=s.replace("} from './", "} from '../../../frontend/src/components/map/")
def replace(old,new):
 global s
 assert s.count(old)==1,(old,s.count(old))
 s=s.replace(old,new,1)
replace('const neSnapshot = snapshotNeTruth(canvas);', "const neSnapshot = timed('neSnapshot', () => snapshotNeTruth(canvas));")
replace("neFull.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);", "timed('neFullCopy', () => neFull.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0));")
replace("ctx.fillStyle = '#ffffff';\n  let painted = 0;", "const tracingAt = performance.now();\n  ctx.fillStyle = '#ffffff';\n  let painted = 0;")
replace('const gStats = applyInlandWaterGuard(canvas, neSnapshot, bounds);', "record('polygonTrace', performance.now() - tracingAt);\n    const gStats = timed('inlandGuard', () => applyInlandWaterGuard(canvas, neSnapshot, bounds));")
replace('const rStats = reassertNeLand(canvas, neFull);', "const rStats = timed('islandReassert', () => reassertNeLand(canvas, neFull));")
replace("let _wetPainted = 0;", "const wetAt = performance.now();\n    let _wetPainted = 0;")
replace('if (_win.__RAW_GPU__) {\n      window.__RAW_GPU__.wetlandBlackout', "record('wetlandTrace', performance.now() - wetAt);\n    if (_win.__RAW_GPU__) {\n      window.__RAW_GPU__.wetlandBlackout")
replace('const stats = suppressShelteredWater(canvas, bounds);', "const stats = timed('shelter', () => suppressShelteredWater(canvas, bounds));")
replace('const stats = applyCachedShelteredVerdict(canvas, bounds);', "const stats = timed('shelterCache', () => applyCachedShelteredVerdict(canvas, bounds));")
replace('narrow = suppressShelteredWater(canvas, bounds, { gapM: narrowM, stash: false });', "narrow = timed('narrowShelter', () => suppressShelteredWater(canvas, bounds, { gapM: narrowM, stash: false }));")
replace('const cur = ctx.getImageData(sx, sy, sw, sh).data;', "const cur = timed('damageReadback', () => ctx.getImageData(sx, sy, sw, sh).data);")
replace("const ne = neFull.getContext('2d', { willReadFrequently: true }).getImageData(sx, sy, sw, sh).data;", "const ne = timed('damageReadback', () => neFull.getContext('2d', { willReadFrequently: true }).getImageData(sx, sy, sw, sh).data);")
s += '''\nfunction record(name,ms) { const b=window.__OFFLINE_MASK_STAGES__[name] || (window.__OFFLINE_MASK_STAGES__[name]={calls:0,totalMs:0}); b.calls++;b.totalMs+=ms; }
function timed(name,fn) { const start=performance.now();try{return fn();}finally{record(name,performance.now()-start);} }
'''
Path('audit/repair-2026-10-04/visual/water-profile-renderer.js').write_text(s,encoding='utf-8',newline='\n')
s=Path('audit/repair-2026-10-04/renderer-probe/serve-phase-cost.cjs').read_text(encoding='utf-8')
s=s.replace("'phase-cost-bundle'","'water-profile-bundle'").replace("'phase-cost-entry.js'","'water-profile-entry.js'")
start=s.index("response.end('<!doctype html>"); end=s.index("');",start)+3
s=s[:start]+'''response.end('<!doctype html><meta charset="utf-8"><title>Offline mask paint profiling</title><h1>Actual mask painter stage profiling</h1><p>Synthetic coast fixtures, native Canvas2D, no backend or GPU/frame-rate claim. Generated copy adds stage clocks; original served source is unchanged. Three measured paints per leg after warmup. Sizes 512 and 2048; straight and 5000-vertex coasts.</p><button id="run">Profile water painting</button><pre id="report">Ready</pre><script src="/probe.js"></script>');'''+s[end:]
s=s.replace('Offline phase probe:', 'Offline water probe:')
Path('audit/repair-2026-10-04/visual/serve-water-profile.cjs').write_text(s,encoding='utf-8',newline='\n')
print('Generated profiling copy; served renderer unchanged')

from pathlib import Path
s=Path('frontend/src/components/map/inlandWaterGuard.js').read_text(encoding='utf-8')
start=s.index('  const dist = new Int32Array(size);'); end=s.index('  const reblack = new Uint8Array(size);',start)
core=s[start:end]
helper='''
let lastDistance = null;
export function resetOfflineDistanceCache() { lastDistance=null; }
function distanceFor(neWater,w,h,size) {
  const eligible = neWater instanceof Uint8Array && neWater.length===size &&
    Number.isSafeInteger(w) && w>0 && Number.isSafeInteger(h) && h>0 && size<=524288 &&
    !(typeof window!=='undefined' && window.__OFFLINE_DISABLE_INLAND_CACHE__===true);
  if(eligible && lastDistance && lastDistance.w===w && lastDistance.h===h) {
    let same=true;for(let i=0;i<size;i++)if(neWater[i]!==lastDistance.ne[i]){same=false;break;}
    if(same)return lastDistance.dist;
  }
  const INF = 0x3fffffff;
'''+core+'''
  if(eligible)lastDistance={w,h,ne:neWater.slice(),dist};
  return dist;
}
'''
patched=s[:start]+'  const dist = distanceFor(neWater,w,h,size);\n'+s[end:]+helper
Path('audit/repair-2026-10-04/visual/water-profile-inland.mjs').write_text(patched,encoding='utf-8',newline='\n')
Path('audit/repair-2026-10-04/visual/water-profile-inland-baseline.mjs').write_text(s,encoding='utf-8',newline='\n')
profile=Path('audit/repair-2026-10-04/visual/water-profile-renderer.js').read_text(encoding='utf-8'); old="from '../../../frontend/src/components/map/inlandWaterGuard'";assert profile.count(old)==1
profile=profile.replace(old,"from './water-profile-inland.mjs'",1)
Path('audit/repair-2026-10-04/visual/water-profile-renderer.js').write_text(profile,encoding='utf-8',newline='\n')
print('Generated bounded exact-input distance-cache prototype; served source unchanged')

for name in ['water-profile-entry.js','inland-prototype-controls.mjs']:
    src=Path('audit/repair-2026-10-04/renderer-probe')/name
    dst=Path('audit/repair-2026-10-04/visual')/name
    dst.write_text(src.read_text(encoding='utf-8'),encoding='utf-8',newline='\n')
