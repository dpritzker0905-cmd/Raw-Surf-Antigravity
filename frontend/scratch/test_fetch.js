const fetch = require('node-fetch');

async function testModel(name, modelParam) {
  const latitude = 37.7749;
  const longitude = -122.4194;
  const WEATHER_VARS = 'precipitation,snowfall,precipitation_probability,temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,pressure_msl';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=${WEATHER_VARS}&models=${modelParam}&forecast_days=3&wind_speed_unit=kn`;
  
  console.log(`\n--- Testing ${name} (${modelParam}) ---`);
  console.log(`URL: ${url}`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed with status: ${res.status}`);
      const text = await res.text();
      console.error(text);
      return;
    }
    const json = await res.json();
    console.log(`Success! Keys in hourly response:`, Object.keys(json.hourly || {}));
    if (json.hourly) {
      const keys = Object.keys(json.hourly);
      keys.forEach(k => {
        const arr = json.hourly[k];
        console.log(`  - ${k}: length=${arr ? arr.length : 0}, first 3 vals=`, arr ? arr.slice(0, 3) : null);
      });
    }
  } catch (e) {
    console.error(`Error:`, e.message);
  }
}

async function run() {
  await testModel('GFS', 'gfs_seamless');
  await testModel('EURO', 'ecmwf_ifs025');
  await testModel('ICON', 'dwd_icon');
}

run();
