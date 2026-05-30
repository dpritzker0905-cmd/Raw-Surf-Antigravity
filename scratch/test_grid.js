const { GridFactory } = require('c:\\Users\\dprit\\Raw-Surf\\frontend\\node_modules\\@openmeteo\\weather-map-layer\\dist\\index.cjs');

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
console.log('Created grid:', grid);
console.log('nx:', grid.nx);
console.log('ny:', grid.ny);
console.log('keys:', Object.keys(grid));
console.log('prototype keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(grid)));
