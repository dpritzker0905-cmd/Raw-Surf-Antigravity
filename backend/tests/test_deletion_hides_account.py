"""A pending account deletion hides the account from everyone, and a restore brings it all back (phase 2 of #1062).

During the 30-day restore window the person's profile, posts, stories and galleries were still served to other users
(only sign-in was blocked). Now a withdrawn account (account_deletions.status = 'pending') is treated as already
gone on every viewer-facing read: views answer the surface's own 404, lists drop it, for signed-in and anonymous
viewers alike. Real JWTs through the real routers over an ephemeral SQLite file; nothing leaves the process.

Cast: dana asked to delete her account; carol is the control.
"""
import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from core.security import create_access_token
from database import Base, get_db
from models import AccountDeletion, Follow, Post, Profile, RoleEnum
from routes.explore_discover import router as explore_router
from routes.posts import router as posts_router
from routes.profiles import router as profiles_router
from routes.social import router as social_router
from services import blocks

PEOPLE = ('dana', 'carol', 'viewer')
NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)


def auth(user):
    return {'Authorization': f'Bearer {create_access_token({"sub": user})}'}


@contextmanager
def _world(tmp_path):
    path = tmp_path / 'withdrawn.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    with sessionmaker(sync_engine)() as db:
        for pid in PEOPLE:
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=f'{pid}surf',
                           role=RoleEnum.SURFER, full_name=f'{pid.title()} Wave', credit_balance=0.0,
                           withdrawable_credits=0.0, gear_only_credits=0.0))
        db.flush()
        for pid in ('dana', 'carol'):
            db.add(Post(id=f'post-{pid}', author_id=pid, media_url=f'https://example.invalid/{pid}.jpg',
                        spot_id='spot-1', caption=f'{pid} post #glassy'))
        for follower, followed in (('viewer', 'dana'), ('viewer', 'carol'), ('dana', 'carol')):
            db.add(Follow(id=f'f-{follower}-{followed}', follower_id=follower, following_id=followed))
        db.add(AccountDeletion(profile_id='dana', status='pending', requested_at=NOW, purge_after=NOW + timedelta(days=30)))
        db.commit()
    sync_engine.dispose()

    engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            yield session

    app = FastAPI()
    for router in (posts_router, profiles_router, explore_router, social_router):
        app.include_router(router, prefix='/api')
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        try:
            yield client, maker
        finally:
            client.portal.call(engine.dispose)


@pytest.fixture
def world(tmp_path):
    with _world(tmp_path) as w:
        yield w


def _restore(client, maker):
    async def go():
        async with maker() as db:
            row = await db.get(AccountDeletion, 'dana')
            row.status = 'restored'
            await db.commit()
    client.portal.call(go)


def _ids(payload, key='id'):
    if isinstance(payload, list):
        items = payload
    else:
        items = []
        for k in ('posts', 'users', 'profiles', 'results', 'user_posts', 'photographer_posts'):
            items += payload.get(k) or []
    return {i.get(key) for i in items if isinstance(i, dict)}


@pytest.mark.parametrize('headers', [None, 'viewer'], ids=['anonymous', 'signed-in'])
def test_a_withdrawn_profile_and_post_answer_404_and_the_control_does_not(world, headers):
    client, maker = world
    h = auth(headers) if headers else {}
    assert client.get('/api/profiles/dana', headers=h).status_code == 404
    assert client.get('/api/profiles/by-username/danasurf', headers=h).status_code == 404
    assert client.get('/api/posts/post-dana', headers=h).status_code == 404
    assert client.get('/api/profiles/carol', headers=h).status_code == 200
    assert client.get('/api/posts/post-carol', headers=h).status_code == 200


def test_feeds_and_searches_drop_the_withdrawn_account(world):
    client, _maker = world
    feed = client.get('/api/posts', headers=auth('viewer')).json()
    assert 'post-carol' in _ids(feed) and 'post-dana' not in _ids(feed)
    spot = client.get('/api/posts/spot/spot-1').json()
    assert 'post-carol' in _ids(spot) and 'post-dana' not in _ids(spot)
    people = client.get('/api/profiles/search', params={'q': 'Wave'}, headers=auth('viewer')).json()
    assert 'carol' in _ids(people) and 'dana' not in _ids(people)
    handles = client.get('/api/username/search', params={'q': 'surf'}).json()
    names = {u.get('username') for u in (handles if isinstance(handles, list) else handles.get('users', []))}
    assert 'carolsurf' in names and 'danasurf' not in names
    assert client.get('/api/username/lookup/danasurf').status_code == 404
    found = client.get('/api/search/global', params={'q': 'Wave'}).json()
    assert 'dana' not in {u.get('id') for u in found.get('users', [])}


def test_follower_and_following_lists_drop_the_withdrawn_account(world):
    client, maker = world
    followers = {u['id'] for u in client.get('/api/followers/carol').json()}
    assert followers == {'viewer'}                                       # dana followed carol, but is withdrawn
    following = {u['id'] for u in client.get('/api/following/viewer').json()}
    assert following == {'carol'}                                       # viewer followed dana too
    _restore(client, maker)
    assert {u['id'] for u in client.get('/api/following/viewer').json()} == {'carol', 'dana'}


def test_a_restore_brings_everything_back(world):
    client, maker = world
    _restore(client, maker)
    assert client.get('/api/profiles/dana').status_code == 200
    assert client.get('/api/posts/post-dana').status_code == 200
    assert 'post-dana' in _ids(client.get('/api/posts/spot/spot-1').json())


def test_the_helpers_hide_withdrawn_owners_from_anonymous_viewers_too(world):
    client, maker = world

    async def go():
        async with maker() as db:
            assert 'dana' in await blocks.excluded_user_ids(db, None)          # anonymous lists drop her
            assert 'dana' in await blocks.excluded_user_ids(db, 'viewer')
            with pytest.raises(HTTPException) as e:
                await blocks.assert_owner_listed(db, 'dana', 'Gallery not found')
            assert e.value.status_code == 404 and e.value.detail == 'Gallery not found'
            await blocks.assert_owner_listed(db, 'carol')                     # the control passes
            listed = (await db.execute(select(Profile.id).where(blocks.listed_clause(Profile.id)))).scalars().all()
            assert set(listed) == {'carol', 'viewer'}
            posts = (await db.execute(select(Post.id).where(blocks.listed_clause(Post.author_id)))).scalars().all()
            assert posts == ['post-carol']
    client.portal.call(go)


def test_a_withdrawn_authors_story_is_not_viewable():
    from routes.content.stories import can_view_story

    class FakeDb:
        async def get(self, model, pk):
            return AccountDeletion(profile_id=pk, status='pending') if pk == 'dana' else None

    class Author:
        def __init__(self, pid):
            self.id, self.role, self.is_private = pid, RoleEnum.SURFER, False

    class Story:
        def __init__(self, pid):
            self.author, self.visibility, self.guardian_approval_status = Author(pid), 'public', 'approved'

    assert asyncio.run(can_view_story(FakeDb(), Story('dana'), 'viewer')) is False
    assert asyncio.run(can_view_story(FakeDb(), Story('carol'), 'viewer')) is True
