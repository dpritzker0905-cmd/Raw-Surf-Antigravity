import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's find Worker initialization
worker_matches = [m.start() for m in re.finditer("Worker", content)]
print(f"Found {len(worker_matches)} matches for 'Worker'")

# Find messages sent to worker (e.g. postMessage)
post_matches = [m.start() for m in re.finditer("postMessage", content)]
print(f"Found {len(post_matches)} matches for 'postMessage'")

# Search for colorScale usage inside the main body
scale_matches = [m.start() for m in re.finditer("colorScale", content)]
print(f"Found {len(scale_matches)} matches for 'colorScale'")

# Print snippet of code around first worker match
for idx, pos in enumerate(worker_matches[:5]):
    start = max(0, pos - 150)
    end = min(len(content), pos + 150)
    print(f"\n--- Worker Match {idx} ---")
    print(content[start:end])

# Print snippet of code around first postMessage match
for idx, pos in enumerate(post_matches[:5]):
    start = max(0, pos - 150)
    end = min(len(content), pos + 150)
    print(f"\n--- postMessage Match {idx} ---")
    print(content[start:end])
