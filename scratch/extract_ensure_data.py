path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

pos = content.find("const ensureData = async")
out_path = r"c:\Users\dprit\Raw-Surf\scratch\ensure_data_output.txt"
with open(out_path, "w", encoding="utf-8") as out:
    if pos != -1:
        out.write(content[pos:pos+2000])
    else:
        out.write("No ensureData found")
print("Done extracting ensureData!")
