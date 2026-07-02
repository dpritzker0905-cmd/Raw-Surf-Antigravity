"""One-shot probe of the deployed netlify /api/weather/grid proxy — a debugging script kept as a
live smoke test. Gated like the rest of the live estate (conftest skips modules with BASE_URL when
REACT_APP_BACKEND_URL is unset): it asserts nothing structural and needs network + a live deploy,
so offline runs were failing on httpx.ReadTimeout (2026-07-02)."""
import os

import httpx
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dev--rawsurf.netlify.app').rstrip('/')


def test_api_proxy():
    url = f"{BASE_URL}/api/weather/grid"
    params = {
        "model": "GFS",
        "domain": "wind",
        "layer": "wind",
        "valid_time": "2026-06-10T12:00:00Z",
        "bbox": "-85,24,-79,31"
    }

    print(f"Sending query to weather api/weather/grid: {url}")
    res = httpx.get(url, params=params, timeout=15.0)
    print(f"Status Code: {res.status_code}")
    print(f"Response: {res.text[:500]}")
    assert res.status_code == 200
