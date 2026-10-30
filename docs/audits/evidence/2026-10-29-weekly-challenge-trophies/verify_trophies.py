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
from fastapi import FastAPI
from sqlalchemy import select,delete,DateTime,Table,Column,MetaData,text,event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
import database,httpx,importlib.util,ast,time
from models import Profile,RoleEnum,WeeklyChallenge,ChallengeParticipant,ScheduledJobStatus
from routes.career_hub import challenges
if '--baseline' in sys.argv:exec(compile((Path(__file__).parent/'baseline_challenges.py').read_text(encoding='utf-8-sig'),'baseline_challenges.py','exec'),challenges.__dict__)
NOW=RealDateTime(2021,1,4,tzinfo=timezone.utc)
class FrozenDateTime(RealDateTime):
    @classmethod
    def now(cls,tz=None):return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)
challenges.datetime=FrozenDateTime
module=types.ModuleType('scheduler');module.__path__=[str(ROOT/'backend/scheduler')];sys.modules['scheduler']=module
if '--baseline' in sys.argv:
    gamification=types.ModuleType('scheduler.gamification');sys.modules['scheduler.gamification']=gamification
    exec(compile((Path(__file__).parent/'baseline_gamification.py').read_text(encoding='utf-8-sig'),'baseline_gamification.py','exec'),gamification.__dict__)
else:
    from scheduler import gamification
app=FastAPI();app.include_router(challenges.router,prefix='/api')
RESULTS=[];OBSERVATIONS={};SCHEMA=None
async def initialize():
    global SCHEMA
    models=[Profile,WeeklyChallenge,ChallengeParticipant,ScheduledJobStatus]
    async with database.engine.begin() as conn:
        tables={m.__table__ for m in models}
        while True:
            expanded=tables|{fk.column.table for t in tables for fk in t.foreign_keys}
            if expanded==tables:break
            tables=expanded
        await conn.run_sync(lambda sync:database.Base.metadata.create_all(sync,tables=list(tables)))
        if fixture_url:
            rows=(await conn.execute(text("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND ((table_name='profiles' AND column_name='badges') OR (table_name='weekly_challenges' AND column_name IN ('starts_at','ends_at')))"))).all();SCHEMA={r[0]+'.'+r[1]:r[2] for r in rows};assert SCHEMA=={'profiles.badges':'text','weekly_challenges.starts_at':'timestamp with time zone','weekly_challenges.ends_at':'timestamp with time zone'}
async def reset():
    async with database.AsyncSessionLocal() as db:
        for cls in (ScheduledJobStatus,ChallengeParticipant,WeeklyChallenge,Profile):await db.execute(delete(cls))
        await db.commit()
def period(year,week):
    start=RealDateTime.fromisocalendar(year,week,1).replace(tzinfo=timezone.utc);return start,start+timedelta(days=6,hours=23,minutes=59,seconds=59)
def challenge(year,week,status='active'):
    start,end=period(year,week);return WeeklyChallenge(id=str(uuid.uuid4()),year=year,week_number=week,title='Fictional weekly challenge',starts_at=start,ends_at=end,status=status)
async def seed(badge=None,bad_index=None):
    async with database.AsyncSessionLocal() as db:
        previous=challenge(2020,53);current=challenge(2021,1);historical=challenge(2020,52,'completed');db.add_all([previous,current,historical]);await db.flush();people=[]
        for i in range(4):
            identity=str(uuid.uuid4());value=badge if i<3 else '["loser-existing"]'
            if bad_index is not None and i==1:value=bad_index
            db.add(Profile(id=identity,user_id=identity,email=identity+'@example.invalid',full_name='Fictional photographer '+str(i),role=RoleEnum.PHOTOGRAPHER,badges=value));await db.flush();db.add(ChallengeParticipant(challenge_id=previous.id,photographer_id=identity,score=100-i*10,groms_supported=i));people.append(identity)
        db.add(ChallengeParticipant(challenge_id=current.id,photographer_id=people[0],score=5,groms_supported=0));await db.commit()
        return dict(previous=previous.id,current=current.id,historical=historical.id,people=people)
async def snapshot(ids):
    async with database.AsyncSessionLocal() as db:
        rows=(await db.execute(select(ChallengeParticipant).where(ChallengeParticipant.challenge_id==ids['previous']).order_by(ChallengeParticipant.score.desc()))).scalars().all();profiles=[await db.get(Profile,i) for i in ids['people']]
        return dict(statuses=[(await db.get(WeeklyChallenge,ids[k])).status for k in ('previous','current','historical')],ranks=[r.final_rank for r in rows],trophies=[r.earned_trophy for r in rows],scores=[r.score for r in rows],groms=[r.groms_supported for r in rows],badges=[p.badges for p in profiles])
async def finalize(session_type=None):
    if session_type:
        async with session_type(bind=database.engine,expire_on_commit=False,autoflush=False) as db:await challenges.finalize_weekly_challenge(db)
    else:
        async with database.AsyncSessionLocal() as db:await challenges.finalize_weekly_challenge(db)
async def assert_awards(ids,old_badge):
    data=await snapshot(ids);assert data['statuses']==['completed','active','completed'];assert data['ranks']==[1,2,3,4] and data['trophies']==[True,True,True,False];assert data['scores']==[100,90,80,70] and data['groms']==[0,1,2,3]
    prefix=json.loads(old_badge) if old_badge else []
    for rank,stored in enumerate(data['badges'][:3],1):
        assert isinstance(stored,str),'Badge must persist as native Text';badges=json.loads(stored);assert badges[:-1]==prefix,'Existing badges changed';assert badges[-1]==dict(type='weekly_champion',rank=rank,week=53,year=2020,emoji=['🏆','🥈','🥉'][rank-1])
    assert data['badges'][3]=='["loser-existing"]';return data
async def check(name,fn):
    try:await reset();await fn();RESULTS.append(dict(name=name,passed=True))
    except Exception as error:RESULTS.append(dict(name=name,passed=False,error_type=type(error).__name__,detail=str(error)[:180] if not hasattr(error,'statement') else 'Database operation failed; parameters omitted'))
async def storage_case(name,value):
    ids=await seed(value);await finalize();data=await assert_awards(ids,value);OBSERVATIONS[name]=dict(native_text=True,awarded_ranks=data['ranks'],prior_badges_preserved=True)
async def malformed_case(raw):
    ids=await seed('[]',bad_index=raw);before=await snapshot(ids)
    async with database.AsyncSessionLocal() as db:
        try:await challenges.finalize_weekly_challenge(db)
        except ValueError:pass
        else:raise AssertionError('Malformed/non-list badge JSON must fail')
        assert not db.in_transaction(),'Finalizer did not explicitly roll back'
    assert await snapshot(ids)==before,'Malformed badge failure persisted partial work'
async def replay():
    ids=await seed(None);await finalize();first=await assert_awards(ids,None);await finalize();assert await snapshot(ids)==first,'Replay changed ranks/badges'
async def real_constraint_rollback():
    ids=await seed(None);before=await snapshot(ids)
    async with database.AsyncSessionLocal() as db:
        def invalidate(session,context,instances):
            for row in session.dirty:
                if isinstance(row,WeeklyChallenge):row.title=None
        event.listen(db.sync_session,'before_flush',invalidate,once=True)
        try:await challenges.finalize_weekly_challenge(db)
        except IntegrityError:pass
        else:raise AssertionError('Real NOT NULL failure not observed')
        assert not db.in_transaction(),'Constraint failure left transaction active'
    assert await snapshot(ids)==before,'Constraint failure persisted partial finalization'
async def commit_failure():
    ids=await seed(None);before=await snapshot(ids);rollbacks=[]
    class CommitFault(AsyncSession):
        async def commit(self):raise RuntimeError('Synthetic pre-commit failure')
        async def rollback(self):rollbacks.append(True);await super().rollback()
    try:await finalize(CommitFault)
    except RuntimeError:pass
    else:raise AssertionError('Commit failure did not propagate')
    assert rollbacks and await snapshot(ids)==before,'Commit failure rollback missing'
async def history_stats(client):
    ids=await seed(None);await finalize();await assert_awards(ids,None)
    history=(await client.get('/api/challenges/history')).json()['history'];entry=next(r for r in history if r['challenge_id']==ids['previous']);assert [r['photographer_id'] for r in entry['winners']]==ids['people'][:3];assert [r['rank'] for r in entry['winners']]==[1,2,3]
    response=await client.get('/api/challenges/photographer/'+ids['people'][0]+'/stats');assert response.status_code==200;body=response.json();assert body['total_challenges']==2 and body['trophies_earned']==1 and body['current_challenge']==dict(score=5,rank=1,groms_supported=0)
async def empty_previous():
    async with database.AsyncSessionLocal() as db:row=challenge(2020,53);db.add(row);await db.commit();identity=row.id
    await finalize()
    async with database.AsyncSessionLocal() as db:assert (await db.get(WeeklyChallenge,identity)).status=='completed'
async def no_previous():
    await finalize()
    async with database.AsyncSessionLocal() as db:assert not (await db.execute(select(WeeklyChallenge))).scalars().all()
async def task_case(failure=False):
    ids=await seed('[]',bad_index='not-json' if failure else None);before=await snapshot(ids);fn=getattr(gamification,'weekly_challenge_finalize_task',None);assert callable(fn),'Weekly task callable missing';entries=[];exits=[];old=database.async_session_maker
    class ObservedSession(AsyncSession):
        async def __aenter__(self):entries.append(True);return await super().__aenter__()
        async def __aexit__(self,*args):exits.append(args[0].__name__ if args[0] else None);return await super().__aexit__(*args)
    database.async_session_maker=lambda:ObservedSession(bind=database.engine,expire_on_commit=False,autoflush=False)
    try:
        if failure:
            try:await fn()
            except ValueError:pass
            else:raise AssertionError('Task swallowed finalizer error')
            assert await snapshot(ids)==before
        else:await fn();await assert_awards(ids,'[]')
    finally:database.async_session_maker=old
    assert len(entries)==len(exits)==1,'Task session context not closed';assert exits==(['ValueError'] if failure else [None]),exits
async def schema_consumer():
    mixed=json.dumps(['existing-id',{'type':'unrelated','kept':True}]);ids=await seed(mixed);await finalize();data=await assert_awards(ids,mixed)
    spec=importlib.util.spec_from_file_location('fixture_photographer_schemas',ROOT/'backend/routes/photographer/schemas.py');schemas=importlib.util.module_from_spec(spec);spec.loader.exec_module(schemas)
    values=json.loads(data['badges'][0]);response=schemas.PhotographerStatsResponse(badges=values);assert response.model_dump()['badges']==values,'Actual photographer schema lost mixed badge entries'
def tracked_wrapper():
    tree=ast.parse((ROOT/'backend/scheduler/base.py').read_text(encoding='utf-8-sig'));nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in ('_run_tracked_job','tracked')];assert len(nodes)==2
    namespace=dict(asyncio=asyncio,logger=logging.getLogger('fixture-tracked'),_time=time,datetime=FrozenDateTime,timezone=timezone,scheduler=types.SimpleNamespace(get_job=lambda job_id:None))
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'fixture-extracted-tracked','exec'),namespace);return namespace['tracked']
async def tracked_case(mode):
    ids=await seed('[]',bad_index='not-json' if mode=='failure' else None);before=await snapshot(ids);fn=getattr(gamification,'weekly_challenge_finalize_task',None);assert callable(fn),'Weekly task callable missing';job='weekly_challenge_finalize'
    if mode=='disabled':
        async with database.AsyncSessionLocal() as db:db.add(ScheduledJobStatus(job_name=job,is_enabled=False,last_run_status='unknown'));await db.commit()
    await tracked_wrapper()(job,'Fictional weekly finalization','Monday 00:05 UTC',fn)()
    async with database.AsyncSessionLocal() as db:status=(await db.execute(select(ScheduledJobStatus).where(ScheduledJobStatus.job_name==job))).scalar_one();observed=dict(status=status.last_run_status,total=status.total_runs,successes=status.success_count,failures=status.failure_count,error=status.last_run_error,enabled=status.is_enabled)
    if mode=='disabled':assert observed==dict(status='unknown',total=0,successes=0,failures=0,error=None,enabled=False);assert await snapshot(ids)==before
    elif mode=='failure':assert observed['status']=='failed' and observed['total']==1 and observed['failures']==1 and observed['successes']==0 and observed['error']=='Profile badges must contain a JSON array';assert await snapshot(ids)==before
    else:assert observed['status']=='success' and observed['total']==observed['successes']==1 and observed['failures']==0 and observed['error'] is None;await assert_awards(ids,'[]')
    OBSERVATIONS['tracked_'+mode]=observed
async def concurrent_finalizers():
    ids=await seed(None);first_ready=asyncio.Event();release=asyncio.Event();second_attempt=asyncio.Event();locks=[];second_pid=None
    class HeldCommit(AsyncSession):
        async def commit(self):first_ready.set();await release.wait();return await super().commit()
    async def second_run():
        nonlocal second_pid
        async with database.AsyncSessionLocal() as db:
            second_pid=(await db.execute(text('SELECT pg_backend_pid()'))).scalar_one();await challenges.finalize_weekly_challenge(db)
    def observe(conn,cursor,statement,parameters,context,many):
        if 'weekly_challenges' in statement and 'FOR UPDATE' in statement.upper():
            locks.append(True)
            if len(locks)==2:second_attempt.set()
    event.listen(database.engine.sync_engine,'before_cursor_execute',observe);first=asyncio.create_task(finalize(HeldCommit));second=None;lock_receipt=None
    try:
        await asyncio.wait_for(first_ready.wait(),5);second=asyncio.create_task(second_run());await asyncio.wait_for(second_attempt.wait(),5)
        deadline=time.monotonic()+2
        async with database.AsyncSessionLocal() as observer:
            while time.monotonic()<deadline:
                row=(await observer.execute(text('SELECT a.wait_event_type, EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND NOT l.granted) AS ungranted FROM pg_stat_activity a WHERE a.pid=:pid'),dict(pid=second_pid))).one_or_none()
                if row and row[0]=='Lock' and row[1]:lock_receipt=dict(wait_event_type=row[0],ungranted_lock=bool(row[1]));break
                await asyncio.sleep(0.02)
        assert lock_receipt,'PostgreSQL server lock wait not observed';assert not second.done();release.set();await asyncio.wait_for(asyncio.gather(first,second),10);await assert_awards(ids,None);OBSERVATIONS['concurrency']=dict(actual_pg_lock_receipt=lock_receipt,completed_finalizers=2,single_award_per_winner=True)
    finally:
        release.set();await asyncio.gather(first,*([second] if second else []),return_exceptions=True);event.remove(database.engine.sync_engine,'before_cursor_execute',observe)
async def main():
    try:
        await initialize()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
            mixed=json.dumps(['existing-id',{'type':'unrelated','nested':{'kept':True}},{'type':'weekly_champion','week':52,'year':2020,'rank':2,'emoji':'🥈'}])
            for name,value in [('null',None),('empty_text',''),('empty_array','[]'),('mixed',mixed)]:await check('native_text_'+name,lambda n=name,v=value:storage_case(n,v))
            for raw in ['{','null','{}','"badge-id"','1']:await check('reject_nonarray_'+raw,lambda r=raw:malformed_case(r))
            for name,fn in [('replay_idempotent',replay),('real_constraint_atomic_rollback',real_constraint_rollback),('injected_commit_atomic_rollback',commit_failure),('actual_history_and_challenge_stats',lambda:history_stats(client)),('empty_previous',empty_previous),('missing_previous',no_previous),('actual_photographer_schema_mixed_badges',schema_consumer),('tracked_success',lambda:tracked_case('success')),('tracked_failure_status_and_rollback',lambda:tracked_case('failure')),('tracked_disabled_skips',lambda:tracked_case('disabled')),('task_session_success',lambda:task_case(False)),('task_error_propagates_and_session_closes',lambda:task_case(True))]:await check(name,fn)
            if fixture_url:await check('actual_pg_concurrent_finalization',concurrent_finalizers)
    finally:await database.engine.dispose()
    passed=sum(r['passed'] for r in RESULTS);print(json.dumps(dict(passed=passed,total=len(RESULTS),baseline='--baseline' in sys.argv,database='isolated PostgreSQL' if fixture_url else 'isolated SQLite native types',native_badges_text=True,timezone_adapter=False,postgres_schema=SCHEMA,actual_asgi=True,actual_async_session=True,actual_scheduler_task_without_registry_start=True,actual_extracted_tracked_wrapper=True,baseline_task_present=callable(getattr(gamification,'weekly_challenge_finalize_task',None)),pg_concurrency_exercised=bool(fixture_url),normal_startup=False,external_connections=False,database_disposed=True,results=RESULTS,observations=OBSERVATIONS),indent=2));return 0 if passed==len(RESULTS) else 1
if __name__=='__main__':sys.exit(loop.run_until_complete(main()))
