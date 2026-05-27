import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's search for clippingOptions inside the main protocol settings or resolver
pos = content.find("clippingOptions:")
while pos != -1:
    print(content[pos-100:pos+300])
    pos = content.find("clippingOptions:", pos + 1)
