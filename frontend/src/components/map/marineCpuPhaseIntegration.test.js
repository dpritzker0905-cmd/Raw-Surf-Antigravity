import WebGLMarineEngine from './WebGLMarineEngine';
import { createCustomLayer } from './WebGLMarineCustomLayer';
import { sampleMarineFallback, marineFallbackReceipt } from './marineFallbackEvidence';
import { snapshotMarineCpuPhases } from './marineCpuPhaseTiming';
import { measureMarineMaskRefresh, createMarineMaskSourceRedrive } from './marineMaskRefreshAttribution';
import { renderMaskToCanvas, overlayBasemapWaterOnMask, prepareBasemapWaterOverlay } from './WebGLMarineMaskRenderer';
jest.mock('./maskCoastSDF',()=>({writeCoastDistanceField:()=>false}));
jest.mock('./WebGLMarineMaskRenderer',()=>({
  ...jest.requireActual('./WebGLMarineMaskRenderer'), renderMaskToCanvas:jest.fn(),
  overlayBasemapWaterOnMask:jest.fn(),prepareBasemapWaterOverlay:jest.fn(),
}));
let now;
const ref = current => ({current});
beforeAll(()=>{
  global.WebGLRenderingContext = global.WebGLRenderingContext || class {};
  global.WebGL2RenderingContext = global.WebGL2RenderingContext || class {};
});
beforeEach(()=>{
  now=100; window.__RAW_GPU__={};
  jest.spyOn(performance,'now').mockImplementation(()=>now);
  jest.spyOn(document,'hasFocus').mockReturnValue(true);
  jest.spyOn(document,'hidden','get').mockReturnValue(false);
  jest.spyOn(console,'log').mockImplementation(()=>{});
  jest.spyOn(console,'warn').mockImplementation(()=>{});
  jest.spyOn(console,'error').mockImplementation(()=>{});
  prepareBasemapWaterOverlay.mockImplementation(()=>{now+=11;return {feats:[{}]};});
  renderMaskToCanvas.mockImplementation(()=>{now+=7;return {width:128,height:64};});
  overlayBasemapWaterOnMask.mockImplementation(()=>{now+=23;return true;});
});
afterEach(()=>{jest.restoreAllMocks();delete window.__RAW_GPU__;delete window.__MARINE_CHURN__;});

test('real custom callback includes pre-draw and repaint work in its CPU bucket',()=>{
  const engine={_initialized:true,_waveData:{},render:()=>{now+=4;}};
  const map={getBounds(){now+=35;throw new Error('fixture');},getCanvas:()=>({width:1,height:1}),
    getZoom:()=>8,triggerRepaint(){now+=2;}};
  const layer=createCustomLayer(engine,ref(true),ref(map),ref(null),ref(null),ref(null),ref('dark'),
    ref(null),ref(false),ref(['waves']),ref(0),ref(null),ref('GFS'));
  layer.render({gl:{},defaultProjectionData:{mainMatrix:new Float32Array(16)}});
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__)?.buckets.customCallback).toMatchObject({calls:1,totalDurationMs:41});
});
test('real skipped callback still records complete CPU time without calling engine',()=>{
  const engine={render:jest.fn()};
  const layer=createCustomLayer(engine,ref(false),ref(null),ref(null),ref(null),ref(null),ref('dark'),
    ref(null),ref(false),ref(['waves']),ref(0),ref(null),ref('GFS'));
  layer.render({gl:{},defaultProjectionData:{mainMatrix:new Float32Array(16)}});
  expect(engine.render).not.toHaveBeenCalled();
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__)?.buckets.customCallback.calls).toBe(1);
});
function maskFixture(kind){
  const tex={},engine=Object.create(WebGLMarineEngine.prototype);
  Object.assign(engine,{_cachedMaskGeoJSON:{type:'FeatureCollection',features:[]},_cachedMaskTex:tex,
    _cachedMaskBounds:kind==='wide'?{west:-180,east:180,south:-80,north:80}:{west:0,east:4,south:0,north:4},
    _waveData:{u_oceanMaskTexture:tex}});
  const gl={TEXTURE_2D:1,TEXTURE_BINDING_2D:2,UNPACK_FLIP_Y_WEBGL:3,getParameter:()=>null,
    bindTexture:()=>{},pixelStorei:()=>{},createTexture:()=>({}),texParameteri:()=>{},texImage2D:()=>{now+=13;}};
  const map={getZoom:()=>7,getStyle:()=>({layers:[]}),getSource:()=>({}),isSourceLoaded:()=>true,areTilesLoaded:()=>true,
    getBounds:()=>({getWest:()=>1,getEast:()=>2,getSouth:()=>1,getNorth:()=>2})};
  return {engine,map,gl,refresh:()=>kind==='overlay'?engine.refreshViewportOverlayMask(gl,map):engine.refreshMaskWithBasemapWater(gl,map)};
}
test.each(['regional','overlay','wide'])('real %s refresh records actual query, canvas, paint and GL-upload boundaries',kind=>{
  const f=maskFixture(kind); expect(f.refresh()).toBe(true);
  const buckets=snapshotMarineCpuPhases(window.__RAW_GPU__)?.buckets;
  expect(buckets).toMatchObject({maskFeatureQuery:{calls:1,totalDurationMs:11},maskBaseCanvas:{calls:1,totalDurationMs:7},
    maskWaterPaint:{calls:1,totalDurationMs:23},maskUpload:{calls:1,totalDurationMs:13}});
  expect(buckets?.[kind==='overlay'?'overlayMaskRefresh':'regionalMaskRefresh']).toMatchObject({calls:1,totalDurationMs:54});
  if(kind==='wide')expect(buckets?.overlayMaskRefresh.calls).toBe(1);
});
test('fallback receipt carries same-interval phases, not pre-window mask work or private GPU fields',()=>{
  const f=maskFixture('regional'); f.refresh();
  const gpu=window.__RAW_GPU__;gpu.privateFixture={latitude:99,body:'private-fixture'};
  const start=sampleMarineFallback(null,{now:now,fps:2,gpu,engine:f.engine});
  f.engine._regionalPatchState=null;f.refresh();
  const receipt=marineFallbackReceipt(sampleMarineFallback(start,{now:now,fps:2,gpu,engine:f.engine}));
  expect(receipt.cpuPhases?.phases.maskUpload).toMatchObject({calls:1,totalDurationMs:13});
  expect(JSON.stringify(receipt)).not.toMatch(/privateFixture|latitude|private-fixture/);
});
test('actual engine draw and data-update early returns preserve their values and are timed',()=>{
  const engine=Object.create(WebGLMarineEngine.prototype);
  expect(engine.render({},null,1,1,7,'dark',null,1)).toBeUndefined();
  expect(engine.setWaveData({},null,null)).toBeUndefined();
  const buckets=snapshotMarineCpuPhases(window.__RAW_GPU__).buckets;
  expect(buckets.engineDraw.calls).toBe(1);expect(buckets.waveDataUpdate.calls).toBe(1);
});
test('a throwing real draw still records a complete custom callback and schedules repaint',()=>{
  const error=new Error('fixture draw');
  const engine={_initialized:true,_waveData:{},render:()=>{now+=40;throw error;}};
  const repaint=jest.fn(()=>{now+=2;});
  const map={getBounds(){throw new Error('fixture');},getCanvas:()=>({width:1,height:1}),getZoom:()=>8,triggerRepaint:repaint};
  const layer=createCustomLayer(engine,ref(true),ref(map),ref(null),ref(null),ref(null),ref('dark'),
    ref(null),ref(false),ref(['waves']),ref(0),ref(null),ref('GFS'));
  expect(()=>layer.render({gl:{},defaultProjectionData:{mainMatrix:new Float32Array(16)}})).not.toThrow();
  expect(repaint).toHaveBeenCalledTimes(1);
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.customCallback).toMatchObject({calls:1,totalDurationMs:42});
});
test('a missing middle-window collector remains unknown even when later samples recover',()=>{
  const f=maskFixture('regional'); f.refresh();
  const gpu=window.__RAW_GPU__,first=sampleMarineFallback(null,{now,fps:2,gpu,engine:f.engine});
  const saved=gpu.cpuPhaseTiming;delete gpu.cpuPhaseTiming;
  const middle=sampleMarineFallback(first,{now:now+1000,fps:2,gpu,engine:f.engine});
  gpu.cpuPhaseTiming=saved;
  const last=sampleMarineFallback(middle,{now:now+2000,fps:2,gpu,engine:f.engine});
  expect(marineFallbackReceipt(last).cpuPhases).toBeNull();
});
test('replacement of the engine invalidates the phase interval independently of valid scalar counters',()=>{
  const f=maskFixture('regional'); f.refresh();const gpu=window.__RAW_GPU__;
  const first=sampleMarineFallback(null,{now,fps:2,gpu,engine:f.engine});
  const last=sampleMarineFallback(first,{now:now+1000,fps:2,gpu,engine:{}});
  expect(marineFallbackReceipt(last).cpuPhases).toBeNull();
});
test('reversed sample time invalidates the entire phase episode even after the clock recovers',()=>{
  const f=maskFixture('regional');f.refresh();const gpu=window.__RAW_GPU__;
  const first=sampleMarineFallback(null,{now,fps:2,gpu,engine:f.engine});
  const reversed=sampleMarineFallback(first,{now:now-1,fps:2,gpu,engine:f.engine});
  const recovered=sampleMarineFallback(reversed,{now:now+1000,fps:2,gpu,engine:f.engine});
  expect(marineFallbackReceipt(recovered).cpuPhases).toBeNull();
});

// The live receipt needs the paint verdict, not just total painter cost.
test.each([
  [true, {degraded:true}, 'maskPaintSourceFallback'],
  [false, {degraded:true}, 'maskPaintRenderedDamage'],
  [false, {degraded:false}, 'maskPaintRenderedClean'],
  [false, false, 'maskPaintEmpty'],
])('actual overlay attributes its returned paint verdict (fallback=%s, result=%s)', (fallback, result, phase) => {
  prepareBasemapWaterOverlay.mockImplementation(()=>{now+=11;return {feats:[{}],usedSourceFallback:fallback};});
  overlayBasemapWaterOnMask.mockImplementation(()=>{now+=23;return result;});
  const f=maskFixture('overlay'); expect(f.refresh()).toBe(!!result);
  const phases=snapshotMarineCpuPhases(window.__RAW_GPU__).buckets;
  expect(phases[phase]).toMatchObject({calls:1,totalDurationMs:23});
  expect(phases.maskWaterPaint).toMatchObject({calls:1,totalDurationMs:23});
});

test('actual degraded overlay retries on other-source events, heals, then retains clean truth',()=>{
  jest.spyOn(Date,'now').mockImplementation(()=>now);
  const f=maskFixture('overlay');f.map.getStyle=()=>({layers:[{id:'water',source:'water-fixture'}]});
  prepareBasemapWaterOverlay.mockImplementation(()=>{now+=11;return {feats:[{}],usedSourceFallback:true};});
  overlayBasemapWaterOnMask.mockImplementation(()=>{now+=23;return {degraded:true};});
  const handler=createMarineMaskSourceRedrive(event=>measureMarineMaskRefresh(event,f.map,f.refresh));
  const other={type:'sourcedata',sourceId:'other-fixture',isSourceLoaded:true};
  now=1000;handler(other);now+=1000;handler(other);
  expect(f.engine._overlayPaintDegraded).toBe(true);
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskRefreshSourceOther).toMatchObject({calls:2,totalDurationMs:108});
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskPaintSourceFallback).toMatchObject({calls:2,totalDurationMs:46});
  prepareBasemapWaterOverlay.mockImplementation(()=>{now+=11;return {feats:[{}],usedSourceFallback:false};});
  overlayBasemapWaterOnMask.mockImplementation(()=>{now+=23;return {degraded:false};});
  now+=1000;handler({...other,sourceId:'water-fixture'});
  expect(f.engine._overlayPaintDegraded).toBe(false);
  measureMarineMaskRefresh({type:'idle'},f.map,f.refresh);
  expect(overlayBasemapWaterOnMask).toHaveBeenCalledTimes(3);
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskPaintRenderedClean.calls).toBe(1);
});
test('source-event attribution cannot bypass the actual tile readiness gate',()=>{
  const f=maskFixture('overlay');f.map.areTilesLoaded=()=>false;
  expect(measureMarineMaskRefresh({type:'sourcedata',sourceId:'composite'},f.map,f.refresh)).toBe(false);
  expect(prepareBasemapWaterOverlay).not.toHaveBeenCalled();expect(renderMaskToCanvas).not.toHaveBeenCalled();
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskRefreshSourceWater.calls).toBe(1);
});
