"""Offline Gear Hub catalog response controls; no HTTP or purchase requests."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

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


if __name__ == "__main__":
    unittest.main()
