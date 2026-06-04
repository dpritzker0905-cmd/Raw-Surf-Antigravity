from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def test_ingestion_endpoints_admin_auth():
    """Verify that all manual and direct ingestion endpoints require admin authentication."""
    endpoints = [
        "/api/weather/ingest",
        "/api/weather/ingest_euro_wind_direct",
        "/api/weather/ingest_icon_wind_direct",
        "/api/weather/ingest_copernicus"
    ]
    for endpoint in endpoints:
        response = client.post(endpoint)
        # Without authorization headers, it must fail auth validation (401 Unauthorized)
        assert response.status_code == 401
