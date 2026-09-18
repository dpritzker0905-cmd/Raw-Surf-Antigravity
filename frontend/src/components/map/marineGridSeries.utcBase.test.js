jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));
import {ensureMarineSeries,getMarineSeriesFrame,_resetMarineSeriesForTest} from './marineGridSeries';
const bounds={west:-90,east:-89,south:12,north:13};
const inner={west:-89.9,east:-89.1,south:12.1,north:12.9};
beforeEach(()=>{
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-17T12:59:59Z'));
  window.__MARINE_SERIES__=true; window.__RAW_DISABLE_HOUR0_FIRST__=true;
  _resetMarineSeriesForTest();
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({base_time:'2026-09-17T12:00:00Z',frames:[{
    hour_offset:0,valid_time:'2026-09-17T12:00:00Z',cols:1,rows:1,bounds,
    vectors:[{lat:12.5,lng:-89.5,speed:2,direction:180,u:0,v:2,period:12}]
  }]})}));
});
afterEach(()=>{_resetMarineSeriesForTest();jest.useRealTimers();delete global.fetch;delete window.__RAW_DISABLE_HOUR0_FIRST__;});
test('UTC rollover rejects both exact-key and containing viewport cache hits before TTL expiry',async()=>{
  await ensureMarineSeries('GFS','waves',bounds,0,undefined,true);
  expect(getMarineSeriesFrame('GFS','waves',bounds,0)).not.toBeNull();
  expect(getMarineSeriesFrame('GFS','waves',inner,0)).not.toBeNull();
  jest.setSystemTime(new Date('2026-09-17T13:00:01Z'));
  expect(getMarineSeriesFrame('GFS','waves',bounds,0)).toBeNull();
  expect(getMarineSeriesFrame('GFS','waves',inner,0)).toBeNull();
});
