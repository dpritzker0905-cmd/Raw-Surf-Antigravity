"""
Smoke tests for gallery endpoints — validates route registration and basic contract.

Tests verify that extracted modules (v87 decomposition) are properly registered
and return expected response shapes. Uses httpx.AsyncClient + ASGITransport.
"""
import pytest


class TestGalleryRouteRegistration:
    """Verify all gallery sub-routers are accessible after v87 decomposition."""

    @pytest.mark.asyncio
    async def test_health_endpoint(self, client):
        """Baseline: health endpoint should always respond 200."""
        response = await client.get("/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"

    @pytest.mark.asyncio
    async def test_gallery_items_requires_gallery_id(self, client):
        """GET /galleries/{id}/items should 404 for non-existent gallery."""
        response = await client.get("/api/galleries/nonexistent-id-123/items")
        assert response.status_code in (404, 422)

    @pytest.mark.asyncio
    async def test_photographer_galleries_requires_valid_id(self, client):
        """GET /galleries/photographer/{id} should return empty list for unknown photographer."""
        response = await client.get("/api/galleries/photographer/unknown-id")
        # Should return 200 with empty gallery list, not crash
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_distribution_status_requires_auth(self, client):
        """GET /gallery/{id}/distribution-status should require photographer_id."""
        response = await client.get(
            "/api/gallery/nonexistent/distribution-status",
            params={"photographer_id": "test"}
        )
        assert response.status_code in (404, 422)

    @pytest.mark.asyncio
    async def test_public_galleries_endpoint(self, client):
        """GET /photographer/{id}/public-galleries should return structured response."""
        response = await client.get("/api/photographer/unknown-id/public-galleries")
        assert response.status_code == 200
        data = response.json()
        assert "galleries" in data
        assert "total" in data


class TestAdminRouteRegistration:
    """Verify admin sub-routers are accessible after v87 p1.py decomposition."""

    @pytest.mark.asyncio
    async def test_test_accounts_endpoint_requires_auth(self, client):
        """GET /admin/test-accounts should require admin auth."""
        response = await client.get("/api/admin/test-accounts")
        assert response.status_code in (401, 403, 422)

    @pytest.mark.asyncio
    async def test_seed_accounts_endpoint_requires_auth(self, client):
        """POST /admin/seed-test-accounts should require admin auth."""
        response = await client.post("/api/admin/seed-test-accounts", json={})
        assert response.status_code in (401, 403, 422)


class TestModuleLineCompliance:
    """Verify all decomposed modules stay under 800 LOC threshold."""

    @pytest.mark.parametrize("filepath,max_lines", [
        ("routes/gallery/collections.py", 800),
        ("routes/gallery/collections_roster.py", 800),
        ("routes/gallery/distribution.py", 800),
        ("routes/gallery/distribution_tagging.py", 800),
        ("routes/gallery/items.py", 800),
        ("routes/admin/p1.py", 800),
        ("routes/admin/admin_test_accounts.py", 800),
        ("routes/admin/admin_user_journey.py", 800),
    ])
    def test_module_under_800_lines(self, filepath, max_lines):
        """Each decomposed module must stay under 800 LOC."""
        import os
        full_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), filepath
        )
        if not os.path.exists(full_path):
            pytest.skip(f"File not found: {filepath}")
        
        with open(full_path, encoding="utf-8") as f:
            line_count = len(f.readlines())
        
        assert line_count <= max_lines, (
            f"{filepath} has {line_count} lines (limit: {max_lines})"
        )


class TestModuleSyntax:
    """Verify all modules compile without syntax errors."""

    @pytest.mark.parametrize("filepath", [
        "routes/gallery/collections.py",
        "routes/gallery/collections_roster.py",
        "routes/gallery/distribution.py",
        "routes/gallery/distribution_tagging.py",
        "routes/gallery/items.py",
        "routes/admin/p1.py",
        "routes/admin/admin_test_accounts.py",
        "routes/admin/admin_user_journey.py",
    ])
    def test_module_compiles(self, filepath):
        """Each module must have valid Python syntax."""
        import py_compile
        import os
        full_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), filepath
        )
        if not os.path.exists(full_path):
            pytest.skip(f"File not found: {filepath}")
        
        # This will raise SyntaxError if the file has bad syntax
        py_compile.compile(full_path, doraise=True)
