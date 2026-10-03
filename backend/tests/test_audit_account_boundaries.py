"""HTTP/ORM probes: changing caller identity must not grant another account's authority."""
import asyncio
import importlib.util
from pathlib import Path
import sys
from types import ModuleType

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token, get_user_id_from_jwt_or_query
from database import get_db
from models import Profile, RoleEnum


@pytest.fixture
def accounts(tmp_path, monkeypatch):
    # Import the complete production module, without the global server's background workers.
    path = Path(__file__).parents[1] / 'routes/profiles/profiles.py'
    # A namespace keeps relative imports real without loading every application router.
    package = ModuleType('account_boundary_routes')
    package.__path__ = [str(path.parent)]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    spec = importlib.util.spec_from_file_location('account_boundary_routes.profiles', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    dbfile = tmp_path / 'accounts.sqlite'
    engine = create_engine(f'sqlite:///{dbfile}')
    Profile.__table__.create(engine)
    with engine.begin() as conn:
        conn.execute(Profile.__table__.insert(), [dict(
            id=actor, user_id=actor, email=f'{actor}@example.invalid',
            role=RoleEnum.SURFER, credit_balance=10, subscription_tier='free',
            is_private=True, is_admin=actor == 'admin',
        ) for actor in ('owner', 'other', 'admin')])
        conn.execute(Profile.__table__.update().where(Profile.id == 'owner').values(
            username='owner', home_latitude=28.0, home_longitude=-80.0, home_location_name='Private home'))
    async_engine = create_async_engine(f'sqlite+aiosqlite:///{dbfile}')
    sessions = async_sessionmaker(async_engine, expire_on_commit=False)

    async def database():
        async with sessions() as session:
            yield session

    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    app.dependency_overrides[get_db] = database

    @app.get('/identity')
    def identity(actor: str = Depends(get_user_id_from_jwt_or_query)):
        return {'actor': actor}

    with TestClient(app) as client:
        yield client, engine
    asyncio.run(async_engine.dispose())
    engine.dispose()


def headers(actor):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': actor})}


def row(engine, actor='owner'):
    with engine.connect() as conn:
        return conn.execute(select(Profile.__table__).where(Profile.id == actor)).mappings().one()


@pytest.mark.parametrize('actor,status', [(None, 401), ('other', 403), ('owner', 200)])
def test_profile_edit_requires_owner(accounts, actor, status):
    client, engine = accounts
    response = client.patch('/api/profiles/owner', json={'bio': 'Updated bio'},
                            headers=headers(actor) if actor else {})
    assert response.status_code == status
    assert row(engine)['bio'] == ('Updated bio' if actor == 'owner' else None)
    assert row(engine)['credit_balance'] == 10


@pytest.mark.parametrize('field,value', [('credit_balance', 999), ('subscription_tier', 'premium'),
                                        ('is_admin', True)])
def test_profile_edit_cannot_mass_assign_privileges(accounts, field, value):
    client, engine = accounts
    response = client.patch('/api/profiles/owner', json={field: value}, headers=headers('owner'))
    assert response.status_code == 422
    profile = row(engine)
    assert profile['credit_balance'] == 10
    assert profile['subscription_tier'] == 'free'
    assert profile['is_admin'] is False


@pytest.mark.parametrize('actor,status', [(None, 401), ('other', 403), ('owner', 403), ('admin', 200)])
def test_direct_subscription_assignment_requires_admin(accounts, actor, status):
    client, engine = accounts
    response = client.post('/api/profiles/owner/subscription', json={'subscription_tier': 'premium'},
                           headers=headers(actor) if actor else {})
    assert response.status_code == status
    assert row(engine)['subscription_tier'] == ('premium' if actor == 'admin' else 'free')


@pytest.mark.parametrize('query', ['', '?user_id=owner', '?user_id=other'])
def test_query_identity_is_not_authentication(accounts, query):
    client, _ = accounts
    assert client.get('/identity' + query).status_code == 401


@pytest.mark.parametrize('query', ['', '?user_id=owner', '?user_id=other'])
def test_query_identity_does_not_override_verified_subject(accounts, query):
    client, _ = accounts
    response = client.get('/identity' + query, headers=headers('owner'))
    assert response.status_code == 200
    assert response.json() == {'actor': 'owner'}


def test_jwt_missing_subject_cannot_fall_back_to_query_identity(accounts):
    client, _ = accounts
    token = create_access_token({'role': 'surfer'})
    response = client.get('/identity?user_id=other', headers={'Authorization': 'Bearer ' + token})
    assert response.status_code == 401


@pytest.mark.parametrize('path', ['/api/profiles/owner', '/api/profiles/by-username/owner', '/api/profiles'])
@pytest.mark.parametrize('actor', [None, 'other'])
def test_public_profile_does_not_expose_account_fields(accounts, path, actor):
    client, engine = accounts
    with engine.begin() as conn:
        conn.execute(Profile.__table__.update().where(Profile.id == 'owner').values(
            role=RoleEnum.PHOTOGRAPHER, is_live=True))
    response = client.get(path, headers=headers(actor) if actor else {})
    assert response.status_code == 200
    body = response.json()
    profile = next(p for p in body if p['id'] == 'owner') if isinstance(body, list) else body
    assert profile['id'] == 'owner'
    assert profile['username'] == 'owner'
    assert not {'email', 'credit_balance', 'home_latitude', 'home_longitude', 'home_location_name'} & profile.keys()


@pytest.mark.parametrize('path', ['/api/profiles/owner', '/api/profiles/by-username/owner', '/api/profiles'])
def test_owner_profile_retains_account_fields(accounts, path):
    client, engine = accounts
    with engine.begin() as conn:
        conn.execute(Profile.__table__.update().where(Profile.id == 'owner').values(
            role=RoleEnum.PHOTOGRAPHER, is_live=True))
    response = client.get(path, headers=headers('owner'))
    assert response.status_code == 200
    body = response.json()
    profile = next(p for p in body if p['id'] == 'owner') if isinstance(body, list) else body
    assert profile['email'] == 'owner@example.invalid'
    assert profile['credit_balance'] == 10
    assert profile['home_latitude'] == 28.0
