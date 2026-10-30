"""Actual surf-log list route against an isolated in-memory SQLite database.

No application startup, dotenv, provider, normal database module or real identity.
Run from repository root with the existing backend Python environment and -B.
"""
import importlib.util
import json
from pathlib import Path
import socket
import sys
import types
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, Session
from pydantic import ValidationError


def no_network(*args, **kwargs):
    raise AssertionError("Network is disabled in the surf-log fixture")


socket.create_connection = no_network
socket.socket.connect = no_network
root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / "backend"))
database = types.ModuleType("database")
database.Base = declarative_base()
database.get_db = lambda: None
sys.modules["database"] = database
security = types.ModuleType("core.security")
security.get_current_user_id = lambda: "surf-log-fixture-owner"
sys.modules["core.security"] = security

from models import SurfLogEntry  # noqa: E402

spec = importlib.util.spec_from_file_location("isolated_surf_log", root / "backend/routes/surf_data/surf_log.py")
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)
engine = create_engine("sqlite:///:memory:")
SurfLogEntry.__table__.create(engine)
owner = "surf-log-fixture-owner"


class AsyncReadSession:
    def __init__(self, session):
        self.session = session

    async def execute(self, statement):
        return self.session.execute(statement)


async def run():
    coordinate_schema = {}
    for model in [route.SurfLogCreate, route.SurfLogUpdate]:
        payload = dict(session_date=date(2026, 10, 29), latitude=None, longitude=None)
        parsed = model(**payload)
        assert parsed.latitude is None and parsed.longitude is None
        try:
            model(**{**payload, "latitude": "", "longitude": ""})
        except ValidationError:
            coordinate_schema[model.__name__] = "null accepted; empty strings rejected"
        else:
            raise AssertionError("The frontend optional-coordinate contract changed")
    fixtures = [
        ("one", owner, date(2026, 10, 26), "stoked", "spot-one"),
        ("two", owner, date(2026, 10, 25), "mellow", "spot-two"),
        ("three", owner, date(2026, 9, 24), "stoked", "spot-two"),
        ("four", owner, date(2025, 10, 23), "mellow", "spot-one"),
        ("other", "other-fixture-owner", date(2026, 10, 27), "stoked", "spot-one"),
    ]
    with Session(engine) as session:
        session.add_all(SurfLogEntry(id=i, user_id=u, session_date=d, mood=m, spot_id=s)
                        for i, u, d, m, s in fixtures)
        session.commit()
        db = AsyncReadSession(session)
        cases = [
            ("unfiltered", {}, ["one", "two", "three", "four"], 4),
            ("mood", {"mood": "stoked"}, ["one", "three"], 2),
            ("year", {"year": 2026}, ["one", "two", "three"], 3),
            ("month", {"month": 10}, ["one", "two", "four"], 3),
            ("spot", {"spot_id": "spot-one"}, ["one", "four"], 2),
            ("combined", {"year": 2026, "month": 10, "mood": "stoked", "spot_id": "spot-one"}, ["one"], 1),
            ("empty", {"mood": "happy"}, [], 0),
            ("paginated", {"mood": "stoked", "limit": 1, "offset": 1}, ["three"], 2),
            ("past-end", {"year": 2026, "offset": 10}, [], 3),
        ]
        results = []
        for name, params, expected_ids, expected_total in cases:
            args = dict(user_id=owner, current_user_id=owner, db=db, limit=50, offset=0,
                        year=None, month=None, spot_id=None, mood=None)
            args.update(params)
            response = await route.get_surf_log(**args)
            ids = [row["id"] for row in response["entries"]]
            passed = ids == expected_ids and response["total"] == expected_total
            results.append(dict(case=name, passed=passed, ids=ids, total=response["total"],
                                expected_total=expected_total))
        print(json.dumps(dict(passed=sum(item["passed"] for item in results), total=len(results),
                              coordinate_schema=coordinate_schema, results=results), indent=2))
        return all(item["passed"] for item in results)


try:
    # The synchronous database adapter has no I/O awaits, so no event-loop sockets are needed.
    coroutine = run()
    try:
        coroutine.send(None)
        raise AssertionError("Unexpected external asynchronous operation")
    except StopIteration as completed:
        success = completed.value
finally:
    engine.dispose()
sys.exit(0 if success else 1)
