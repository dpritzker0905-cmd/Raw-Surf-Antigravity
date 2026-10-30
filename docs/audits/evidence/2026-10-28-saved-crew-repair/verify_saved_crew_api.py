"""Actual Saved Crew normal create/list/default read contract, SQLite/manual ASGI.
Synthetic identity dependency; no sign-in, provider, real HTTP or external network.
Python socket guards are not an OS firewall. No weather/server startup.
"""
import json,os,socket,sys,types
from pathlib import Path
keep={k:os.environ[k]for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH')if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*a,**k):raise RuntimeError('External connection disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.crew',backend/'routes/crew')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from fastapi import FastAPI
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from database import get_db
from core.security import get_user_id_from_jwt_or_query
from models import Profile,SavedCrew,RoleEnum
from routes.crew.saved_crews import router
engine=create_engine('sqlite:///:memory:')
for model in (Profile,SavedCrew):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
db=Adapter();app=FastAPI();app.include_router(router)
async def fixture_db():yield db
async def identity():return 'synthetic-surfer'
app.dependency_overrides[get_db]=fixture_db
app.dependency_overrides[get_user_id_from_jwt_or_query]=identity
async def request_parts(method,path,payload,query,sent):
 body=json.dumps(payload).encode()if payload is not None else b''
 async def receive():return {'type':'http.request','body':body,'more_body':False}
 async def send(message):sent.append(message)
 await app({'type':'http','asgi':{'version':'3.0','spec_version':'2.3'},'http_version':'1.1','method':method,'scheme':'http','path':path,'raw_path':path.encode(),'query_string':query,'root_path':'','headers':[(b'content-type',b'application/json')],'client':('127.0.0.1',1),'server':('fixture.invalid',80)},receive,send)
def request(method,path,payload=None,query=b''):
 sent=[];co=request_parts(method,path,payload,query,sent)
 try:v=co.send(None)
 except StopIteration:pass
 else:co.close();raise AssertionError(f'Unexpected async I/O {v}')
 return next(m['status']for m in sent if m['type']=='http.response.start'),json.loads(b''.join(m.get('body',b'')for m in sent if m['type']=='http.response.body'))
try:
 session.add(Profile(id='synthetic-surfer',user_id='synthetic-surfer',email='synthetic@example.invalid',role=RoleEnum.SURFER));session.commit()
 status,created=request('POST','/crews/saved',{'name':'Morning crew','members':[{'name':'Synthetic friend','email':'friend@example.invalid'}],'is_default':True})
 assert status==200 and created['crew']['member_count']==1
 print('PASS create preset through actual handler')
 status,listing=request('GET','/crews/saved',query=b'user_id=synthetic-surfer')
 assert status==200 and listing['total']==1 and listing['crews'][0]['name']=='Morning crew'
 print('PASS list with selector query contract')
 status,default=request('GET','/crews/saved/default',query=b'user_id=synthetic-surfer')
 assert status==200 and default['default_crew']['id']==created['crew']['id']
 print('PASS default preset read')
 with Session(engine)as persisted:
  preset=persisted.execute(select(SavedCrew)).scalar_one()
  assert preset.name=='Morning crew' and preset.owner_id=='synthetic-surfer' and len(preset.members)==1
 print('PASS independent persisted-session readback')
 print('4/4 Saved Crew API cases passed')
finally:session.close();engine.dispose()
