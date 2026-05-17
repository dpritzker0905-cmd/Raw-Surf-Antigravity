// gpsWorker.js - Web Worker for offloading heavy GPS calculations

// Haversine formula to calculate distance
const getDistanceFromLatLonInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Radius of the earth in m
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
};

let lastPos = null;
let distance = 0;
let topSpeed = 0;
let waveCount = 0;

self.onmessage = function(e) {
  const { type, payload } = e.data;

  if (type === 'PROCESS_POSITION') {
    const { latitude, longitude, speed } = payload;
    const currentSpeed = speed || 0;

    if (currentSpeed > topSpeed) topSpeed = currentSpeed;

    // Wave count heuristic: speed jumps above 4.0 m/s
    if (currentSpeed > 4.0 && (!lastPos || (lastPos.speed || 0) <= 4.0)) {
      waveCount += 1;
    }

    if (lastPos) {
      const dist = getDistanceFromLatLonInMeters(
        lastPos.lat, lastPos.lon,
        latitude, longitude
      );
      distance += dist;
    }

    lastPos = { lat: latitude, lon: longitude, speed: currentSpeed };

    // Post updated metrics back to main thread
    self.postMessage({
      type: 'METRICS_UPDATE',
      payload: { distance, topSpeed, waveCount }
    });
  }

  if (type === 'RESET') {
    lastPos = null;
    distance = 0;
    topSpeed = 0;
    waveCount = 0;
    self.postMessage({
      type: 'METRICS_UPDATE',
      payload: { distance, topSpeed, waveCount }
    });
  }
};
