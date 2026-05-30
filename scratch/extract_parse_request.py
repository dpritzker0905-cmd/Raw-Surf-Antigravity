path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

pos = content.find("const parseRequest =")
out_path = r"c:\Users\dprit\Raw-Surf\scratch\parse_request_output.txt"
with open(out_path, "w", encoding="utf-8") as out:
    if pos != -1:
        out.write(content[pos:pos+4000])
    else:
        # try case-insensitive or function name search
        match = re.search(r"\bparseRequest\b.*?}", content, re.DOTALL)
        if match:
            out.write(match.group(0))
        else:
            out.write("No parseRequest found")
print("Done extracting parseRequest!")
