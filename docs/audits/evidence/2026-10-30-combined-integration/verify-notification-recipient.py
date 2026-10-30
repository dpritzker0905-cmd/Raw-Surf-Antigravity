"""Actual notification handlers, ORM and JWT dependency; disposable two-account storage only.

Does not import server/database/application models packages, load .env or start weather.
Credentials and signed tokens exist only in this child process and are never recorded.
"""
import argparse
import ast
import asyncio
import hashlib
import importlib.util
import json
import logging
import os
from pathlib import Path
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import sqlalchemy as sa
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base, relationship

parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[4])
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
ROOT = args.source_root.resolve()
os.environ['SECRET_KEY'] = secrets.token_hex(32)
os.environ['ENV'] = 'production'  # refuse all legacy development identity shortcuts
os.environ.pop('TESTING', None)
logging.disable(logging.CRITICAL)

security_path = ROOT / 'backend/core/security.py'
spec = importlib.util.spec_from_file_location('fixture_actual_security', security_path)
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)
Base = declarative_base()


class Profile(Base):
    __tablename__ = 'profiles'
    id = sa.Column(sa.String(36), primary_key=True)


model_scope = {name: getattr(sa, name) for name in ['Column', 'String', 'Integer', 'Boolean', 'ForeignKey', 'DateTime', 'Text']}
model_scope.update(Base=Base, Profile=Profile, relationship=relationship, datetime=datetime, timezone=timezone,
                   generate_uuid=lambda: str(uuid.uuid4()), __name__='notification_recipient_fixture')
tree = ast.parse((ROOT / 'backend/models/social.py').read_text(encoding='utf-8'))
nodes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Notification']
assert len(nodes) == 1
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'actual_notification_model', 'exec'), model_scope)
Notification = model_scope['Notification']
engine = create_async_engine('sqlite+aiosqlite:///:memory:')
factory = async_sessionmaker(engine, expire_on_commit=False)
selects = []


@sa.event.listens_for(engine.sync_engine, 'before_cursor_execute')
def observe_query(_connection, _cursor, statement, _parameters, _context, _many):
    if statement.lstrip().upper().startswith('SELECT'):
        selects.append(statement)


async def get_db():
    async with factory() as db:
        yield db


source = ROOT / 'backend/routes/notifications/notifications.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
selected = {'NotificationResponse', 'get_notifications', 'get_unread_notification_count',
            'mark_notification_read', 'mark_all_notifications_read'}
nodes = [node for node in tree.body if (
    isinstance(node, (ast.Import, ast.ImportFrom)) and not (
        isinstance(node, ast.ImportFrom) and node.module in ['database', 'core.security', 'models'])) or (
    isinstance(node, (ast.ClassDef, ast.AsyncFunctionDef)) and node.name in selected) or (
    isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'router' for target in node.targets))]
scope = dict(Notification=Notification, Profile=Profile, get_db=get_db,
             get_current_user_id=security.get_current_user_id, __name__='actual_notification_handlers')
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)
app = FastAPI()
app.include_router(scope['router'], prefix='/api')
canonical_paging = 'before_created_at' in scope['get_notifications'].__code__.co_varnames
A, B, MISSING = [str(uuid.UUID(int=n)) for n in [111, 222, 333]]
NOW = datetime(2026, 10, 30, 0, tzinfo=timezone.utc)
cases = []


def check(name, passed, **details):
    cases.append(dict(name=name, passed=bool(passed), **details))


def auth(subject, **claims):
    return {'Authorization': 'Bearer ' + security.create_access_token({'sub': subject, **claims})}


async def main():
    rows = []
    try:
        async with engine.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        async with factory() as db:
            db.add_all([Profile(id=A), Profile(id=B)])
            await db.commit()
            for owner, total in [(A, 61), (B, 3)]:
                for number in range(total):
                    row = Notification(id=str(uuid.UUID(int=1000 + number + (100 if owner == B else 0))), user_id=owner,
                                       type='support_reply', title='Synthetic owner notice', body='Synthetic generic notice',
                                       data=json.dumps({'ticket_id': str(uuid.UUID(int=444)), 'message_id': str(uuid.UUID(int=555)),
                                                        'recipient_id': owner}), is_read=number % 2 == 0,
                                       created_at=NOW + timedelta(minutes=number // 4))
                    db.add(row)
                    if owner == A:
                        rows.append((row.id, row.created_at))
            await db.commit()
        endpoints = [f'/api/notifications/{A}', f'/api/notifications/{A}/unread-count']
        actual_auth = auth(A)
        expired = security.create_access_token({'sub': A}, expires_delta=timedelta(days=-1))
        wrong_key = security.jwt.encode({'sub': A, 'exp': NOW + timedelta(days=400)}, secrets.token_hex(32), algorithm='HS256')
        invalid = [('anonymous', {}), ('non-bearer', {'Authorization': 'Basic fixture'}),
                   ('malformed', {'Authorization': 'Bearer malformed'}), ('wrong-signature', {'Authorization': 'Bearer ' + wrong_key}),
                   ('expired', {'Authorization': 'Bearer ' + expired}), ('missing-subject', auth(None)),
                   ('limited-scope', auth(A, scp='mfa_enrol'))]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://fixture.invalid') as client:
            for path in endpoints:
                kind = 'count' if path.endswith('unread-count') else 'list'
                for name, headers in invalid:
                    before = len(selects)
                    response = await client.get(path, headers=headers)
                    check(f'{kind}: {name} rejected before SELECT', response.status_code == 401 and len(selects) == before,
                          status=response.status_code, selects=len(selects) - before)
                for name, headers in [('other-account', auth(B)), ('other-account-admin-claim', auth(B, role='admin'))]:
                    before = len(selects)
                    response = await client.get(path, headers=headers)
                    check(f'{kind}: {name} rejected before SELECT', response.status_code == 403 and len(selects) == before,
                          status=response.status_code, selects=len(selects) - before)
                before = len(selects)
                missing_path = path.replace(A, MISSING)
                missing = await client.get(missing_path, headers=actual_auth)
                check(f'{kind}: foreign missing recipient equally rejected', missing.status_code == 403 and len(selects) == before,
                      status=missing.status_code, selects=len(selects) - before)
            response = await client.get(endpoints[0], headers=actual_auth)
            expected = [pair[0] for pair in sorted(rows, key=lambda pair: (pair[1], pair[0]), reverse=True)]
            check('owner list retains default 50 and generic payload', response.status_code == 200 and len(response.json()) == 50 and
                  all(json.loads(row['data'])['recipient_id'] == A for row in response.json()))
            response = await client.get(endpoints[1], headers=actual_auth)
            check('owner unread count is exact own total', response.status_code == 200 and response.json() == {'unread_count': 30})
            response = await client.get(f'/api/notifications/{B}', headers=auth(B))
            check('second owner retains own list', response.status_code == 200 and len(response.json()) == 3 and
                  all(json.loads(row['data'])['recipient_id'] == B for row in response.json()))
            response = await client.get(f'/api/notifications/{B}/unread-count', headers=auth(B))
            check('second owner retains own unread count', response.status_code == 200 and response.json() == {'unread_count': 1})
            response = await client.get(endpoints[0], params={'user_id': B}, headers=actual_auth)
            check('query identity cannot switch recipient', response.status_code == 200 and
                  all(json.loads(row['data'])['recipient_id'] == A for row in response.json()))
            if canonical_paging:
                first = await client.get(endpoints[0], params={'limit': 17}, headers=actual_auth)
                cursor = first.json()[-1]
                second = await client.get(endpoints[0], params={'limit': 17, 'before_created_at': cursor['created_at'],
                                                             'before_id': cursor['id']}, headers=actual_auth)
                check('canonical stable tie order and keyset page preserved', [r['id'] for r in first.json() + second.json()] == expected[:34])
                for limit in [0, 101]:
                    response = await client.get(endpoints[0], params={'limit': limit}, headers=actual_auth)
                    check(f'canonical invalid limit {limit} remains 422', response.status_code == 422)
                for params in [{'before_created_at': NOW.isoformat()}, {'before_id': expected[0]}]:
                    response = await client.get(endpoints[0], params=params, headers=actual_auth)
                    check('canonical partial cursor remains 400 ' + next(iter(params)), response.status_code == 400)
            read_id = str(uuid.UUID(int=1001))
            before = len(selects)
            response = await client.post(f'/api/notifications/{read_id}/read', headers=auth(B))
            check('existing foreign mark-read still 404', response.status_code == 404)
            response = await client.post(f'/api/notifications/{read_id}/read', headers=actual_auth)
            count = await client.get(endpoints[1], headers=actual_auth)
            check('own mark-read and authoritative count still work', response.status_code == 200 and count.json() == {'unread_count': 29})
            response = await client.post(f'/api/notifications/{A}/read-all', headers=auth(B))
            check('existing cross-account mark-all remains 403', response.status_code == 403)
            response = await client.post(f'/api/notifications/{A}/read-all', headers=actual_auth)
            a_count = await client.get(endpoints[1], headers=actual_auth)
            b_count = await client.get(f'/api/notifications/{B}/unread-count', headers=auth(B))
            check('own mark-all never changes other owner count', response.status_code == 200 and a_count.json() == {'unread_count': 0} and
                  b_count.json() == {'unread_count': 1})
        result = dict(passed=sum(row['passed'] for row in cases), total=len(cases), cases=cases, canonical_pagination=canonical_paging,
                      fixture='mounted actual handlers + actual JWT dependency + actual Notification ORM; no app/weather/env startup',
                      credentials='random process-only signing keys and tokens; no retained values', source={
                          str(p.relative_to(ROOT)): {'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                          for p in [source, security_path, ROOT / 'backend/models/social.py']})
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'passed': result['passed'], 'total': result['total'], 'failed': [r['name'] for r in cases if not r['passed']]}))
        return 0 if result['passed'] == result['total'] else 1
    finally:
        await engine.dispose()


sys.exit(asyncio.run(main()))
