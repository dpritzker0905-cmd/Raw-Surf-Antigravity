path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\file-reader\dist\esm\index.browser.js"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's search for "wasm" or "file-format-wasm" or "wasm"
import re
matches = [m.start() for m in re.finditer(r"(wasm|file-format-wasm|WebAssembly)", content, re.IGNORECASE)]
print(f"Found {len(matches)} occurrences.")
out_path = r"c:\Users\dprit\Raw-Surf\scratch\file_reader_wasm_output.txt"
with open(out_path, "w", encoding="utf-8") as out:
    for i, pos in enumerate(matches):
        out.write(f"\n--- MATCH {i+1} ---\n")
        start = max(0, pos - 500)
        end = min(len(content), pos + 1500)
        out.write(content[start:end])
        out.write("\n")
print("Done extracting file-reader WASM references!")
