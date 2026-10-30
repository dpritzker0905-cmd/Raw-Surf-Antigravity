"""Notification history uses a stable keyset, including equal-time rows and new arrivals."""
import json
from urllib.parse import urlencode
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from database import get_db
from core.security import get_current_user_id
from models import Notification


@pytest.fixture
def inbox(tmp_path):
    spec = importlib.util.spec_from_file_location('notification_history_routes', Path(__file__).parents[1] / 'routes/notifications/notifications.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = tmp_path / 'inbox.sqlite'
    engine = create_engine(f'sqlite:///{path}')
    Notification.__table__.create(engine)
    stamp = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
    with engine.begin() as conn:
        conn.execute(Notification.__table__.insert(), [dict(id=f'n{i:03}', user_id='owner', type='mention',
            title=f'Notice {i}', is_read=i > 0, created_at=stamp) for i in range(101)])
    class Database:
        def __init__(self, session): self.session = session
        async def execute(self, query): return self.session.execute(query)
        async def commit(self): self.session.commit()
    async def database():
        with Session(engine) as session:
            yield Database(session)
    async def identity(): return 'owner'
    app = FastAPI()
    app.include_router(module.router)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user_id] = identity

    class Response:
        def __init__(self, status, body): self.status_code, self.body = status, body
        def json(self): return json.loads(self.body)
    class Client:
        def request(self, method, url, params=None):
            messages = []
            async def receive(): return {'type': 'http.request', 'body': b'', 'more_body': False}
            async def send(message): messages.append(message)
            scope = {'type': 'http', 'http_version': '1.1', 'method': method, 'scheme': 'http',
                     'path': url, 'raw_path': url.encode(), 'query_string': urlencode(params or {}).encode(),
                     'root_path': '', 'headers': [], 'server': ('fixture', 80), 'client': ('fixture', 1)}
            # Real SQL through the real ASGI route, with immediate async adapters.
            # No socket, server startup or Windows event loop is needed.
            request = app(scope, receive, send)
            try:
                request.send(None)
            except StopIteration:
                pass
            else:
                request.close()
                raise AssertionError('Fixture unexpectedly attempted asynchronous I/O')
            status = next(m['status'] for m in messages if m['type'] == 'http.response.start')
            body = b''.join(m.get('body', b'') for m in messages if m['type'] == 'http.response.body')
            return Response(status, body)
        def get(self, url, params=None): return self.request('GET', url, params)
        def post(self, url): return self.request('POST', url)
    yield Client(), engine
    engine.dispose()


def test_tied_history_reaches_older_unread_without_duplication_after_arrival(inbox):
    client, engine = inbox
    first = client.get('/notifications/owner').json()
    assert len(first) == 50
    assert first[0]['id'] == 'n100'
    assert client.get('/notifications/owner/unread-count').json() == {'unread_count': 1}
    with engine.begin() as conn:
        conn.execute(Notification.__table__.insert(), dict(id='new-arrival', user_id='owner', type='mention',
            title='New', is_read=False, created_at=datetime(2026, 10, 29, tzinfo=timezone.utc)))
        conn.execute(Notification.__table__.insert(), dict(id='n075-new', user_id='owner', type='mention',
            title='Tied arrival', is_read=False, created_at=datetime(2026, 10, 28, 12, tzinfo=timezone.utc)))
    all_rows = list(first)
    while len(first) == 50:
        last = first[-1]
        response = client.get('/notifications/owner', params={'before_created_at': last['created_at'], 'before_id': last['id']})
        assert response.status_code == 200
        first = response.json()
        all_rows.extend(first)
    assert len(all_rows) == 101
    assert len({row['id'] for row in all_rows}) == 101
    assert all_rows[-1]['id'] == 'n000'
    assert all_rows[-1]['is_read'] is False
    assert client.get('/notifications/owner/unread-count').json() == {'unread_count': 3}


@pytest.mark.parametrize('params', [{'before_id': 'n050'}, {'before_created_at': '2026-10-28T12:00:00Z'}, {'limit': 0}, {'limit': 101}])
def test_partial_cursor_and_unbounded_pages_are_rejected(inbox, params):
    client, _ = inbox
    assert client.get('/notifications/owner', params=params).status_code in (400, 422)


def test_mark_all_updates_unread_outside_first_page(inbox):
    client, _ = inbox
    assert client.post('/notifications/owner/read-all').status_code == 200
    assert client.get('/notifications/owner/unread-count').json() == {'unread_count': 0}
