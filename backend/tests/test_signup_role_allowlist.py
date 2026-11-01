"""Public sign-up creates only the account types the sign-up screen offers (audit 2026-10-18, F-05).

`role` is a client-supplied string and the handler used to accept any RoleEnum name, so a bare POST with
role "Admin" returned 200 with that role stored (is_admin stayed false and /admin/* stayed 403, but the label
passes role-name gates and shows admin UI). Real handler + ephemeral SQLite file through Starlette's test client;
a refused request must leave no profile behind.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database import Base, get_db
from routes.auth_pkg import auth as auth_routes

ALLOWED = ["Surfer", "Photographer", "Hobbyist", "Approved Pro", "School", "Coach", "Shop", "Shaper", "Resort",
           "Grom Parent", "approved pro", "SURFER"]
REFUSED = ["Admin", "ADMIN", "admin", "Pro", "Comp Surfer", "Wave Pool", "Destination"]
UNKNOWN = ["Superuser", "", " Admin", "Surfer; DROP TABLE", "Grom_Parent_X"]  # " Admin" normalises to "_ADMIN"


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "signup.sqlite"
    sync_engine = create_engine(f"sqlite:///{path}")
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never touches may use types sqlite cannot create
            pass
    sync_engine.dispose()
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override():
        async with maker() as session:
            yield session

    monkeypatch.setattr(auth_routes, "rate_limit_check", lambda *a, **k: None)  # 10 sign-ups / 5 min / IP
    app = FastAPI()
    app.include_router(auth_routes.router, prefix="/api")
    app.dependency_overrides[get_db] = override
    with TestClient(app) as test_client:
        test_client.sqlite_path = path
        yield test_client


def signup(client, role, n=0):
    return client.post("/api/auth/signup", json={
        "email": f"user{n}@example.com", "password": "correct horse battery", "full_name": "Fixture User",
        "role": role})


def profile_count(client):
    engine = create_engine(f"sqlite:///{client.sqlite_path}")
    with engine.connect() as conn:
        count = conn.execute(text("select count(*) from profiles")).scalar()
    engine.dispose()
    return count


@pytest.mark.parametrize("role", ALLOWED)
def test_roles_the_screen_offers_still_sign_up(client, role):
    response = signup(client, role)
    assert response.status_code == 200, response.text
    assert response.json()["role"].lower().replace(" ", "") == role.lower().replace(" ", "")
    assert profile_count(client) == 1


@pytest.mark.parametrize("role", REFUSED)
def test_privileged_or_unoffered_roles_are_refused_and_leave_nothing(client, role):
    response = signup(client, role)
    assert response.status_code == 400
    assert response.json()["detail"] == "This account type cannot be created at sign-up"
    assert profile_count(client) == 0


@pytest.mark.parametrize("role", UNKNOWN)
def test_an_unknown_role_is_a_clean_400_not_a_crash(client, role):
    response = signup(client, role)
    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown account type"
    assert profile_count(client) == 0


def test_a_refused_attempt_does_not_block_a_real_sign_up_with_the_same_email(client):
    assert signup(client, "Admin").status_code == 400
    assert signup(client, "Surfer").status_code == 200


def test_the_allow_list_is_exactly_what_the_sign_up_screen_offers():
    """Pins the set against the screen's own role ids, so adding a role to the screen is a deliberate act here."""
    import pathlib
    import re
    source = (pathlib.Path(__file__).resolve().parents[2] / "frontend/src/components/Auth.js").read_text(encoding="utf-8")
    offered = set(re.findall(r"\{ id: '([^']+)'", source))
    allowed = {r.value for r in auth_routes.SELF_SERVE_SIGNUP_ROLES}
    assert offered <= allowed, f"the screen offers roles the server would refuse: {sorted(offered - allowed)}"
    assert allowed - offered == {"Grom Parent"}, f"unexpected extra roles: {sorted(allowed - offered)}"
