"""APP-05 HTTP/ORM probes: verified actor and independent participant state."""
import asyncio
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from core.security import create_access_token
from database import get_db
from models import Conversation, Follow, Message, Profile, RoleEnum

@pytest.fixture
def messaging(tmp_path, monkeypatch):
    path = Path(__file__).parents[1] / 'routes/messages'
    package = ModuleType('audit_message_routes')
    package.__path__ = [str(path)]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    modules = []
    for name in ('schemas', 'message_threads', 'conversations', 'features'):
        spec = importlib.util.spec_from_file_location(f'{package.__name__}.{name}', path / f'{name}.py')
        module = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, spec.name, module)
        spec.loader.exec_module(module)
        modules.append(module)
    dbfile = tmp_path / 'messages.sqlite'
    engine = create_engine(f'sqlite:///{dbfile}')
    for model in (Profile, Conversation, Message, Follow):
        model.__table__.create(engine)
    with engine.begin() as conn:
        conn.execute(Profile.__table__.insert(), [dict(
            id=actor, user_id=actor, email=f'{actor}@example.invalid', full_name=actor,
            role=RoleEnum.GROM_PARENT if actor == 'owner' else (RoleEnum.GROM if actor == 'peer' else RoleEnum.SURFER),
            parent_id='owner' if actor == 'peer' else None, parent_link_approved=actor == 'peer',
            is_admin=actor == 'admin',
        ) for actor in ('owner', 'peer', 'other', 'admin')])
        conn.execute(Conversation.__table__.insert(), dict(
            id='thread', participant_one_id='owner', participant_two_id='peer',
            status_for_one='request', status_for_two='request'))
        conn.execute(Message.__table__.insert(), dict(id='private-message', conversation_id='thread',
                                                     sender_id='peer', content='Private family preview'))
    async_engine = create_async_engine(f'sqlite+aiosqlite:///{dbfile}')
    sessions = async_sessionmaker(async_engine, expire_on_commit=False)
    async def database():
        async with sessions() as session:
            yield session
    app = FastAPI()
    for module in modules[1:]:
        app.include_router(module.router, prefix='/api')
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        yield client, engine, app
    asyncio.run(async_engine.dispose())
    engine.dispose()

def headers(actor):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': actor})} if actor else {}

def state(engine):
    with engine.connect() as conn:
        return dict(conn.execute(select(Conversation.__table__)).mappings().one())

ACTIONS = [
    ('post', '/messages/accept/thread', 'status', 'primary'),
    ('delete', '/messages/conversation/thread', 'status', 'hidden'),
    ('post', '/messages/conversation/thread/pin', 'is_pinned', True),
    ('post', '/messages/conversation/thread/mute', 'is_muted', True),
    ('post', '/messages/conversation/thread/mark-unread', 'is_unread', True),
    ('post', '/messages/decline/thread', 'status', 'hidden'),
]
@pytest.mark.parametrize('method,path,field,value', ACTIONS)
@pytest.mark.parametrize('actor,claimed,status', [
    (None, 'owner', 401), ('other', 'owner', 403), ('other', 'other', 403),
    ('owner', 'owner', 200), ('peer', 'peer', 200),
])
def test_conversation_actions_bind_actor_and_isolate_peer(messaging, method, path, field, value, actor, claimed, status):
    client, engine, _ = messaging
    before = state(engine)
    response = client.request(method, '/api' + path, params={'user_id': claimed}, headers=headers(actor))
    assert response.status_code == status
    after = state(engine)
    if status != 200:
        assert after == before
    else:
        key = f'{field}_for_' + ('one' if actor == 'owner' else 'two')
        assert after[key] == value
        assert {k: v for k, v in after.items() if k != key} == {k: v for k, v in before.items() if k != key}

@pytest.mark.parametrize('path', [
    '/messages/grom-zone/family-members/owner', '/messages/conversations/owner/family',
    '/messages/check-thread/owner/peer', '/messages/unread-counts/owner', '/messages/conversation-count/owner',
])
@pytest.mark.parametrize('actor,status', [(None, 401), ('other', 403), ('owner', 200)])
def test_private_sibling_reads_require_own_identity(messaging, path, actor, status):
    client, engine, _ = messaging
    before = state(engine)
    response = client.get('/api' + path, headers=headers(actor))
    assert response.status_code == status
    if actor == 'owner' and path.endswith('/family'):
        assert response.json()[0]['last_message'] == 'Private family preview'
    assert state(engine) == before

@pytest.mark.parametrize('actor,status', [(None, 401), ('other', 403), ('owner', 200)])
def test_start_conversation_binds_sender(messaging, actor, status):
    client, engine, _ = messaging
    before = state(engine)
    response = client.post('/api/messages/start-conversation', params={'sender_id': 'owner', 'recipient_id': 'peer'},
                           headers=headers(actor))
    assert response.status_code == status
    if status != 200:
        assert state(engine) == before
    else:
        assert response.json()['conversation_id'] == 'thread'

@pytest.mark.parametrize('actor,status', [(None, 401), ('owner', 403), ('admin', 200)])
def test_cleanup_is_admin_only_before_maintenance_sql(messaging, actor, status):
    client, _, app = messaging
    result = SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(is_admin=actor == 'admin'), fetchall=lambda: [])
    db = SimpleNamespace(execute=AsyncMock(return_value=result), commit=AsyncMock())
    async def database():
        yield db
    app.dependency_overrides[get_db] = database
    response = client.post('/api/messages/cleanup-duplicates', headers=headers(actor))
    assert response.status_code == status
    if actor is None:
        db.execute.assert_not_awaited()
    elif actor != 'admin':
        assert db.execute.await_count == 1
        assert 'profiles' in str(db.execute.call_args.args[0])
    else:
        assert db.execute.await_count == 2
        assert 'HAVING COUNT' in str(db.execute.call_args.args[0])
    assert db.commit.await_count == (1 if actor == 'admin' else 0)

@pytest.mark.parametrize('actor,status', [(None, 401), ('other', 403), ('peer', 200)])
def test_grom_directory_binds_verified_child(messaging, actor, status):
    client, engine, _ = messaging
    before = state(engine)
    response = client.get('/api/messages/grom-zone/available-groms/peer', headers=headers(actor))
    assert response.status_code == status
    assert state(engine) == before

@pytest.mark.parametrize('method,path,field,value', ACTIONS)
@pytest.mark.parametrize('actor,status', [(None, 401), ('owner', 200), ('peer', 200)])
def test_actions_can_use_verified_subject_without_legacy_query(messaging, method, path, field, value, actor, status):
    client, engine, _ = messaging
    before = state(engine)
    response = client.request(method, '/api' + path, headers=headers(actor))
    assert response.status_code == status
    after = state(engine)
    if actor:
        key = f'{field}_for_' + ('one' if actor == 'owner' else 'two')
        assert after[key] == value
        assert {k: v for k, v in after.items() if k != key} == {k: v for k, v in before.items() if k != key}
    else:
        assert after == before
