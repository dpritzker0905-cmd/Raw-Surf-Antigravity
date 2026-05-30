const http = require('http');

async function test() {
  const snappedBounds = { west: -180, south: -80, east: 180, north: 80 };
  const GRID = 20; // 441 points
  const latStep = (snappedBounds.north - snappedBounds.south) / GRID;
  const lngStep = (snappedBounds.east - snappedBounds.west) / GRID;
  
  const points = [];
  for (let yi = 0; yi <= GRID; yi++) {
    for (let xi = 0; xi <= GRID; xi++) {
      let lat = snappedBounds.south + yi * latStep;
      let lng = snappedBounds.west + xi * lngStep;
      let reqLng = lng;
      while (reqLng >= 180) reqLng -= 360;
      while (reqLng < -180) reqLng += 360;
      points.push({
        lat: +lat.toFixed(2),
        reqLng: +reqLng.toFixed(2),
        monotonicLng: +lng.toFixed(2)
      });
    }
  }
  
  console.log(`Prepared ${points.length} points for query.`);
  
  const queryLats = points.map(p => p.lat);
  const queryLons = points.map(p => p.reqLng);
  
  const body = {
    type: 'marine',
    body: {
      latitude: queryLats,
      longitude: queryLons,
      hourly: ['wave_height', 'wave_direction'],
      forecast_days: 1
    }
  };
  
  const postData = JSON.stringify(body);
  
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/weather-proxy',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  console.log('Sending request to local weather proxy...');
  
  try {
    const req = http.request(options, (res) => {
      console.log(`STATUS: ${res.statusCode}`);
      console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          console.log(`Received data! Is Array: ${Array.isArray(parsedData)}`);
          if (Array.isArray(parsedData)) {
            console.log(`Array length: ${parsedData.length}`);
            
            // Analyze data by longitude
            const lonsData = {};
            parsedData.forEach((item, idx) => {
              const pt = points[idx];
              if (!pt) return;
              const hasData = item.hourly && item.hourly.wave_height && item.hourly.wave_height[0] !== null;
              const val = hasData ? item.hourly.wave_height[0] : null;
              
              if (!lonsData[pt.monotonicLng]) {
                lonsData[pt.monotonicLng] = { total: 0, valid: 0, values: [] };
              }
              lonsData[pt.monotonicLng].total++;
              if (hasData) {
                lonsData[pt.monotonicLng].valid++;
                lonsData[pt.monotonicLng].values.push(val);
              }
            });
            
            console.log('\n--- Longitude Data Analysis ---');
            Object.keys(lonsData).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach(lng => {
              const stats = lonsData[lng];
              const avg = stats.values.length > 0 ? (stats.values.reduce((sum, v) => sum + v, 0) / stats.values.length).toFixed(2) : 'N/A';
              console.log(`Lng: ${parseFloat(lng).toFixed(1)} -> Total points: ${stats.total}, Valid: ${stats.valid}, Avg Wave Height: ${avg}`);
            });
            
          } else {
            console.log(`Data keys: ${Object.keys(parsedData)}`);
          }
        } catch (e) {
          console.error(`JSON Parse Error: ${e.message}`);
          console.log(`Raw data start: ${rawData.substring(0, 500)}`);
        }
      });
    });
    
    req.on('error', (e) => {
      console.error(`Problem with request: ${e.message}`);
    });
    
    req.write(postData);
    req.end();
  } catch (err) {
    console.error(err);
  }
}

test();
