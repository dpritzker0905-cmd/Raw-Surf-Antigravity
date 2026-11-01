"""Normal Quiver handlers and persisted SQLite rows with a synthetic owner.
No authentication, HTTP, browser, provider, concurrency or PostgreSQL acceptance.
Manually driven coroutines use a synchronous DB adapter. Socket guards are in-process.
"""
import os,sys,socket,types
from pathlib import Path
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True

def blocked(*a,**k):raise RuntimeError('External connection disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.surf_data',backend/'routes/surf_data')]:
    m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from models import Profile,Surfboard,RoleEnum
from routes.surf_data import surfboards
engine=create_engine('sqlite:///:memory:')
for model in (Profile,Surfboard):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
    async def execute(self,*a,**k):return session.execute(*a,**k)
    def add(self,*a,**k):return session.add(*a,**k)
    async def commit(self):return session.commit()
    async def refresh(self,*a,**k):return session.refresh(*a,**k)
    async def rollback(self):return session.rollback()
db=Adapter()
def drive(co):
    try:v=co.send(None)
    except StopIteration as done:return done.value
    else:co.close();raise AssertionError(f'Unexpected asynchronous I/O {v}')
DIMS={'length_feet':6,'length_inches':2,'width_inches':19.5,'thickness_inches':2.4,'volume_liters':29.5}
def check(label,patch,changes):
    created=drive(surfboards.create_surfboard(surfboards.SurfboardCreate(name='Synthetic board',photo_urls=['fixture-photo'],primary_photo_index=0,**DIMS),'synthetic-owner',db))
    expected={**DIMS,'name':'Synthetic board','photo_urls':['fixture-photo'],'primary_photo_index':0,**changes}
    response=drive(surfboards.update_surfboard(created['id'],surfboards.SurfboardUpdate(**patch),'synthetic-owner',db))
    with Session(engine) as read:
        row=read.get(Surfboard,created['id'])
        for field,value in expected.items():
            assert response[field]==value,(label,'response',field,response[field],value)
            assert getattr(row,field)==value,(label,'persisted',field,getattr(row,field),value)
    # A fresh actual read handler must also serialize the cleared value.
    with Session(engine) as read:
        class ReadAdapter:
            async def execute(self,*a,**k):return read.execute(*a,**k)
        reread=drive(surfboards.get_surfboard(created['id'],ReadAdapter()))
        for field,value in expected.items():assert reread[field]==value,(label,'readback',field)
    print('PASS',label)
cases=[(f'clear {field}',{field:None},{field:None}) for field in DIMS]
cases += [
('combined dimension clear',{'length_inches':None,'width_inches':None},{'length_inches':None,'width_inches':None}),
('omitted dimensions unchanged',{'name':'Renamed board'},{'name':'Renamed board'}),
('zero dimensions persist',{field:0 for field in DIMS},{field:0 for field in DIMS}),
('positive dimensions update',{'length_feet':7,'width_inches':21.0},{'length_feet':7,'width_inches':21.0}),
('non-dimension nulls keep old contract',{'name':None,'photo_urls':None,'primary_photo_index':None},{})]
try:
    session.add(Profile(id='synthetic-owner',user_id='synthetic-owner',email='owner@example.invalid',full_name='Synthetic owner',role=RoleEnum.SURFER));session.commit()
    failures=[]
    for label,patch,expected in cases:
        try:check(label,patch,expected)
        except Exception as error:
            session.rollback();failures.append(label);print('FAIL',label,type(error).__name__,str(error))
    print(f'{len(cases)-len(failures)}/{len(cases)} Quiver cases passed')
    raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
