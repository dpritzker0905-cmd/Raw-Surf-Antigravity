import { FileBackend, OmFileReader } from "../frontend/node_modules/@openmeteo/file-reader/dist/esm/index.js";

async function main() {
  try {
    const backend = new FileBackend("scratch/sample.om");
    const reader = await OmFileReader.create(backend);
    
    // Read crs_wkt
    const crsReader = await reader.getChildByName("crs_wkt");
    if (crsReader) {
      const crsVal = crsReader.readScalar(crsReader.dataType());
      console.log("crs_wkt value:", crsVal);
    }
    
    // Read coordinates
    const coordReader = await reader.getChildByName("coordinates");
    if (coordReader) {
      const coordVal = coordReader.readScalar(coordReader.dataType());
      console.log("coordinates value:", coordVal);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}
main();
