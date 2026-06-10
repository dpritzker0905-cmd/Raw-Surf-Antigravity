from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def test_ingestion_endpoints_admin_auth():
    """Verify that all manual and direct ingestion endpoints require admin authentication."""
    endpoints = [
        "/api/weather/ingest",
        "/api/weather/ingest_euro_wind_direct",
        "/api/weather/ingest_icon_wind_direct",
        "/api/weather/ingest_gfs_wind_global_direct",
        "/api/weather/ingest_copernicus",
        "/api/weather/ingest_gfs_pressure_direct",
        "/api/weather/ingest_icon_pressure_direct",
        "/api/weather/ingest_euro_pressure_direct",
        "/api/weather/ingest_euro_estimates_direct",
    ]
    for endpoint in endpoints:
        response = client.post(endpoint)
        # Without authorization headers, it must fail auth validation (401 Unauthorized)
        assert response.status_code == 401

def test_diagnostics_log_requires_admin_auth():
    """Verify that diagnostics-log endpoint requires admin authentication."""
    response = client.get("/api/weather/diagnostics-log")
    assert response.status_code in (401, 403)

def test_ingest_public_trigger_removed():
    """Verify that ingest_public_trigger has been removed and returns 404."""
    response = client.post("/api/weather/ingest_public_trigger")
    assert response.status_code == 404

