"""Actual calendar SQL filter on disposable UTC SQLite rows; no server/network."""
import os,socket,sys,types
from pathlib import Path
from datetime import datetime
keep={k:os.environ[k]for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH')if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(TESTING='1',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*a,**k):raise RuntimeError('Network disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.photographer',backend/'routes/photographer')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from models import Profile,Booking,BookingParticipant,PhotographerAvailability,RoleEnum
from routes.photographer.availability import get_photographer_bookings_calendar
engine=create_engine('sqlite:///:memory:')
for model in (Profile,Booking,BookingParticipant,PhotographerAvailability):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class DB:
 async def execute(self,*a,**k):return session.execute(*a,**k)
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected I/O {v}')
session.add(Profile(id='synthetic-pro',user_id='synthetic-pro',email='synthetic@example.invalid',role=RoleEnum.PHOTOGRAPHER))
for name,at in [('before','2026-11-01T03:59:59'),('start','2026-11-01T04:00:00'),('late','2026-12-01T04:30:00'),('last','2026-12-01T04:59:59.999000'),('next','2026-12-01T05:00:00')]:
 session.add(Booking(id=name,photographer_id='synthetic-pro',creator_id='synthetic-pro',session_date=datetime.fromisoformat(at),status='Confirmed',duration=60,max_participants=1,location='Synthetic beach',total_price=20,price_per_person=20))
session.commit()
try:
 response=drive(get_photographer_bookings_calendar('synthetic-pro','2026-11-01T04:00:00Z','2026-12-01T04:59:59.999Z',DB()))
 ids={b['id']for b in response['bookings']}
 for name,ok in [('local start included','start'in ids),('local final evening included','late'in ids),('inclusive last millisecond included','last'in ids),('outside local month excluded','before'not in ids and'next'not in ids)]:
  assert ok,(name,ids);print('PASS',name)
 print('4/4 actual calendar SQL boundary checks passed')
finally:session.close();engine.dispose()
