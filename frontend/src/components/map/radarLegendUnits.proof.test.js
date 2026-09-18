import fs from 'fs';
import path from 'path';
import { compileForecastCards } from './forecastCardCompiler';
const read = f => fs.readFileSync(path.join(__dirname,f),'utf8');
test('radar legend claims relative reflectivity, never a rain-rate or calibrated dBZ scale', () => {
  const src=read('MapWeatherControls.js');
  expect(src).toContain("radar: 'Radar reflectivity (relative)'");
  expect(src).toContain("evenStops(['Weak', '', 'Moderate', '', 'Strong'])");
  expect(src).not.toContain("evenStops(['0', '.1', '.3', '.5', '2+'])");
});
test.each([{precip:2,snowfall:0},{precip:0,snowfall:1},{precip:0,snowfall:0}])('radar precipitation cards disclose model origin: %j', values => {
  const cards=compileForecastCards({activeLayer:'radar',wx:{},getClampedValue:()=>null,...values});
  expect(cards[0].label).toMatch(/^Model /);
  expect(cards.find(c=>c.label === 'Model Prob')).toBeDefined();
});
test('ordinary rain retains its plain label', () => {
  const cards=compileForecastCards({activeLayer:'rain',wx:{},getClampedValue:()=>null,precip:2,snowfall:0});
  expect(cards[0].label).toBe('Rain');
});
