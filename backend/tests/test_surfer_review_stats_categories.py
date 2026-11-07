"""Offline controls for the actual surfer stats response and unchanged query contract."""
import importlib.util
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql


@pytest.fixture(scope="module")
def discovery():
    # Load the real module without executing the reviews package's unrelated write routes.
    path = Path(__file__).parents[1] / "routes/reviews_pkg/review_discovery.py"
    spec = importlib.util.spec_from_file_location("surfer_stats_discovery_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Result:
    def __init__(self, value):
        self.value = value

    def first(self):
        return self.value

    def scalars(self):
        return self

    def all(self):
        return self.value


class Session:
    def __init__(self, reviews, aggregate=(Decimal("4.26"), 9)):
        self.results = [Result(aggregate), Result(reviews)]
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        assert self.results, "Stats must keep the two-query contract"
        return self.results.pop(0)


def review(**changes):
    values = dict(
        id="review-a", rating=3, communication_rating=5, punctuality_rating=1,
        comment="Clear communication", created_at=datetime(2026, 11, 1, 15, 4, tzinfo=timezone.utc),
        reviewer=SimpleNamespace(full_name="Photographer A", avatar_url="/avatars/a.jpg"),
        moderation_notes="Private moderation detail", reviewer_id="private-id",
    )
    values.update(changes)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
@pytest.mark.parametrize("communication,punctuality", [(5, 1), (2, 4)])
async def test_distinct_scores_and_existing_metadata(discovery, communication, punctuality):
    stored = review(communication_rating=communication, punctuality_rating=punctuality)
    db = Session([stored])
    result = await discovery.get_surfer_review_stats("surfer-a", db=db)
    assert result == {
        "average_rating": 4.3,
        "total_reviews": 9,
        "recent_reviews": [{
            "id": "review-a", "reviewer_name": "Photographer A", "reviewer_avatar": "/avatars/a.jpg",
            "rating": 3, "communication_rating": communication, "punctuality_rating": punctuality,
            "comment": "Clear communication", "created_at": "2026-11-01T15:04:00+00:00",
        }],
    }
    assert (stored.rating, stored.communication_rating, stored.punctuality_rating) == (3, communication, punctuality)
    assert len(db.statements) == 2 and not db.results


@pytest.mark.asyncio
@pytest.mark.parametrize("communication,punctuality", [(None, None), (None, 4), (2, None)])
async def test_nullable_categories_are_explicit_without_fallback(discovery, communication, punctuality):
    db = Session([review(communication_rating=communication, punctuality_rating=punctuality)])
    result = await discovery.get_surfer_review_stats("surfer-a", db=db)
    row = result["recent_reviews"][0]
    assert row["communication_rating"] == communication
    assert row["punctuality_rating"] == punctuality
    assert row["rating"] == 3


@pytest.mark.asyncio
async def test_missing_reviewer_keeps_scores_and_existing_fallbacks(discovery):
    db = Session([review(reviewer=None, comment=None)])
    result = await discovery.get_surfer_review_stats("surfer-a", db=db)
    row = result["recent_reviews"][0]
    assert row["reviewer_name"] == "Unknown"
    assert row["reviewer_avatar"] is None
    assert row["comment"] is None
    assert (row["communication_rating"], row["punctuality_rating"]) == (5, 1)
    assert "moderation_notes" not in row and "reviewer_id" not in row


@pytest.mark.asyncio
async def test_empty_stats_preserve_zero_aggregate_and_empty_list(discovery):
    db = Session([], aggregate=(None, 0))
    assert await discovery.get_surfer_review_stats("surfer-a", db=db) == {
        "average_rating": 0.0, "total_reviews": 0, "recent_reviews": [],
    }
    assert len(db.statements) == 2 and not db.results


@pytest.mark.asyncio
async def test_multiple_reviews_preserve_query_result_order_and_aggregate(discovery):
    rows = [
        review(id="newest", communication_rating=1, punctuality_rating=5),
        review(id="middle", communication_rating=3, punctuality_rating=None),
        review(id="oldest", communication_rating=None, punctuality_rating=2),
    ]
    result = await discovery.get_surfer_review_stats("surfer-a", db=Session(rows, aggregate=(Decimal("3.74"), 17)))
    assert result["average_rating"] == 3.7 and result["total_reviews"] == 17
    assert [(r["id"], r["communication_rating"], r["punctuality_rating"]) for r in result["recent_reviews"]] == [
        ("newest", 1, 5), ("middle", 3, None), ("oldest", None, 2),
    ]


@pytest.mark.asyncio
async def test_both_queries_preserve_filters_and_recent_limit_order_and_eager_reviewer(discovery):
    db = Session([])
    await discovery.get_surfer_review_stats("surfer-a", db=db)
    assert len(db.statements) == 2
    aggregate, recent = db.statements
    sql = [str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
           for statement in db.statements]
    for query in sql:
        assert "reviews.reviewee_id = 'surfer-a'" in query
        assert "reviews.review_type = 'photographer_to_surfer'" in query
        assert "reviews.status = 'approved'" in query
    assert "avg(reviews.rating)" in sql[0] and "count(reviews.id)" in sql[0]
    assert "LIMIT" not in sql[0] and "ORDER BY" not in sql[0]
    assert "ORDER BY reviews.created_at DESC" in sql[1] and "LIMIT 3" in sql[1]
    assert aggregate._limit_clause is None and recent._limit_clause.value == 3
    options = list(recent._with_options)
    assert len(options) == 1
    assert options[0].context[0].strategy == (("lazy", "selectin"),)
    assert options[0].path.path[1].key == "reviewer"
