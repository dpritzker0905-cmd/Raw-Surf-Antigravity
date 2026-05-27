import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

pos = content.find("getLinearInterpolatedValue")
while pos != -1:
    print(content[pos-100:pos+500])
    pos = content.find("getLinearInterpolatedValue", pos + 1)
