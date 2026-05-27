import re

filepath = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"

try:
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    print("Searching for dispose in WeatherMapLayerFileReader inside index.mjs...")
    lines = content.split('\n')
    
    # Let's find WeatherMapLayerFileReader class block
    reader_start = -1
    for i, line in enumerate(lines):
        if "class WeatherMapLayerFileReader" in line:
            reader_start = i
            break
            
    if reader_start != -1:
        print(f"WeatherMapLayerFileReader starts at L{reader_start+1}")
        # Print next 200 lines to find constructor, setToOmFile, and dispose
        for j in range(reader_start, reader_start + 250):
            if "dispose" in lines[j] or "setToOmFile" in lines[j] or "wasm" in lines[j].lower():
                print(f"L{j+1}: {lines[j].strip()}")
                # Print context
                for c in range(max(0, j - 2), min(len(lines), j + 6)):
                    m = "-->" if c == j else "   "
                    print(f"{m}  L{c+1}: {lines[c]}")
                print("-" * 50)
                
except Exception as e:
    print(f"Error: {e}")
