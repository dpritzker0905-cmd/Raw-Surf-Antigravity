import re

filepath = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"

try:
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    print("Searching for WeatherMapLayerFileReader and getProtocolInstance in index.mjs...")
    
    # Let's search for lines containing getProtocolInstance
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if "getprotocolinstance" in line.lower() or "weathermaplayerfilereader" in line.lower() or "omfilereader" in line.lower():
            start = max(0, i - 3)
            end = min(len(lines), i + 4)
            print(f"Match found at line {i+1}:")
            for j in range(start, end):
                marker = "-->" if j == i else "   "
                print(f"{marker} L{j+1}: {lines[j]}")
            print("=" * 60)
            
except Exception as e:
    print(f"Error: {e}")
