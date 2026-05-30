import { GridFactory } from 'file:///c:/Users/dprit/Raw-Surf/frontend/node_modules/@openmeteo/weather-map-layer/dist/index.mjs';

const gridData = {
  type: 'regular',
  dx: 0.25,
  dy: 0.25,
  lonMin: -180,
  latMin: -90,
  nx: 1440,
  ny: 721
};

const grid = GridFactory.create(gridData, null);
console.log('ESM Grid nx:', grid.nx);
console.log('ESM Grid ny:', grid.ny);
console.log('ESM Grid keys:', Object.keys(grid));
