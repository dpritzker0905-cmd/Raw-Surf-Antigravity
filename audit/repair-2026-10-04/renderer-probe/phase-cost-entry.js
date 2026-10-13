import { createCustomLayer } from '../../../frontend/src/components/map/WebGLMarineCustomLayer';
import { timeMarineCpuPhase, measureMarineCpuPhase } from '../../../frontend/src/components/map/marineCpuPhaseTiming';
import { measureMarineMaskRefresh, measureMarineMaskPaint } from '../../../frontend/src/components/map/marineMaskRefreshAttribution';
import { sampleMarineFallback, marineFallbackReceipt } from '../../../frontend/src/components/map/marineFallbackEvidence';
const ref = current => ({ current });
const burn = ms => { const stop = performance.now() + ms; while (performance.now() < stop) { /* bounded synthetic CPU work */ } };
document.getElementById('run').addEventListener('click', () => {
  const result = { actualCustomLayer: true, syntheticMapAndEngine: true, backendRequests: 0,
    gpuCompletionMeasured: false, contextAtStart: { hidden: document.hidden, focused: document.hasFocus() }, cases: [] };
  try {
    for (const slow of [false, true]) {
      window.__RAW_GPU__ = {};
      const engine = { _initialized: true, _waveData: {},
        render: timeMarineCpuPhase('engineDraw', () => { if (slow) burn(25); }) };
      const map = { getBounds() { if (slow) burn(15); throw new Error('synthetic bounds'); },
        getCanvas: () => ({ width: 1, height: 1 }), getZoom: () => 8, triggerRepaint() {} };
      const layer = createCustomLayer(engine, ref(true), ref(map), ref(null), ref(null), ref(null),
        ref('dark'), ref(null), ref(false), ref(['waves']), ref(0), ref(null), ref('GFS'));
      const args = { gl: {}, defaultProjectionData: { mainMatrix: new Float32Array(16) } };
      layer.render(args); // warm-up excluded by first snapshot
      const gpu = window.__RAW_GPU__;
      const before = sampleMarineFallback(null, { now: performance.now(), fps: 0, gpu, engine });
      for (let i = 0; i < 6; i++) layer.render(args);
      const receipt = marineFallbackReceipt(sampleMarineFallback(before, { now: performance.now(), fps: 0, gpu, engine }));
      result.cases.push({ deliberateCpuStalls: slow, phases: receipt.cpuPhases });
    }
    result.maskAttribution = [];
    for (const [sourceId, fallback, degraded] of [['water-fixture',false,false],['other-fixture',true,true],['water-fixture',false,true]]) {
      window.__RAW_GPU__ = {};
      const map = {getStyle:()=>({layers:[{id:'water',source:'water-fixture'}]})};
      const engine = {};
      timeMarineCpuPhase('engineDraw',()=>{})();
      const gpu=window.__RAW_GPU__,before=sampleMarineFallback(null,{now:performance.now(),fps:0,gpu,engine});
      const expected={degraded};
      const returned=measureMarineMaskRefresh({type:'sourcedata',sourceId},map,()=>
        measureMarineCpuPhase('maskWaterPaint',()=>measureMarineMaskPaint({usedSourceFallback:fallback},()=>{burn(25);return expected;})));
      const receipt=marineFallbackReceipt(sampleMarineFallback(before,{now:performance.now(),fps:0,gpu,engine}));
      result.maskAttribution.push({fallback,degraded,returnedIdentity:returned===expected,phases:receipt.cpuPhases});
    }
    result.completed = true;
  } catch (error) { result.completed = false; result.error = error.message; }
  result.contextAtEnd = { hidden: document.hidden, focused: document.hasFocus() };
  document.getElementById('report').textContent = JSON.stringify(result, null, 2);
});

document.getElementById('raf').addEventListener('click', () => {
  const button=document.getElementById('raf'), output=document.getElementById('raf-report');
  button.disabled=true; document.getElementById('run').disabled=true;
  output.textContent='Sampling 30 RAF intervals, no engine/map/GPU work; 45 s deadline.';
  const gaps=[], contexts={visibleFocused:0,visibleUnfocused:0,hidden:0,unknown:0};
  let previous=null, frame=null, finished=false;
  const start=performance.now();
  const finish=completed=>{
    if(finished)return;finished=true;clearTimeout(deadline);cancelAnimationFrame(frame);
    const sorted=gaps.slice().sort((a,b)=>a-b);
    output.textContent=JSON.stringify({completed,backendRequests:0,engineMapGpuWork:false,
      intervals:gaps.length,elapsedMs:performance.now()-start,contexts,
      minGapMs:sorted[0]??null,medianGapMs:sorted[Math.floor(sorted.length/2)]??null,
      maxGapMs:sorted[sorted.length-1]??null,intervalsOver50Ms:gaps.filter(g=>g>50).length},null,2);
    button.disabled=false;document.getElementById('run').disabled=false;
  };
  const deadline=setTimeout(()=>finish(false),45000);
  const tick=at=>{
    let key='unknown';try{key=document.hidden?'hidden':document.hasFocus()?'visibleFocused':'visibleUnfocused';}catch(e){}
    contexts[key]++;
    if(previous!==null)gaps.push(at-previous);previous=at;
    if(gaps.length===30)finish(true);else frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
});
