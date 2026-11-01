"""Actual normal cancellation and expired-checkout refund handlers, disposable SQLite.
No scheduler/server startup, real identity, provider, weather or external network.
"""
import os,sys,socket,types
from pathlib import Path
from datetime import datetime,timedelta,timezone
keep={k:os.environ[k]for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH')if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(TESTING='1',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*a,**k):raise RuntimeError('External connection disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.bookings',backend/'routes/bookings'),('routes.notifications',backend/'routes/notifications'),('routes.photographer',backend/'routes/photographer')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
import database
from sqlalchemy import text
from sqlalchemy.sql.elements import TextClause
from models import Profile,CreditTransaction,RoleEnum
from routes.photographer import pricing
if '--baseline' in sys.argv:
 import subprocess
 module=types.ModuleType('routes.photographer.pricing');module.__package__='routes.photographer'
 source=subprocess.check_output(['git','show','HEAD:backend/routes/photographer/pricing.py'],cwd=backend.parent,text=True)
 exec(compile(source,'HEAD:backend/routes/photographer/pricing.py','exec'),module.__dict__)
 pricing=module
engine=create_engine('sqlite:///:memory:')
for model in (Profile,CreditTransaction):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,statement,*a,**k):
  # Baseline PostgreSQL EXTRACT syntax gets only a SQLite date-function spelling shim.
  if isinstance(statement,TextClause):
   q=str(statement).replace('EXTRACT(YEAR FROM created_at)',"CAST(strftime('%Y',created_at) AS INTEGER)").replace('EXTRACT(MONTH FROM created_at)',"CAST(strftime('%m',created_at) AS INTEGER)")
   statement=text(q)
  return session.execute(statement,*a,**k)
db=Adapter()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected I/O {v}')
now=datetime.now(timezone.utc);previous=now.replace(day=1)-timedelta(days=1)
user=Profile(id='earnings-fixture',user_id='earnings-fixture',email='earnings-fixture@example.invalid',role=RoleEnum.PHOTOGRAPHER,credit_balance=115,spend_only_credits=15,withdrawable_credits=110)
empty=Profile(id='empty-fixture',user_id='empty-fixture',email='empty-fixture@example.invalid',role=RoleEnum.PHOTOGRAPHER,credit_balance=0)
session.add_all([user,empty])
def row(kind,amount,when=now,owner=user.id):
 session.add(CreditTransaction(user_id=owner,amount=amount,spend_only_amount=0,balance_before=0,balance_after=max(0,amount),transaction_type=kind,created_at=when))
for kind,amount in [('gallery_sale',17),('bulk_gallery_sale',13),('booking_earning',23),('live_session_earning',31),('dispatch_earning',29)]:row(kind,amount)
for kind in ('stripe_topup','credit_bonus','booking_refund','dispute_refund','admin_adjustment','unknown_fixture','gallery_purchase','live_session_buyin','stoke_sponsor_income'):row(kind,100)
row('gallery_sale',-10);row('gallery_sale',50,previous)
row('gallery_sale',70,previous,empty.id)
session.commit()
failures=[]
def check(name,fn):
 try:fn();print('PASS',name)
 except Exception as e:failures.append(name);print('FAIL',name,type(e).__name__,str(e))
def breakdown():
 r=drive(pricing.get_earnings_breakdown(user.id,days=1,current_user_id=user.id,db=db))
 assert r.total==113,(r.total,r)
 assert (r.live_sessions,r.request_pro,r.regular_bookings,r.gallery_sales)==(31,29,23,30),r
 assert r.cash_available==100 and r.wallet_balance==115,r
 assert r.total==r.live_sessions+r.request_pro+r.regular_bookings+r.gallery_sales

def history():
 r=drive(pricing.get_earnings_history(user.id,months=2,current_user_id=user.id,db=db))
 assert r['summary']['total_earnings']==163,r
 assert r['summary']['current_month']==113 and r['summary']['previous_month']==50,r
 for h in r['history']:assert h['total']==sum(h[k]for k in ('live_sessions','request_pro','regular_bookings','gallery_sales')),h

def sparse():
 r=drive(pricing.get_earnings_history(empty.id,months=2,current_user_id=empty.id,db=db))
 assert r['summary']['current_month']==0 and r['summary']['previous_month']==70,r
 assert r['history'][0]['month']==now.month and r['history'][0]['total']==0,r

def capped():
 user.withdrawable_credits=1000;session.commit()
 r=drive(pricing.get_earnings_breakdown(user.id,days=1,current_user_id=user.id,db=db));assert r.cash_available==100,r
 user.withdrawable_credits=-5;session.commit()
 r=drive(pricing.get_earnings_breakdown(user.id,days=1,current_user_id=user.id,db=db));assert r.cash_available==0,r
try:
 check('recognized net ledger excludes funding refunds unknown and buyer labels',breakdown)
 check('history totals match net stream components and calendar months',history)
 check('sparse history does not label prior income current month',sparse)
 check('cash is capped at wallet minus promo and floored zero',capped)
 print(f'{4-len(failures)}/4 earnings backend cases passed');raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
