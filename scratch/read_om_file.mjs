import { FileBackend, OmFileReader } from "../frontend/node_modules/@openmeteo/file-reader/dist/esm/index.js";

async function main() {
  try {
    const backend = new FileBackend("scratch/sample.om");
    console.log("File Backend created, size:", await backend.count(), "bytes");
    
    const reader = await OmFileReader.create(backend);
    console.log("Reader initialized! Name of file root:", reader.getName());
    
    const numChildren = reader.numberOfChildren();
    console.log("Number of children/variables at root:", numChildren);
    
    for (let i = 0; i < numChildren; i++) {
      const child = await reader.getChild(i);
      if (child) {
        console.log(`\n--- Child ${i}: ${child.getName()} ---`);
        console.log("Dimensions:", child.getDimensions());
        console.log("DataType:", child.dataType());
        console.log("Compression:", child.compression());
        console.log("ScaleFactor:", child.scaleFactor());
        console.log("AddOffset:", child.addOffset());
        console.log("Number of grandchildren:", child.numberOfChildren());
        
        // Print grandchildren
        const numGrand = child.numberOfChildren();
        for (let j = 0; j < numGrand; j++) {
          const grand = await child.getChild(j);
          if (grand) {
            console.log(`  Grandchild ${j}: ${grand.getName()} - Dimensions:`, grand.getDimensions());
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in main:", err);
  }
}
main();
