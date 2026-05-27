filepath = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"

try:
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    lines = content.split('\n')
    start_line = -1
    for i, line in enumerate(lines):
        if "const omProtocol = async" in line:
            start_line = i
            break
            
    if start_line != -1:
        print(f"omProtocol starts at L{start_line+1}")
        # Print next 100 lines
        for j in range(start_line, min(len(lines), start_line + 120)):
            print(f"L{j+1}: {lines[j]}")
            
except Exception as e:
    print(f"Error: {e}")
