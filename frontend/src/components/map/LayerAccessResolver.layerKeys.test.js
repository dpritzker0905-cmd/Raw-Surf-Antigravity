import { resolveForecastWindow } from './LayerAccessResolver';
const caps=[{model:'ICON',layer:'precipitation',domain:'weather',max_forecast_hours:168},{model:'ICON',layer:'waves',domain:'marine',max_forecast_hours:336}];
beforeEach(()=>{window.__WEATHER_CAPABILITIES__=caps;});
afterEach(()=>{delete window.__WEATHER_CAPABILITIES__; delete window.__RAW_LAYER_CAP_ALIAS__;});
test.each([undefined,false,true])('rain uses its own capability regardless of old alias flag %s', flag=>{
 window.__RAW_LAYER_CAP_ALIAS__=flag;
 expect(resolveForecastWindow('premium','ICON','rain')).toBe(7);
 expect(resolveForecastWindow('premium','ICON','precipitation')).toBe(7);
 expect(resolveForecastWindow('premium','ICON','waves')).toBe(14);
});
test('unknown layer capability is not invented',()=>{
 expect(resolveForecastWindow('premium','ICON','water_temp')).toBe(14);
});
