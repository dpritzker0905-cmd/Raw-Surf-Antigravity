import os

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo"
if os.path.exists(path):
    for root, dirs, files in os.walk(path):
        for f in files:
            if f.endswith(".wasm") or "wasm" in f.lower():
                print("Found WASM-related file:", os.path.join(root, f))
else:
    print("Folder does not exist")
