import httpx

def test_api_proxy():
    url = "https://dev--rawsurf.netlify.app/api/weather/grid"
    params = {
        "model": "GFS",
        "domain": "wind",
        "layer": "wind",
        "valid_time": "2026-06-10T12:00:00Z",
        "bbox": "-85,24,-79,31"
    }
    
    print(f"Sending query to Netlify weather api/weather/grid: {url}")
    res = httpx.get(url, params=params, timeout=15.0)
    print(f"Status Code: {res.status_code}")
    print(f"Response: {res.text}")
