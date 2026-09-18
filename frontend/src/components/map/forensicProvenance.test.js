import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';
import { frameToMarineData } from './marineSeriesFrame';
import { mapNormalizedWindGridToWebGL } from './backendWindServiceClient';
import { mapNormalizedCopernicusGridToWebGL } from './backendCopernicusServiceClient';

const bounds = {west:-90,east:-89,south:12,north:13};
const vectors = [{lat:12,lng:-90,speed:2,direction:180,u:0,v:2,period:12,is_valid:true}];
const provenance = {provider:'backend-weather-service', upstream_provider:'noaa', source_dataset:'gfswave',
  model_run_time:'2026-09-17T06:00:00Z', model_run_time_status:'known', ingested_at:'2026-09-17T10:41:00Z',
  valid_time:'2026-09-17T19:00:00Z', served_valid_time:'2026-09-17T18:00:00Z', frame_substituted:true, frame_offset_hours:-1};

test.each(['single','series','wind','copernicus'])('%s adapter preserves supplier, cycle and actual time', lane => {
  const json={...provenance,grid:{bounds,vectors,cols:1,rows:1}};
  const result = lane === 'single' ? mapNormalizedGridToWebGL(json,bounds,0)
    : lane === 'wind' ? mapNormalizedWindGridToWebGL(json,bounds,0)
    : lane === 'copernicus' ? mapNormalizedCopernicusGridToWebGL(json,bounds,0)
    : frameToMarineData({...provenance,bounds,vectors,cols:1,rows:1,hour_offset:0},'GFS','waves');
  for (const obj of [result, result.grid || result]) {
    expect(obj.model_run_time).toBe(provenance.model_run_time);
    expect(obj.ingested_at).toBe(provenance.ingested_at);
    expect(obj.model_run_time_status).toBe('known');
    expect(obj.served_valid_time).toBe(provenance.served_valid_time);
  }
  expect((result.grid || result).__upstreamProvider).toBe('noaa');
  expect((result.grid || result).__sourceDataset).toBe('gfswave');
  expect((result.grid || result).frame_substituted).toBe(true);
});

test('legacy run_time is never promoted to a model cycle', () => {
  const result=mapNormalizedGridToWebGL({run_time:'2026-09-17T10:41:00Z',grid:{bounds,vectors,cols:1,rows:1}},bounds,0);
  expect(result.grid.model_run_time).toBeNull();
  expect(result.grid.model_run_time_status).toBe('missing');
});
