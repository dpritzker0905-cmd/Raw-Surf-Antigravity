path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\file-reader\dist\index.d.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's find "declare class OmFileReader" and print the next 80 lines
pos = content.find("declare class OmFileReader")
if pos != -1:
    print(content[pos:pos+3000])
else:
    print("Not found")
