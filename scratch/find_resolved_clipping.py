import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

pos = content.find("resolvedClippingOptions")
while pos != -1:
    print(content[pos-200:pos+300])
    pos = content.find("resolvedClippingOptions", pos + 1)
