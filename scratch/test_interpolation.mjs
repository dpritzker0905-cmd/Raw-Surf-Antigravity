import { FileBackend, OmFileReader } from "../frontend/node_modules/@openmeteo/file-reader/dist/esm/index.js";
import { GridFactory, getRanges } from "../frontend/node_modules/@openmeteo/weather-map-layer/dist/index.mjs";

// Helper functions from Leaflet/MapLibre to convert lat/lon to tile index
function lon2tile(lon, zoom) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}
function lat2tile(lat, zoom) {
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}
function tile2lon(x, z) {
  return x / Math.pow(2, z) * 360 - 180;
}
function tile2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

async function main() {
  try {
    const backend = new FileBackend("scratch/sample.om");
    const reader = await OmFileReader.create(backend);
    
    const waveReader = await reader.getChildByName("wave_height");
    const dims = waveReader.getDimensions();
    
    // Grid description from domainOptions for GFS Wave:
    const gridData = {
      type: "regular",
      nx: 1440,
      ny: 721,
      latMin: -90,
      lonMin: -180,
      dx: 0.25,
      dy: 0.25,
      zoom: 1
    };
    
    // Let's simulate a tile covering Florida at Zoom 7
    // Florida: lat 28.0, lon -81.5
    const z = 7;
    const tileX = lon2tile(-81.5, z);
    const tileY = lat2tile(28.0, z);
    console.log(`Zoom ${z} Tile coordinates for Florida: x=${tileX}, y=${tileY}`);
    
    // Bounds of this tile:
    const tileWest = tile2lon(tileX, z);
    const tileEast = tile2lon(tileX + 1, z);
    const tileNorth = tile2lat(tileY, z);
    const tileSouth = tile2lat(tileY + 1, z);
    const tileBounds = [tileWest, tileSouth, tileEast, tileNorth];
    console.log(`Tile Bounds: [W: ${tileWest}, S: ${tileSouth}, E: ${tileEast}, N: ${tileNorth}]`);
    
    // Calculate covering ranges for this tile
    const ranges = getRanges(gridData, tileBounds);
    console.log("Calculated covering ranges for file read:", ranges);
    
    // Read wave data values
    const data = await waveReader.read({
      type: 20,
      ranges: ranges
    });
    console.log("Values array length:", data.length);
    
    // Construct Grid
    const grid = GridFactory.create(gridData, ranges);
    console.log("Grid Bounds:", grid.getBounds());
    console.log("Grid nx:", grid.nx, "ny:", grid.ny);
    
    // Test a sample point (e.g. center of the tile)
    const testLat = (tileNorth + tileSouth) / 2;
    const testLon = (tileWest + tileEast) / 2;
    console.log(`\n--- Testing interpolation at lat: ${testLat}, lon: ${testLon} ---`);
    
    // Let's run the bounds check manually
    const bounds = grid.getBounds();
    console.log("Manual bounds check:");
    console.log(`  lon (${testLon}) < bounds[0] (${bounds[0]}):`, testLon < bounds[0]);
    console.log(`  lon (${testLon}) > bounds[2] (${bounds[2]}):`, testLon > bounds[2]);
    console.log(`  lat (${testLat}) < bounds[1] (${bounds[1]}):`, testLat < bounds[1]);
    console.log(`  lat (${testLat}) >= bounds[3] (${bounds[3]}):`, testLat >= bounds[3]);
    
    const val = grid.getLinearInterpolatedValue(data, testLat, testLon);
    console.log("getLinearInterpolatedValue returned:", val);
    
  } catch (err) {
    console.error("Error:", err);
  }
}
main();
