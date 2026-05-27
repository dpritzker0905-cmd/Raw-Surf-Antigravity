path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

import re
# Let's search for "ensureData" or "wasm" or "WASM" or "WebAssembly"
matches = [m.start() for m in re.finditer(r"(ensureData|wasm|WASM|WebAssembly|om_reader_wasm)", content, re.IGNORECASE)]
print(f"Found {len(matches)} occurrences.")
out_path = r"c:\Users\dprit\Raw-Surf\scratch\wasm_output.txt"
with open(out_path, "w", encoding="utf-8") as out:
    for i, pos in enumerate(matches):
        out.write(f"\n--- MATCH {i+1} ---\n")
        start = max(0, pos - 500)
        end = min(len(content), pos + 1500)
        out.write(content[start:end])
        out.write("\n")
print("Done extracting WASM/ensureData details!")
