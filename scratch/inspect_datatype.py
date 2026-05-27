path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\file-reader\dist\index.d.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's search for "enum OmDataType" or "const OmDataType" or "OmDataType"
import re
pos = content.find("OmDataType")
while pos != -1:
    print(content[pos-100:pos+500])
    pos = content.find("OmDataType", pos + 1)
