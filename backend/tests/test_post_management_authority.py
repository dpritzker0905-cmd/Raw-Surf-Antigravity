"""Real HTTP/ORM authority controls; no external services or production database."""
import importlib.util
import shutil
from datetime import timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import Post, Profile, RoleEnum


def test_assembled_post_mutations_have_one_authoritative_handler():
    import socket
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(socket.socket, 'connect', lambda *args: pytest.fail('Network forbidden during assembly'))
        import server
    from routes.posts import management
    for method, path, handler in [
        ('PATCH', '/api/posts/{post_id}/settings', management.update_post_settings),
        ('PATCH', '/api/posts/{post_id}', management.update_post),
        ('DELETE', '/api/posts/{post_id}', management.delete_post),
    ]:
        routes = [route for route in server.app.routes if getattr(route, 'path', None) == path
                  and method in getattr(route, 'methods', ())]
        assert len(routes) == 1 and routes[0].endpoint is handler


@pytest_asyncio.fixture
async def harness(tmp_path, post_db_template):
    path = Path(__file__).parents[1] / 'routes/posts/management.py'
    spec = importlib.util.spec_from_file_location('repair_post_management', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    dbfile = tmp_path / 'posts.sqlite'
    shutil.copyfile(post_db_template, dbfile)
    engine = create_async_engine(f'sqlite+aiosqlite:///{dbfile}')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([Profile(id=actor, user_id=actor, email=f'{actor}@example.invalid', role=RoleEnum.SURFER,
                            is_admin=actor == 'admin') for actor in ('owner', 'other', 'admin')])
        db.add(Post(id='post', author_id='owner', caption='original'))
        await db.commit()

    async def database():
        async with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    app.dependency_overrides[get_db] = database
    async with AsyncClient(transport=ASGITransport(app=app), base_url='https://test.invalid') as client:
        yield client, sessions
    await engine.dispose()


@pytest.fixture(scope='module')
def post_db_template(tmp_path_factory):
    path = tmp_path_factory.mktemp('post-schema') / 'schema.sqlite'
    engine = create_engine(f'sqlite:///{path}')
    Base.metadata.create_all(engine)
    engine.dispose()
    return path


def headers(actor):
    if actor is None:
        return {}
    if actor == 'invalid':
        return {'Authorization': 'Bearer invalid'}
    token = create_access_token({'sub': 'owner' if actor == 'expired' else actor},
                                expires_delta=timedelta(minutes=-1) if actor == 'expired' else None)
    return {'Authorization': 'Bearer ' + token}


async def request(client, action, actor, supplied='owner', post='post'):
    path = f'/api/posts/{post}'
    if action == 'settings':
        return await client.patch(path + '/settings', params={'user_id': supplied},
                                  json={'hide_like_count': True}, headers=headers(actor))
    if action == 'edit':
        return await client.patch(path, params={'user_id': supplied},
                                  json={'caption': 'changed'}, headers=headers(actor))
    return await client.delete(path, params={'user_id': supplied}, headers=headers(actor))


@pytest.mark.parametrize('action', ['settings', 'edit', 'delete'])
@pytest.mark.parametrize('actor,status', [(None, 401), ('invalid', 401), ('expired', 401), ('other', 403), ('owner', 200)])
async def test_mutation_uses_authenticated_owner(harness, action, actor, status):
    client, sessions = harness
    response = await request(client, action, actor)
    assert response.status_code == status, response.text
    async with sessions() as db:
        post = await db.get(Post, 'post')
        if status != 200:
            assert post.caption == 'original' and not post.hide_like_count
        elif action == 'delete':
            assert post is None
        elif action == 'edit':
            assert post.caption == 'changed'
        else:
            assert post.hide_like_count is True


@pytest.mark.parametrize('action', ['settings', 'edit', 'delete'])
async def test_legacy_query_cannot_override_valid_owner(harness, action):
    client, _ = harness
    assert (await request(client, action, 'owner', supplied='other')).status_code == 200


@pytest.mark.parametrize('action,status', [('settings', 403), ('edit', 403), ('delete', 200)])
async def test_genuine_admin_keeps_only_existing_delete_permission(harness, action, status):
    client, _ = harness
    assert (await request(client, action, 'admin')).status_code == status


async def test_supplied_admin_identity_cannot_authorize_foreign_delete(harness):
    client, sessions = harness
    assert (await request(client, 'delete', 'other', supplied='admin')).status_code == 403
    async with sessions() as db:
        assert (await db.scalars(select(Post.id))).all() == ['post']


@pytest.mark.parametrize('action', ['settings', 'edit', 'delete'])
async def test_owner_missing_resource_stays_404(harness, action):
    client, _ = harness
    assert (await request(client, action, 'owner', post='absent')).status_code == 404
