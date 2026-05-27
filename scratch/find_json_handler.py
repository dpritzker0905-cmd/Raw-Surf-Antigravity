import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Search for type == "json" or similar in omProtocol
pos = content.find('type === "json"')
while pos != -1:
    print(content[pos-100:pos+400])
    pos = content.find('type === "json"', pos + 1)
