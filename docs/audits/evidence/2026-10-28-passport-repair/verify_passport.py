"""Actual Passport handlers with real disposable SQLite and synthetic roles.
No authentication, HTTP server, real GPS, provider or async PostgreSQL is tested.
The synchronous Session adapter manually drives async handlers without an event loop.
Python socket guards are in-process, not an OS firewall. Noon clock is synthetic.
"""
import os, socket, sys, types, json
from pathlib import Path
from datetime import datetime, timezone, date, timedelta
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True

def blocked(*args,**kwargs):raise RuntimeError('External connection disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *args,**kwargs:False
for name,folder in [('routes',backend/'routes'),('routes.career_hub',backend/'routes/career_hub')]:
    module=types.ModuleType(name);module.__path__=[str(folder)];sys.modules[name]=module
from sqlalchemy import create_engine,select,func
from sqlalchemy.orm import Session
from models import Profile,RoleEnum,SurfSpot,SurfPassportCheckIn,SurfPassportStats
from routes.career_hub import passport

class FixedDateTime(datetime):
    @classmethod
    def now(cls,tz=None):return datetime(2026,10,28,12,0,tzinfo=timezone.utc if tz else None)
class FixedDate(date):
    @classmethod
    def today(cls):return date(2026,10,28)
passport.datetime=FixedDateTime;passport.date=FixedDate

class Adapter:
    def __init__(self,session):self.session=session
    async def execute(self,*args,**kwargs):return self.session.execute(*args,**kwargs)
    def add(self,*args,**kwargs):return self.session.add(*args,**kwargs)
    async def commit(self):return self.session.commit()
    async def flush(self):return self.session.flush()
    async def refresh(self,*args,**kwargs):return self.session.refresh(*args,**kwargs)
    async def rollback(self):return self.session.rollback()

def drive(co):
    try:yielded=co.send(None)
    except StopIteration as done:return done.value
    else:co.close();raise AssertionError(f'Unexpected asynchronous I/O: {yielded!r}')

def fixture(role=RoleEnum.SURFER,stats=None):
    engine=create_engine('sqlite:///:memory:')
    for model in (Profile,SurfSpot,SurfPassportStats,SurfPassportCheckIn):model.__table__.create(engine)
    session=Session(engine,expire_on_commit=False)
    session.add(Profile(id='synthetic-user',user_id='synthetic-user',email='passport@example.invalid',full_name='Synthetic Passport User',role=role))
    session.add(SurfSpot(id='synthetic-spot',name='Synthetic Spot',latitude=0,longitude=0,country='Testland',region='Synthetic Coast'))
    if stats is not None:session.add(SurfPassportStats(user_id='synthetic-user',**stats))
    session.commit()
    return engine,session,Adapter(session)

def checkin(db):return drive(passport.checkin_at_spot(passport.CheckInRequest(spot_id='synthetic-spot',latitude=0,longitude=0),'synthetic-user',db))
def assert_persisted(engine,total,xp,spots=1,streak=1,longest=1):
    with Session(engine) as read:
        row=read.execute(select(SurfPassportStats)).scalar_one()
        assert row.total_checkins==total and row.total_xp_earned==xp
        assert row.unique_spots_visited==spots and row.current_streak_days==streak and row.longest_streak_days==longest
        assert read.execute(select(func.count(SurfPassportCheckIn.id))).scalar()==total
        assert row.last_checkin_date==date(2026,10,28)

def missing_first(role):
    engine,session,db=fixture(role)
    try:
        result=checkin(db)
        assert result.success and result.is_first_visit and result.xp_earned==600 and result.new_total_xp==600 and result.new_level==2
        assert result.badge_earned=='first_checkin' and result.streak_days==1
        assert_persisted(engine,1,600)
    finally:session.close();engine.dispose()

def repeat_control(via_get=False):
    engine,session,db=fixture(stats=None if via_get else {})
    try:
        if via_get:
            initial=drive(passport.get_passport_stats('synthetic-user',db))
            assert initial['total_checkins']==0 and initial['total_xp_earned']==0
        first=checkin(db);second=checkin(db)
        assert first.xp_earned==600 and first.is_first_visit
        assert second.success and not second.is_first_visit and second.xp_earned==25 and second.new_total_xp==625
        assert second.streak_days==1 and second.new_level==2 and second.badge_earned is None
        assert_persisted(engine,2,625)
        readback=drive(passport.get_passport_stats('synthetic-user',db))
        assert readback['total_checkins']==2 and len(readback['recent_checkins'])==2
        assert readback['countries_breakdown']=={'Testland':2} and readback['badges_earned']==['first_checkin']
    finally:session.close();engine.dispose()

def existing_streak():
    engine,session,db=fixture(stats={'total_checkins':2,'total_xp_earned':1000,'unique_spots_visited':1,'unique_countries_visited':1,'current_streak_days':3,'longest_streak_days':5,'last_checkin_date':date(2026,10,27),'countries_breakdown':json.dumps({'Testland':2})})
    try:
        result=checkin(db)
        assert result.xp_earned==300 and result.new_total_xp==1300 and result.streak_days==4 and result.new_level==2
        with Session(engine) as read:
            stats=read.execute(select(SurfPassportStats)).scalar_one()
            assert stats.total_checkins==3 and stats.current_streak_days==4 and stats.longest_streak_days==5
            assert stats.unique_spots_visited==2 and stats.unique_countries_visited==1 and stats.total_xp_earned==1300
    finally:session.close();engine.dispose()

cases=[('missing stats Surfer first',lambda:missing_first(RoleEnum.SURFER)),('missing stats Photographer first',lambda:missing_first(RoleEnum.PHOTOGRAPHER)),('missing stats Grom first',lambda:missing_first(RoleEnum.GROM)),('preseeded stats first/repeat/readback',repeat_control),('stats GET first/repeat/readback',lambda:repeat_control(True)),('existing streak XP preserved',existing_streak)]
failures=[]
for name,fn in cases:
    try:fn()
    except Exception as error:failures.append(name);print('FAIL',name,type(error).__name__,str(error))
    else:print('PASS',name)
print(f'{len(cases)-len(failures)}/{len(cases)} Passport cases passed')
raise SystemExit(bool(failures))
