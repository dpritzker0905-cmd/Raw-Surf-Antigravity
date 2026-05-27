path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\file-reader\dist\index.d.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Print lines containing export or class or interface
lines = content.split("\n")
for i, line in enumerate(lines):
    if "export " in line or "class " in line or "interface " in line:
        print(f"{i+1}: {line}")
