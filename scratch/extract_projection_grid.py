path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

pos = content.find("class ProjectionGrid")
out_path = r"c:\Users\dprit\Raw-Surf\scratch\projection_grid_output.txt"
with open(out_path, "w", encoding="utf-8") as out:
    if pos != -1:
        out.write(content[pos:pos+3000])
    else:
        out.write("No class ProjectionGrid found")
print("Done extracting ProjectionGrid class!")
