import urllib.request
import json

url = "https://marine-api.open-meteo.com/v1/marine?latitude=25.0&longitude=-80.0&hourly=wave_height&models=ncep_gfswave025"
try:
    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
        hourly = data.get("hourly", {})
        wave_heights = hourly.get("wave_height", [])
        print(f"Current live wave heights at 25.0, -80.0 (Atlantic Ocean):")
        print(f"First 10 hours: {wave_heights[:10]}")
        print(f"Max wave height: {max(wave_heights) if wave_heights else 'None'} m")
        print(f"Min wave height: {min(wave_heights) if wave_heights else 'None'} m")
except Exception as e:
    print(f"Error fetching marine data: {e}")
