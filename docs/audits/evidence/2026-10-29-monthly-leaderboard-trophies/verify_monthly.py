"""Real challenge routes/storage with a frozen UTC clock and fictional rows only."""
import os,sys,uuid,asyncio,socket,types,json,logging
from pathlib import Path
from datetime import datetime as RealDateTime,timezone,timedelta,date
from urllib.parse import urlsplit
loop=asyncio.new_event_loop();asyncio.set_event_loop(loop)
fixture_url=os.environ.get('CHECKOUT_FIXTURE_DATABASE_URL') if '--pg' in sys.argv else None
if '--pg' in sys.argv:assert fixture_url,'Missing isolated fixture database environment'
if fixture_url:
    parsed=urlsplit(fixture_url);assert parsed.hostname=='127.0.0.1' and parsed.port and parsed.scheme in ('postgresql+asyncpg','postgresql')

keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep);os.environ.update(TESTING='1',DATABASE_URL=fixture_url or 'sqlite+aiosqlite:///:memory:',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',SECRET_KEY=uuid.uuid4().hex)
sys.dont_write_bytecode=True;logging.disable(logging.CRITICAL)
original_connect=socket.socket.connect
def blocked(*a,**k):raise RuntimeError('External connections disabled')
def local_connect(self,address):
    if fixture_url and address[0]=='127.0.0.1' and address[1]==parsed.port:return original_connect(self,address)
    return blocked()
socket.socket.connect=local_connect;socket.socket.connect_ex=socket.create_connection=blocked
ROOT=Path(__file__).resolve().parents[4];sys.path.insert(0,str(ROOT/'backend'))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name in ('routes','routes.career_hub'):
    module=types.ModuleType(name);module.__path__=[str(ROOT/'backend'/name.replace('.','/'))];sys.modules[name]=module
from sqlalchemy import select,delete,text,event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
import database,ast
from models import Profile,RoleEnum,ImpactLedger,LeaderboardSnapshot
from routes.career_hub import leaderboard
if '--baseline' in sys.argv:
    exec(compile((Path(__file__).parent/'baseline_leaderboard.py').read_text(encoding='utf-8'),'baseline','exec'),leaderboard.__dict__)
NOW=RealDateTime(2026,1,1,tzinfo=timezone.utc)
class FrozenDateTime(RealDateTime):
    @classmethod
    def now(cls,tz=None):return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)
leaderboard.datetime=FrozenDateTime
RESULTS=[];OBSERVATIONS={}
async def initialize():
    async with database.engine.begin() as conn:
        tables={m.__table__ for m in (Profile,ImpactLedger,LeaderboardSnapshot)}
        while True:
            expanded=tables|{fk.column.table for t in tables for fk in t.foreign_keys}
            if expanded==tables:break
            tables=expanded
        await conn.run_sync(lambda sync:database.Base.metadata.create_all(sync,tables=list(tables)))
        if fixture_url:
            value=(await conn.execute(text("SELECT data_type FROM information_schema.columns WHERE table_name='profiles' AND column_name='badges'"))).scalar_one();assert value=='text';OBSERVATIONS['PG_badges_type']=value
async def reset():
    async with database.AsyncSessionLocal() as db:
        for cls in (LeaderboardSnapshot,ImpactLedger,Profile):await db.execute(delete(cls))
        await db.commit()
async def seed(raw=None,bad_index=None,count=12):
    month,year=(12,NOW.year-1) if NOW.month==1 else (NOW.month-1,NOW.year)
    people=[]
    async with database.AsyncSessionLocal() as db:
        for i in range(count):
            identity=str(uuid.uuid4());people.append(identity);value=bad_index if i==1 and bad_index is not None else raw
            db.add(Profile(id=identity,user_id=identity,email=identity+'@example.invalid',full_name='Fictional monthly photographer',role=RoleEnum.PHOTOGRAPHER,badges=value));await db.flush()
            for amount in [800-i*20,200-i*10]:db.add(ImpactLedger(photographer_id=identity,recipient_type='cause',amount=amount,source_type='fictional_fixture',month=month,year=year))
            db.add(ImpactLedger(photographer_id=identity,recipient_type='cause',amount=99999,source_type='fictional_fixture',month=NOW.month,year=NOW.year))
            db.add(ImpactLedger(photographer_id=identity,recipient_type='cause',amount=88888,source_type='fictional_fixture',month=month,year=year-1))
        await db.commit()
    return people,month,year
async def snapshot():
    async with database.AsyncSessionLocal() as db:
        profiles=(await db.execute(select(Profile).order_by(Profile.id))).scalars().all();rows=(await db.execute(select(LeaderboardSnapshot).order_by(LeaderboardSnapshot.rank))).scalars().all()
        return dict(badges={p.id:p.badges for p in profiles},archives=[dict(photographer_id=s.photographer_id,month=s.month,year=s.year,total=s.monthly_total,rank=s.rank,award=s.earned_grom_guardian) for s in rows],ledger_count=len((await db.execute(select(ImpactLedger.id))).all()))
async def finalize(cls=None):
    async with (cls(bind=database.engine,expire_on_commit=False,autoflush=False) if cls else database.AsyncSessionLocal()) as db:return await leaderboard.monthly_leaderboard_reset(db)
async def awards(people,month,year,raw):
    data=await snapshot();assert len(data['archives'])==len(people)
    for rank,(identity,row) in enumerate(zip(people,data['archives']),1):
        assert row==dict(photographer_id=identity,month=month,year=year,total=1000-(rank-1)*30,rank=rank,award=rank<=10)
        stored=data['badges'][identity]
        if rank<=10:
            assert isinstance(stored,str);decoded=json.loads(stored);assert decoded[:-1]==(json.loads(raw) if raw else []);assert decoded[-1]==dict(type='grom_guardian',month=month,year=year,rank=rank)
        else:assert stored==raw
    assert data['ledger_count']==len(people)*4
    return data
async def storage(raw):
    people,m,y=await seed(raw);result=await finalize();assert result==dict(archived=12,month=m,year=y);await awards(people,m,y,raw)
async def period(value):
    global NOW
    previous=NOW;NOW=value
    try:await storage('[]')
    finally:NOW=previous
async def malformed(raw):
    await seed('[]',bad_index=raw);before=await snapshot()
    async with database.AsyncSessionLocal() as db:
        try:await leaderboard.monthly_leaderboard_reset(db)
        except ValueError:pass
        else:raise AssertionError('Invalid badge array must fail')
        assert not db.in_transaction(),'Explicit rollback missing'
    assert await snapshot()==before
async def fault(constraint):
    await seed(None);before=await snapshot();rollbacks=[]
    class FaultSession(AsyncSession):
        async def commit(self):
            if not constraint:raise RuntimeError('Synthetic precommit failure')
            return await super().commit()
        async def rollback(self):rollbacks.append(True);await super().rollback()
    async with FaultSession(bind=database.engine,expire_on_commit=False,autoflush=False) as db:
        if constraint:
            def invalidate(session,*args):
                for row in session.new:
                    if isinstance(row,LeaderboardSnapshot):row.month=None;break
            event.listen(db.sync_session,'before_flush',invalidate,once=True)
        try:await leaderboard.monthly_leaderboard_reset(db)
        except (IntegrityError if constraint else RuntimeError):pass
        else:raise AssertionError('Failure not observed')
        assert rollbacks and not db.in_transaction()
    assert await snapshot()==before
async def empty():
    assert await finalize()==dict(archived=0,month=12,year=2025);assert (await snapshot())['archives']==[]
async def nonwinner_invalid():
    people,m,y=await seed('[]')
    async with database.AsyncSessionLocal() as db:p=await db.get(Profile,people[11]);p.badges='invalid-nonwinner';await db.commit()
    await finalize();data=await snapshot();assert data['badges'][people[11]]=='invalid-nonwinner';assert len(data['archives'])==12
async def schema_consumer():
    people,m,y=await seed('["old-id"]');await finalize();data=await snapshot()
    tree=ast.parse((ROOT/'backend/routes/photographer/schemas.py').read_text(encoding='utf-8'));cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='PhotographerStatsResponse')
    from pydantic import BaseModel
    from typing import List,Union
    ns=dict(BaseModel=BaseModel,List=List,Union=Union);exec(compile(ast.fix_missing_locations(ast.Module(body=[cls],type_ignores=[])),'actual-schema','exec'),ns)
    badges=json.loads(data['badges'][people[0]]);assert ns['PhotographerStatsResponse'](badges=badges).model_dump()['badges']==badges
async def task_success():
    people,m,y=await seed('[]');module=types.ModuleType('scheduler');module.__path__=[str(ROOT/'backend/scheduler')];sys.modules['scheduler']=module
    from scheduler.gamification import monthly_leaderboard_reset_task
    await monthly_leaderboard_reset_task();await awards(people,m,y,'[]')
async def check(name,fn):
    try:await reset();await fn();RESULTS.append(dict(name=name,passed=True))
    except Exception as error:RESULTS.append(dict(name=name,passed=False,error_type=type(error).__name__,detail='Database failure; parameters omitted' if hasattr(error,'statement') else str(error)[:150]))
async def main():
    try:
        await initialize()
        mixed=json.dumps(['old-id',{'type':'weekly_champion','rank':1,'week':53,'year':2020},{'type':'grom_guardian','month':11,'year':2025,'rank':2}])
        for name,value in [('NULL',None),('empty_text',''),('array','[]'),('mixed',mixed)]:await check('native_text_'+name,lambda v=value:storage(v))
        for value in ['{','null','{}','"badge"','1']:await check('reject_'+value,lambda v=value:malformed(v))
        for name,fn in [('ordinary_month',lambda:period(RealDateTime(2026,11,1,tzinfo=timezone.utc))),('leap_March',lambda:period(RealDateTime(2024,3,1,tzinfo=timezone.utc))),('constraint_rollback',lambda:fault(True)),('commit_rollback',lambda:fault(False)),('empty',empty),('nonwinner_badges_untouched',nonwinner_invalid),('mixed_schema_consumer',schema_consumer),('actual_monthly_task_success',task_success)]:await check(name,fn)
    finally:await database.engine.dispose()
    passed=sum(row['passed'] for row in RESULTS);print(json.dumps(dict(passed=passed,total=len(RESULTS),baseline='--baseline' in sys.argv,database='isolated PostgreSQL' if fixture_url else 'isolated SQLite',timezone_adapter=False,native_badges_text=True,normal_startup=False,external_connections=False,results=RESULTS,observations=OBSERVATIONS),indent=2));return 0 if passed==len(RESULTS) else 1
if __name__=='__main__':sys.exit(loop.run_until_complete(main()))
