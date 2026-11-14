"""Gear catalog controls, including in-process ASGI GETs; no external requests."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

import pytest

from fastapi.encoders import jsonable_encoder
from sqlalchemy.dialects import postgresql


class Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def scalar_one_or_none(self):
        return self.rows[0] if self.rows else None


class Session:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return Result(self.rows)


def finish_immediate(coroutine):
    """Only the immediate in-memory session may satisfy this route's await."""
    try:
        coroutine.send(None)
    except StopIteration as result:
        return result.value
    finally:
        coroutine.close()
    raise AssertionError("Catalog unexpectedly suspended beyond the fake session")


class TestGearCatalogAffiliateUrl(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).parents[1] / "routes/commerce/gear_hub.py"
        spec = importlib.util.spec_from_file_location("gear_catalog_under_test", path)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def item(self, **changes):
        values = dict(
            id="gear-a", name="Camera A", description="Catalog description",
            image_url="/fixture/camera.jpg", category=self.module.GearCategory.CAMERA,
            brand="Fixture brand", price_credits=120.0, retail_price_usd=125.0,
            affiliate_partner="fixture", affiliate_url="https://retailer.example.invalid/a?ref=surf&size=large",
            is_featured=True, stock_status="in_stock", purchase_count=3,
        )
        values.update(changes)
        return SimpleNamespace(**values)

    def catalog(self, rows, **options):
        db = Session(rows)
        result = finish_immediate(self.module.get_gear_catalog(db=db, limit=50, **options))
        self.assertEqual(len(db.statements), 1)
        return jsonable_encoder(result), db.statements[0]

    def test_catalog_exposes_exact_retained_url_and_existing_metadata(self):
        item = self.item()
        rows, _ = self.catalog([item])
        expected = vars(item).copy()
        expected["category"] = "camera"
        self.assertEqual(rows, [expected])

    def test_catalog_and_detail_agree_without_a_second_catalog_query(self):
        item = self.item()
        rows, _ = self.catalog([item])
        detail_db = Session([item])
        detail = finish_immediate(self.module.get_gear_item(item.id, db=detail_db))
        self.assertEqual(rows[0]["affiliate_url"], detail["affiliate_url"])
        self.assertEqual(len(detail_db.statements), 1)

    def test_multiple_links_stay_attached_to_their_original_rows(self):
        rows, _ = self.catalog([
            self.item(id="b", affiliate_url="https://retailer.example.invalid/b?x=1&y=2"),
            self.item(id="a", affiliate_url="https://retailer.example.invalid/a#details"),
        ])
        self.assertEqual([(r["id"], r["affiliate_url"]) for r in rows], [
            ("b", "https://retailer.example.invalid/b?x=1&y=2"),
            ("a", "https://retailer.example.invalid/a#details"),
        ])

    def test_empty_results_remain_empty(self):
        rows, _ = self.catalog([])
        self.assertEqual(rows, [])

    def test_catalog_retains_filters_sort_and_pagination(self):
        _, statement = self.catalog([], category="camera", featured_only=True, search="lens", offset=4)
        sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        for expected in ("gear_catalog.is_active = true", "gear_catalog.category = 'CAMERA'",
                         "gear_catalog.is_featured = true", "gear_catalog.name ILIKE", "gear_catalog.brand ILIKE",
                         "ORDER BY gear_catalog.is_featured DESC, gear_catalog.created_at DESC", "LIMIT 50 OFFSET 4"):
            self.assertIn(expected, sql)

    def test_invalid_category_keeps_existing_ignored_filter_behavior(self):
        _, statement = self.catalog([], category="not-a-category")
        sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        self.assertNotIn("gear_catalog.category =", sql)
        self.assertIn("gear_catalog.is_active = true", sql)


@pytest.mark.asyncio
@pytest.mark.parametrize("path,expected_ids", [
    ("/gear-hub", ["lens-featured", "camera-new", "camera-old"]),
    ("/gear-hub/camera-new", ["camera-new"]),
    ("/gear-hub?category=camera", ["camera-new", "camera-old"]),
    ("/gear-hub?featured_only=true", ["lens-featured"]),
    ("/gear-hub?search=camera-new", ["camera-new"]),
    ("/gear-hub?limit=1&offset=1", ["camera-new"]),
    ("/gear-hub?search=absent", []),
])
async def test_mounted_catalog_with_original_dependency(monkeypatch, path, expected_ids):
    """Exercise real async SQLite and FastAPI serialization without a server."""
    from datetime import datetime

    import httpx
    from fastapi import FastAPI
    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    import database

    source = Path(__file__).parents[1] / "routes/commerce/gear_hub.py"
    spec = importlib.util.spec_from_file_location("mounted_gear_catalog_under_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(database, "AsyncSessionLocal", sessions)
    statements = []

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def record_sql(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    def item(ident, category, featured, day, active=True):
        return module.GearCatalog(
            id=ident, name="Fixture " + ident, description="Catalog fixture",
            category=category, brand="Fixture brand", price_credits=12.5,
            retail_price_usd=15.0, affiliate_partner="fixture",
            affiliate_url="https://retailer.example.invalid/" + ident + "?ref=surf&x=1#details",
            is_active=active, is_featured=featured, stock_status="in_stock",
            purchase_count=0, created_at=datetime(2026, 11, day),
        )

    try:
        async with engine.begin() as connection:
            await connection.run_sync(module.GearCatalog.__table__.create)
            stores = (await connection.exec_driver_sql("PRAGMA database_list")).all()
            assert stores and all(row[2] == "" for row in stores)
        async with sessions() as session:
            session.add_all([
                item("camera-new", module.GearCategory.CAMERA, False, 3),
                item("lens-featured", module.GearCategory.LENS, True, 1),
                item("camera-old", module.GearCategory.CAMERA, False, 2),
                item("inactive", module.GearCategory.CAMERA, True, 5, False),
            ])
            await session.commit()
        app = FastAPI()
        app.include_router(module.router, prefix="/api")
        route_path = "/api/gear-hub/{item_id}" if path == "/gear-hub/camera-new" else "/api/gear-hub"
        route = next(route for route in app.routes if getattr(route, "path", None) == route_path)
        assert route.endpoint is (module.get_gear_item if "{item_id}" in route_path else module.get_gear_catalog)
        assert module.get_db is database.get_db
        assert route.dependant.dependencies[0].call is database.get_db
        assert not app.dependency_overrides
        statements.clear()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=True),
            base_url="http://in-process.invalid", trust_env=False,
        ) as client:
            response = await client.get("/api" + path)
        assert response.status_code == 200
        body = response.json()
        rows = [body] if isinstance(body, dict) else body
        assert [row["id"] for row in rows] == expected_ids
        for row in rows:
            assert row["affiliate_url"] == "https://retailer.example.invalid/" + row["id"] + "?ref=surf&x=1#details"
            assert row["name"] == "Fixture " + row["id"]
            assert row["description"] == "Catalog fixture"
            assert row["brand"] == "Fixture brand"
            assert row["price_credits"] == 12.5 and row["retail_price_usd"] == 15.0
            assert row["affiliate_partner"] == "fixture" and row["purchase_count"] == 0
            assert row["stock_status"] == "in_stock"
            assert row["category"] == ("lens" if row["id"] == "lens-featured" else "camera")
            assert row["is_featured"] is (row["id"] == "lens-featured")
        assert len(statements) == 1
        assert statements[0].lstrip().upper().startswith("SELECT")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    unittest.main()
