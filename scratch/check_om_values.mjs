import { FileBackend, OmFileReader } from "../frontend/node_modules/@openmeteo/file-reader/dist/esm/index.js";

async function main() {
  try {
    const backend = new FileBackend("scratch/sample.om");
    const reader = await OmFileReader.create(backend);
    
    const waveReader = await reader.getChildByName("wave_height");
    if (!waveReader) {
      console.error("wave_height not found");
      return;
    }
    
    const dims = waveReader.getDimensions();
    console.log("wave_height dimensions:", dims); // [721, 1440]
    
    // Let's read a slice covering Florida
    // Lat: 24 to 32. If Y=0 is North (90) to South (-90):
    // y_start for 32 lat = (90 - 32)/0.25 = 58/0.25 = 232
    // y_end for 24 lat = (90 - 24)/0.25 = 66/0.25 = 264
    // If Y=0 is South to North:
    // y_start for 24 lat = (24 - (-90))/0.25 = 114/0.25 = 456
    // y_end for 32 lat = (32 - (-90))/0.25 = 122/0.25 = 488
    // X for -85 to -70:
    // x_start for -85 = (-85 - (-180))/0.25 = 95/0.25 = 380
    // x_end for -70 = (-70 - (-180))/0.25 = 110/0.25 = 440
    
    // Let's just read both potential Y-ranges to be safe!
    const ranges1 = [
      { start: 230, end: 270 },
      { start: 380, end: 440 }
    ];
    
    console.log("Reading range 1 (assuming Y=0 is North):", ranges1);
    const data1 = await waveReader.read({
      type: 20, // FloatArray (Float32Array) is 20
      ranges: ranges1
    });
    
    console.log("Decoded data1 length:", data1.length);
    let validCount1 = 0;
    let nanCount1 = 0;
    let sampleValues1 = [];
    
    for (let i = 0; i < data1.length; i++) {
      if (isFinite(data1[i])) {
        validCount1++;
        if (sampleValues1.length < 10) sampleValues1.push(data1[i]);
      } else {
        nanCount1++;
      }
    }
    console.log(`Results for assumes-North: Valid floats = ${validCount1}, NaN/Infinite = ${nanCount1}`);
    if (sampleValues1.length > 0) {
      console.log("Sample valid values:", sampleValues1);
    }
    
    const ranges2 = [
      { start: 450, end: 490 },
      { start: 380, end: 440 }
    ];
    console.log("\nReading range 2 (assuming Y=0 is South):", ranges2);
    const data2 = await waveReader.read({
      type: 20,
      ranges: ranges2
    });
    
    console.log("Decoded data2 length:", data2.length);
    let validCount2 = 0;
    let nanCount2 = 0;
    let sampleValues2 = [];
    
    for (let i = 0; i < data2.length; i++) {
      if (isFinite(data2[i])) {
        validCount2++;
        if (sampleValues2.length < 10) sampleValues2.push(data2[i]);
      } else {
        nanCount2++;
      }
    }
    console.log(`Results for assumes-South: Valid floats = ${validCount2}, NaN/Infinite = ${nanCount2}`);
    if (sampleValues2.length > 0) {
      console.log("Sample valid values:", sampleValues2);
    }
    
  } catch (err) {
    console.error("Error in check_om_values:", err);
  }
}
main();
