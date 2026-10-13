import { marineMaskRefreshPhase, measureMarineMaskRefresh, measureMarineMaskPaint,
  createMarineMaskSourceRedrive } from './marineMaskRefreshAttribution';
import { snapshotMarineCpuPhases, marineCpuPhaseDelta, measureMarineCpuPhase } from './marineCpuPhaseTiming';

let now;
const map = {getStyle: () => ({layers:[{id:'water',source:'fixture-water'}]})};
beforeEach(() => {
  now=100; window.__RAW_GPU__={};
  jest.spyOn(performance,'now').mockImplementation(()=>now);
  jest.spyOn(Date,'now').mockImplementation(()=>now);
});
afterEach(() => {
  jest.restoreAllMocks(); delete window.__RAW_GPU__;
  delete window.__RAW_DISABLE_MARINE_PHASE_TIMING__; delete window.__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__;
});
test.each([
  [undefined,'maskRefreshInitial'], [{type:'idle'},'maskRefreshIdle'],
  [{type:'zoomend'},'maskRefreshZoomEnd'], [{type:'moveend'},'maskRefreshMoveEnd'],
  [{type:'sourcedata',sourceId:'fixture-water'},'maskRefreshSourceWater'],
  [{type:'sourcedata',sourceId:'unrelated-fixture'},'maskRefreshSourceOther'],
  [{type:'sourcedata'},'maskRefreshSourceUnknown'], [{type:'unrecognized-fixture'},'maskRefreshOther'],
])('fixed event attribution for %s', (event,phase) => {
  const value={}; expect(measureMarineMaskRefresh(event,map,()=>{now+=12;return value;})).toBe(value);
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets[phase]).toMatchObject({calls:1,totalDurationMs:12});
  expect(JSON.stringify(window.__RAW_GPU__)).not.toMatch(/fixture-water|unrelated-fixture|unrecognized-fixture/);
});
test('default water source follows the actual painter fallback', () => {
  expect(marineMaskRefreshPhase({type:'sourcedata',sourceId:'composite'},{getStyle:()=>({layers:[]})}))
    .toBe('maskRefreshSourceWater');
});
test.each([{}, {getStyle:()=>{throw new Error('fixture');}}, {getStyle:()=>({layers:null})}])( 'unavailable style remains unknown and does not interrupt refresh', broken => {
    expect(measureMarineMaskRefresh({type:'sourcedata',sourceId:'private-fixture'},broken,()=>42)).toBe(42);
    expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskRefreshSourceUnknown.calls).toBe(1);
  });
test('metadata getters and operation errors preserve behavior and identity', () => {
  const event={get type(){throw new Error('event unavailable');}}, error=new Error('operation');
  expect(()=>measureMarineMaskRefresh(event,map,()=>{now+=30;throw error;})).toThrow(error);
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskRefreshSourceUnknown.totalDurationMs).toBe(30);
});
test('disabled timing does not query map metadata or change operation results', () => {
  window.__RAW_DISABLE_MARINE_PHASE_TIMING__=true; const getStyle=jest.fn();
  expect(measureMarineMaskRefresh({type:'sourcedata',sourceId:'fixture'},{getStyle},()=>42)).toBe(42);
  expect(getStyle).not.toHaveBeenCalled(); expect(window.__RAW_GPU__.cpuPhaseTiming).toBeUndefined();
});
test('source redrive preserves loaded gate, 250 ms boundary and source event identity', () => {
  const refresh=jest.fn(), handler=createMarineMaskSourceRedrive(refresh);
  const event={type:'sourcedata',sourceId:'fixture',isSourceLoaded:true};
  now=1000; handler(null); handler({...event,isSourceLoaded:false}); handler(event);
  now=1249; handler(event); now=1250; handler(event);
  expect(refresh.mock.calls).toEqual([[event],[event]]);
});
test('source redrive kill switch does not consume its throttle window', () => {
  const refresh=jest.fn(), handler=createMarineMaskSourceRedrive(refresh);
  const event={type:'sourcedata',isSourceLoaded:true}; now=1000;
  window.__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__=true; handler(event);
  delete window.__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__; handler(event);
  expect(refresh).toHaveBeenCalledTimes(1);
});
test('fresh source handlers own independent throttle state', () => {
  const refresh=jest.fn(), first=createMarineMaskSourceRedrive(refresh), second=createMarineMaskSourceRedrive(refresh);
  now=1000;const event={isSourceLoaded:true}; first(event);second(event);
  expect(refresh).toHaveBeenCalledTimes(2);
});
test('paint failure preserves throw identity and records actual work', () => {
  const error=new Error('paint');
  expect(()=>measureMarineMaskPaint({},()=>{now+=80;throw error;})).toThrow(error);
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskPaintFailed).toMatchObject({calls:1,totalDurationMs:80});
});
test('unreadable paint verdict remains unknown without replacing the returned value', () => {
  const result={get degraded(){throw new Error('unavailable');}};
  expect(measureMarineMaskPaint({usedSourceFallback:false},()=>result)).toBe(result);
  expect(snapshotMarineCpuPhases(window.__RAW_GPU__).buckets.maskPaintUnknown.calls).toBe(1);
});
test('diagnostic store failures cannot interrupt paint or refresh', () => {
  Object.defineProperty(window.__RAW_GPU__,'cpuPhaseTiming',{get(){throw new Error('fixture');}});
  expect(measureMarineMaskPaint({},()=>42)).toBe(42);
  expect(measureMarineMaskRefresh({type:'idle'},map,()=>43)).toBe(43);
});
test('receipt differences exclude pre-window events and become unknown after a reset', () => {
  measureMarineMaskRefresh({type:'idle'},map,()=>{now+=90;});
  const before=snapshotMarineCpuPhases(window.__RAW_GPU__);
  measureMarineMaskRefresh({type:'sourcedata',sourceId:'fixture-water'},map,()=>{now+=60;});
  const after=snapshotMarineCpuPhases(window.__RAW_GPU__);
  const delta=marineCpuPhaseDelta(before,after);
  expect(delta.phases.maskRefreshIdle.calls).toBe(0);
  expect(delta.phases.maskRefreshSourceWater).toMatchObject({calls:1,totalDurationMs:60});
  delete window.__RAW_GPU__.cpuPhaseTiming; measureMarineCpuPhase('engineDraw',()=>{});
  expect(marineCpuPhaseDelta(before,snapshotMarineCpuPhases(window.__RAW_GPU__))).toBeNull();
});
