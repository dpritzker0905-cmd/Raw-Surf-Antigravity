import os

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\file-reader"
if os.path.exists(path):
    for root, dirs, files in os.walk(path):
        for f in files:
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, path)
            print(f"File: {rel_path} ({os.path.getsize(full_path)} bytes)")
else:
    print("Folder does not exist")
