const { defaultOmProtocolSettings } = require('c:\\Users\\dprit\\Raw-Surf\\frontend\\node_modules\\@openmeteo\\weather-map-layer\\dist\\index.cjs');

const domains = defaultOmProtocolSettings.domainOptions || [];
console.log('Total domains defined:', domains.length);

const gfsWave = domains.find(d => d.value.includes('wave') || d.value.includes('gfswave'));
console.log('GFS Wave domain:', gfsWave);

const ncepDomains = domains.filter(d => d.value.includes('ncep'));
console.log('NCEP domains:', ncepDomains.map(d => ({ value: d.value, gridType: d.grid?.type, nx: d.grid?.nx, ny: d.grid?.ny })));
