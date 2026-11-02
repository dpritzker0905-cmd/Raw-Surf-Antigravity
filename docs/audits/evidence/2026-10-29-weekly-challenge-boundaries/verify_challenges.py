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
else:assert '--sqlite-utc-adapter' in sys.argv,'Choose --pg or explicit --sqlite-utc-adapter'
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
from sqlalchemy import select,delete,DateTime,Table,Column,MetaData,text
from sqlalchemy.types import TypeDecorator
import database,httpx
from models import Profile,RoleEnum,WeeklyChallenge,ChallengeParticipant
from routes.career_hub import challenges
if '--baseline' in sys.argv:exec(compile((Path(__file__).parent/'baseline_challenges.py').read_text(encoding='utf-8-sig'),'baseline_challenges.py','exec'),challenges.__dict__)
NOW=RealDateTime(2026,10,29,12,tzinfo=timezone.utc)
class FrozenDateTime(RealDateTime):
    @classmethod
    def now(cls,tz=None):return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)
challenges.datetime=FrozenDateTime
class SQLiteFixtureUTC(TypeDecorator):
    impl=DateTime(timezone=True);cache_ok=True
    def process_result_value(self,value,dialect):return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value
if not fixture_url:
    # Explicit adapter only for this dialect's two challenge comparison/response fields.
    for field in ('starts_at','ends_at'):WeeklyChallenge.__table__.c[field].type=SQLiteFixtureUTC()
app=FastAPI();app.include_router(challenges.router,prefix='/api')
OBSERVATIONS={};RESULTS=[];SQLITE_PROBE=None;DIAGNOSTICS=[];PG_SCHEMA_VALIDATION=None

def freeze(value):
    global NOW
    NOW=RealDateTime.fromisoformat(value)
def expected_dates(year,week):
    start=RealDateTime.fromisocalendar(year,week,1).replace(tzinfo=timezone.utc)
    return start,start+timedelta(days=6,hours=23,minutes=59,seconds=59)
def fictional_challenge(year,week,**kwargs):
    start,end=expected_dates(year,week)
    return WeeklyChallenge(id=str(uuid.uuid4()),week_number=week,year=year,title='Fictional challenge',starts_at=start,ends_at=end,status='active',**kwargs)
async def initialize():
    global SQLITE_PROBE,PG_SCHEMA_VALIDATION
    models=[Profile,WeeklyChallenge,ChallengeParticipant]
    async with database.engine.begin() as conn:
        if not fixture_url:
            probe=Table('fixture_timezone_probe',MetaData(),Column('value',DateTime(timezone=True)))
            await conn.run_sync(probe.create);await conn.execute(probe.insert().values(value=NOW));raw=(await conn.execute(select(probe.c.value))).scalar_one()
            assert raw.tzinfo is None,'Expected raw SQLite timezone loss'
            try:raw>NOW
            except TypeError:SQLITE_PROBE='raw DateTime(timezone=True) read is naive; aware comparison raises TypeError'
            else:raise AssertionError('Raw timezone limitation probe failed')
        tables={c.__table__ for c in models}
        while True:
            expanded=tables|{fk.column.table for t in tables for fk in t.foreign_keys}
            if expanded==tables:break
            tables=expanded
        await conn.run_sync(lambda sync:database.Base.metadata.create_all(sync,tables=list(tables)))
        if fixture_url:
            rows=(await conn.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'weekly_challenges' AND column_name IN ('starts_at','ends_at')"))).all()
            PG_SCHEMA_VALIDATION={row[0]:row[1] for row in rows}
            assert PG_SCHEMA_VALIDATION==dict(starts_at='timestamp with time zone',ends_at='timestamp with time zone'),'Actual PostgreSQL challenge timestamp schema mismatch'

async def reset():
    async with database.AsyncSessionLocal() as session:
        for model in (ChallengeParticipant,WeeklyChallenge,Profile):await session.execute(delete(model))
        await session.commit()
async def add_people(session,challenge,count):
    people=[]
    for index in range(count):
        identity=str(uuid.uuid4());profile=Profile(id=identity,user_id=identity,email=identity+'@example.invalid',full_name='Fictional photographer '+str(index),role=RoleEnum.PHOTOGRAPHER)
        session.add(profile);await session.flush();session.add(ChallengeParticipant(challenge_id=challenge.id,photographer_id=identity,score=1000-index,groms_supported=index,earned_trophy=False));people.append(identity)
    return people
async def check(name,fn):
    try:await reset();await fn();RESULTS.append(dict(name=name,passed=True))
    except Exception as error:RESULTS.append(dict(name=name,passed=False,error=str(error)))
async def week_case(value,expected):
    freeze(value);actual=challenges.get_current_week();OBSERVATIONS[value]=dict(actual=actual,expected=expected);assert actual==expected,(actual,expected)
async def dates_case(year,week):
    actual=challenges.get_week_dates(week,year);expected=expected_dates(year,week);assert actual==expected,(str(actual),str(expected));assert actual[0].tzinfo and actual[1].tzinfo
async def sweep():
    checked=0
    for year in range(2015,2031):
        for week in range(1,date(year,12,28).isocalendar().week+1):
            assert challenges.get_week_dates(week,year)==expected_dates(year,week),(year,week);checked+=1
    OBSERVATIONS['iso_sweep']=dict(valid_weeks_checked=checked,years=[2015,2030])
async def current_boundary(client,value,year,week):
    freeze(value)
    async with database.AsyncSessionLocal() as session:
        correct=fictional_challenge(year,week);session.add(correct);await session.commit();identity=correct.id
    response=await client.get('/api/challenges/current');assert response.status_code==200,(response.status_code,response.text[:100]);data=response.json();OBSERVATIONS['current_'+value]=data['challenge']
    assert data['challenge']['id']==identity,'Wrong ISO-year challenge chosen/created';assert (data['challenge']['week_number'],data['challenge']['year'])==(week,year)
    async with database.AsyncSessionLocal() as session:assert len((await session.execute(select(WeeklyChallenge))).scalars().all())==1,'Extra challenge created'
async def auto_create(client):
    freeze('2024-01-01T00:00:00+00:00');response=await client.get('/api/challenges/current');assert response.status_code==200,(response.status_code,response.text[:100]);data=response.json();start,end=expected_dates(2024,1)
    assert data['challenge']['starts_at']==start.isoformat() and data['challenge']['ends_at']==end.isoformat(),'Created boundaries wrong'
    assert data['time_remaining_seconds']==int((end-NOW).total_seconds()) and data['total_participants']==0
    async with database.AsyncSessionLocal() as session:
        row=(await session.execute(select(WeeklyChallenge))).scalar_one();assert row.starts_at==start and row.ends_at==end and row.starts_at.tzinfo and row.ends_at.tzinfo
async def participant_total(client,count):
    freeze('2026-10-29T12:00:00+00:00')
    async with database.AsyncSessionLocal() as session:
        current=fictional_challenge(2026,44);other=fictional_challenge(2026,43);session.add_all([current,other]);await session.flush();people=await add_people(session,current,count);await add_people(session,other,7);await session.commit()
    response=await client.get('/api/challenges/current');assert response.status_code==200,(response.status_code,response.text[:100]);data=response.json();OBSERVATIONS['count_'+str(count)]=dict(reported_total=data['total_participants'],leaderboard_count=len(data['leaderboard']),other_challenge_participants=7)
    assert data['total_participants']==count,(data['total_participants'],count)
    board=data['leaderboard'];assert len(board)==min(20,count);assert [p['photographer_id'] for p in board]==people[:20];assert [p['rank'] for p in board]==list(range(1,len(board)+1));assert [p['is_trophy_position'] for p in board]==[i<=3 for i in range(1,len(board)+1)]
    async with database.AsyncSessionLocal() as session:
        rows=(await session.execute(select(ChallengeParticipant).where(ChallengeParticipant.challenge_id==current.id))).scalars().all();assert all(p.final_rank is None and not p.earned_trophy for p in rows),'Read route awarded rank/trophy'
async def stats_boundary(client):
    freeze('2021-01-01T12:00:00+00:00')
    async with database.AsyncSessionLocal() as session:
        current=fictional_challenge(2020,53);session.add(current);await session.flush();people=await add_people(session,current,1);await session.commit()
    response=await client.get('/api/challenges/photographer/'+people[0]+'/stats');assert response.status_code==200;data=response.json();assert data['current_challenge']==dict(score=1000,rank=1,groms_supported=0),data
async def finalization(value,target_year,target_week,decoy_week=None):
    freeze(value)
    async with database.AsyncSessionLocal() as session:
        target=fictional_challenge(target_year,target_week);session.add(target);await session.flush();people=[]
        decoy=None
        if decoy_week is not None:decoy=fictional_challenge(target_year,decoy_week);session.add(decoy)
        current_year,current_week,_=NOW.isocalendar();current=fictional_challenge(current_year,current_week);session.add(current);await session.commit()
        target_id=target.id;current_id=current.id;decoy_id=decoy.id if decoy else None
    async with database.AsyncSessionLocal() as session:await challenges.finalize_weekly_challenge(session)
    async with database.AsyncSessionLocal() as session:
        target=await session.get(WeeklyChallenge,target_id);current=await session.get(WeeklyChallenge,current_id);assert target.status=='completed','Correct previous ISO week not finalized';assert current.status=='active'
        if decoy_id:assert (await session.get(WeeklyChallenge,decoy_id)).status=='active','Wrong previous-week decoy finalized'
        rows=(await session.execute(select(ChallengeParticipant).where(ChallengeParticipant.challenge_id==target_id))).scalars().all();assert not rows
        OBSERVATIONS['finalize_'+value]=dict(previous_iso_year=target_year,previous_iso_week=target_week,participants=0,trophy_awards_not_exercised=True)
async def nonempty_award_diagnostic():
    await reset();freeze('2026-10-29T12:00:00+00:00')
    async with database.AsyncSessionLocal() as session:
        challenge=fictional_challenge(2026,43);session.add(challenge);await session.flush();await add_people(session,challenge,4);await session.commit();identity=challenge.id
    issue=None
    try:
        async with database.AsyncSessionLocal() as session:await challenges.finalize_weekly_challenge(session)
    except Exception as error:issue=dict(exception_type=type(error).__name__,driver_exception_type=type(getattr(error,'orig',None)).__name__)
    async with database.AsyncSessionLocal() as session:
        challenge=await session.get(WeeklyChallenge,identity);rows=(await session.execute(select(ChallengeParticipant).where(ChallengeParticipant.challenge_id==identity))).scalars().all()
        rolled_back=challenge.status=='active' and all(p.final_rank is None and not p.earned_trophy for p in rows)
    DIAGNOSTICS.append(dict(name='existing_nonempty_trophy_finalization_native_Text_badges',classification='preexisting_failure' if issue else 'unexpected_no_failure',error=issue,transaction_rolled_back=rolled_back,award_policy_repaired=False))
async def score_compatibility():
    freeze('2021-01-01T12:00:00+00:00')
    async with database.AsyncSessionLocal() as session:
        current=fictional_challenge(2020,53);session.add(current);await session.flush();people=await add_people(session,current,1);await session.commit()
    async with database.AsyncSessionLocal() as session:
        await challenges.update_challenge_score(people[0],7.5,'grom',session);await challenges.update_challenge_score(people[0],2.5,'adult',session);await session.commit()
    async with database.AsyncSessionLocal() as session:
        row=(await session.execute(select(ChallengeParticipant))).scalar_one();assert row.score==1010 and row.groms_supported==1,(row.score,row.groms_supported);assert row.last_contribution_at is not None
async def main():
    try:
        await initialize()
        await nonempty_award_diagnostic()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
            for value,expected in [('2021-01-01T12:00:00+00:00',(53,2020)),('2018-12-31T12:00:00+00:00',(1,2019)),('2020-12-31T12:00:00+00:00',(53,2020)),('2024-01-01T00:00:00+00:00',(1,2024)),('2026-10-29T12:00:00+00:00',(44,2026))]:await check('current_week_'+value,lambda v=value,e=expected:week_case(v,e))
            for year,week in [(2024,1),(2024,44),(2020,1),(2020,53),(2021,1),(2019,1)]:await check(f'dates_{year}_{week}',lambda y=year,w=week:dates_case(y,w))
            await check('all_valid_iso_weeks_2015_2030',sweep)
            for value,year,week in [('2021-01-01T12:00:00+00:00',2020,53),('2018-12-31T12:00:00+00:00',2019,1)]:await check('route_current_'+value,lambda v=value,y=year,w=week:current_boundary(client,v,y,w))
            await check('route_auto_create_monday_week1',lambda:auto_create(client))
            for count in (0,1,20,21,47):await check('route_participant_total_'+str(count),lambda c=count:participant_total(client,c))
            await check('route_stats_iso_year_lookup',lambda:stats_boundary(client))
            for value,year,week,decoy in [('2021-01-04T00:00:00+00:00',2020,53,52),('2022-01-03T00:00:00+00:00',2021,52,None),('2026-10-29T12:00:00+00:00',2026,43,None)]:await check('finalize_'+value,lambda v=value,y=year,w=week,d=decoy:finalization(v,y,w,d))
            await check('score_arithmetic_iso_year_compatibility',score_compatibility)
    finally:await database.engine.dispose()
    passed=sum(r['passed'] for r in RESULTS);print(json.dumps(dict(passed=passed,total=len(RESULTS),baseline='--baseline' in sys.argv,database='isolated PostgreSQL' if fixture_url else 'isolated SQLite with explicit UTC result adapter',sqlite_timezone_adapter=not bool(fixture_url),raw_sqlite_probe=SQLITE_PROBE,postgres_timestamp_schema=PG_SCHEMA_VALIDATION,actual_asgi=True,actual_async_session=True,frozen_utc_clock=True,scheduler_started=False,normal_startup=False,external_connections=False,database_disposed=True,results=RESULTS,diagnostics=DIAGNOSTICS,observations=OBSERVATIONS),indent=2));return 0 if passed==len(RESULTS) else 1
if __name__=='__main__':sys.exit(loop.run_until_complete(main()))
