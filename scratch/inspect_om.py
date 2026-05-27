import urllib.request
import json
import os

# 1. Fetch latest.json to get reference_time and first valid_time
meta_url = "https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/latest.json"
print("Fetching metadata from", meta_url)
req = urllib.request.Request(meta_url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as r:
    meta = json.loads(r.read().decode())

ref_time = meta["reference_time"] # e.g. "2026-05-24T12:00:00Z"
valid_time0 = meta["valid_times"][0] # e.g. "2026-05-24T12:00Z"

# Parse components
# GFS wave models are typically under folders like ncep_gfswave025
# The template constructed in index.mjs maps it to:
# {modelRunYear}/{modelRunMonth}/{modelRunDay}/{modelRunHour}00Z/{validYear}-{validMonth}-{validDay}T{validHour}00.om
# Let's parse ref_time and valid_time0
from datetime import datetime
ref_dt = datetime.strptime(ref_time.replace("Z", ""), "%Y-%m-%dT%H:%M:%S")
valid_dt = datetime.strptime(valid_time0.replace("Z", ""), "%Y-%m-%dT%H:%M")

om_path = f"{ref_dt.year:04d}/{ref_dt.month:02d}/{ref_dt.day:02d}/{ref_dt.hour:02d}00Z/{valid_dt.year:04d}-{valid_dt.month:02d}-{valid_dt.day:02d}T{valid_dt.hour:02d}00.om"
om_url = f"https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/{om_path}"
print("Constructed .om URL:", om_url)

# 2. Download a chunk of the .om file (first 4KB or full file)
# The first 4KB should contain headers
try:
    print("Downloading .om header chunk...")
    req_om = urllib.request.Request(om_url, headers={'User-Agent': 'Mozilla/5.0'})
    # Let's download the whole file since it's probably small
    with urllib.request.urlopen(req_om) as response:
        om_data = response.read()
    print(f"Downloaded {len(om_data)} bytes of .om file")
    
    # Save the file locally so we can inspect it or read it
    local_om = r"c:\Users\dprit\Raw-Surf\scratch\sample.om"
    with open(local_om, "wb") as f:
        f.write(om_data)
    print("Saved sample to", local_om)
    
except Exception as e:
    print("Failed to download/parse:", e)
