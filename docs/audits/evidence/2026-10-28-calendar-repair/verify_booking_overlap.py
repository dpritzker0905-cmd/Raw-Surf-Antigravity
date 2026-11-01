# Synthetic photographer-created booking check. The copied setup below disables provider settings and Python socket connection methods; it is not an OS firewall. This script uses manually driven ASGI, in-memory synchronous SQLite adapted to async methods, synthetic identity and no real account or provider. No browser or normal async DB is exercised. Run using the repository backend venv Python with -B.

import json
import os
import socket
import sys
from pathlib import Path

safe_env = {key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH") if key in os.environ}
os.environ.clear()
os.environ.update(safe_env)
os.environ.update({
    "PYTHON_DOTENV_DISABLED": "1",
    "PYDANTIC_DISABLE_PLUGINS": "__all__",
    "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
    "JWT_SECRET": "synthetic-fixture-only",
    "SECRET_KEY": "synthetic-fixture-only",
    "TESTING": "1",
})
sys.dont_write_bytecode = True

def blocked(*_args, **_kwargs):
    raise RuntimeError("Network connections disabled for this audit harness")

socket.socket.connect = blocked
socket.socket.connect_ex = blocked
socket.create_connection = blocked

backend = Path(__file__).resolve().parents[4] / "backend"
os.chdir(backend)
sys.path.insert(0, str(backend))
import dotenv
dotenv.load_dotenv = lambda *_args, **_kwargs: False

from fastapi import FastAPI
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from database import get_db
from core.security import get_current_user_id
from models import Profile, Booking
from models.enums import RoleEnum
from routes.photographer.bookings import router

engine = create_engine("sqlite:///:memory:")
for model in (Profile, Booking): model.__table__.create(engine)
session = Session(engine, expire_on_commit=False)
class Adapter:
    async def execute(self, *args, **kwargs): return session.execute(*args, **kwargs)
    def add(self, *args, **kwargs): return session.add(*args, **kwargs)
    async def commit(self): return session.commit()
    async def refresh(self, *args, **kwargs): return session.refresh(*args, **kwargs)
    async def rollback(self): return session.rollback()
adapter=Adapter()
app=FastAPI()
app.include_router(router)
async def fixture_db(): yield adapter
async def fixture_identity(): return 'synthetic-photographer'
app.dependency_overrides[get_db]=fixture_db
app.dependency_overrides[get_current_user_id]=fixture_identity

def request(method, path, payload=None, query=b''):
    sent=[]
    content=json.dumps(payload).encode() if payload is not None else b''
    scope={'type':'http','asgi':{'version':'3.0','spec_version':'2.3'},'http_version':'1.1','method':method,'scheme':'http','path':path,'raw_path':path.encode(),'query_string':query,'root_path':'','headers':[(b'content-type',b'application/json')],'client':('127.0.0.1',12345),'server':('fixture.invalid',80)}
    async def receive(): return {'type':'http.request','body':content,'more_body':False}
    async def send(message): sent.append(message)
    coroutine=app(scope,receive,send)
    try:
        yielded=coroutine.send(None)
        raise RuntimeError(f'Unexpected ASGI yield: {yielded!r}')
    except StopIteration: pass
    status=next(m['status'] for m in sent if m['type']=='http.response.start')
    raw=b''.join(m.get('body',b'') for m in sent if m['type']=='http.response.body')
    return status,json.loads(raw)

from datetime import datetime
from routes.bookings.crud import check_time_slot_conflict

def drive(co):
    try:
        value=co.send(None)
    except StopIteration as result:
        return result.value
    co.close()
    raise AssertionError(f'Unexpected I/O: {value!r}')

def check_case(name, status='Confirmed', kind='scheduled', owner='synthetic-photographer', start='2026-11-02T10:00:00', expected=409):
    session.query(Booking).delete()
    session.add(Booking(id='existing',photographer_id=owner,creator_id=owner,location='Synthetic',session_date=datetime(2026,11,2,9),duration=120,max_participants=5,total_price=375,status=status,booking_type=kind))
    session.commit()
    before=session.query(Booking).count()
    payload={'location':'Synthetic beach','session_date':start,'duration':60,'max_participants':5,'price_per_person':75,'allow_splitting':False}
    code,result=request('POST','/photographer/synthetic-photographer/bookings',payload)
    assert code==expected,(name,code,result)
    assert session.query(Booking).count()==before+(expected==200),name
    print('PASS',name)

# Preserve timezone-bearing values at the helper seam: SQLite itself strips
# offsets, so these cases complement the real in-memory route checks above.
from types import SimpleNamespace
class QueryRows:
    def __init__(self, rows): self.rows = rows
    def scalars(self): return self
    def all(self): return self.rows
class QueryDatabase:
    def __init__(self, existing): self.existing = existing
    async def execute(self, query): return QueryRows([self.existing])
def check_timezone_case(name, existing_start, requested_start, conflict_expected):
    existing = SimpleNamespace(id='timezone-existing', session_date=datetime.fromisoformat(existing_start), duration=60, location='Synthetic')
    result = drive(check_time_slot_conflict(QueryDatabase(existing), 'synthetic-photographer', datetime.fromisoformat(requested_start), 60))
    assert bool(result) == conflict_expected, (name, result, conflict_expected)
    if conflict_expected:
        assert result['existing_booking_id'] == existing.id
    print('PASS', name)

try:
    for identifier in ('synthetic-photographer','other-photographer'):
        session.add(Profile(id=identifier,user_id=identifier,email=identifier+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Synthetic'))
    session.commit()
    failures=[]
    cases=[('overlap',{}),('same instant offset',{'start':'2026-11-02T05:00:00-05:00'}),('adjacent after',{'start':'2026-11-02T11:00:00','expected':200}),('adjacent before',{'start':'2026-11-02T08:00:00','expected':200}),('other photographer',{'owner':'other-photographer','expected':200}),('cancelled',{'status':'Cancelled','expected':200}),('pending payment',{'status':'Pending Payment','expected':200}),('on demand',{'kind':'on_demand','expected':200})]
    for name,options in cases:
        try: check_case(name,**options)
        except Exception as error:
            session.rollback();failures.append(name);print('FAIL',name,type(error).__name__,str(error))
    timezone_cases = [
        ('aware existing / naive new', '2026-11-02T04:00:00-05:00', '2026-11-02T09:30:00', True),
        ('naive existing / aware new', '2026-11-02T09:00:00', '2026-11-02T04:30:00-05:00', True),
        ('two aware offsets same instant', '2026-11-02T04:00:00-05:00', '2026-11-02T11:00:00+02:00', True),
        ('nonconflicting offset', '2026-11-02T04:00:00-05:00', '2026-11-02T12:00:00+02:00', False),
    ]
    for name, existing, requested, expected in timezone_cases:
        try: check_timezone_case(name, existing, requested, expected)
        except Exception as error:
            failures.append(name); print('FAIL', name, type(error).__name__, str(error))
    total = len(cases) + len(timezone_cases)
    print(f'{total-len(failures)}/{total} cases passed')
    raise SystemExit(bool(failures))
finally:
    session.close()
    engine.dispose()
