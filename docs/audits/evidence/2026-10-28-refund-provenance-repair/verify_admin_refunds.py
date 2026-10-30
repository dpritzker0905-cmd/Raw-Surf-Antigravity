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
for name,folder in [('routes',backend/'routes'),('routes.bookings',backend/'routes/bookings'),('routes.notifications',backend/'routes/notifications'),('routes.admin',backend/'routes/admin')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
import database
from models import Profile,Booking,BookingParticipant,CreditTransaction,RoleEnum,Dispute,AuditLog,GalleryItem,LiveSession,LiveSessionParticipant
from utils.credits import deduct_credits
from routes.admin import telemetry,moderation
from fastapi import HTTPException
if '--baseline' in sys.argv:
 import subprocess
 for name in ('telemetry','moderation'):
  source=subprocess.check_output(['git','show','HEAD:backend/routes/admin/'+name+'.py'],cwd=backend.parent,text=True)
  module=types.ModuleType('routes.admin.'+name)
  exec(compile(source,'HEAD:backend/routes/admin/'+name+'.py','exec'),module.__dict__)
  globals()[name]=module
engine=create_engine('sqlite:///:memory:')
for model in (Profile,Booking,BookingParticipant,CreditTransaction,Dispute,AuditLog,GalleryItem,LiveSession,LiveSessionParticipant):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def rollback(self):return session.rollback()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
 async def flush(self):return session.flush()
db=Adapter()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected async I/O {v}')
def seed(name,kind='booking',missing=False):
 buyer=Profile(id=name,user_id=name,email=name+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Synthetic buyer',credit_balance=115,spend_only_credits=15,withdrawable_credits=100)
 seller=Profile(id=name+'-seller',user_id=name+'-seller',email=name+'-seller@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Synthetic seller')
 booking=Booking(id=name+'-booking',photographer_id=seller.id,creator_id=name,location='Synthetic beach',session_date=datetime.now(timezone.utc)+timedelta(hours=36),total_price=20,status='Confirmed',escrow_status='held')
 seat=BookingParticipant(id=name+'-seat',booking_id=booking.id,participant_id=name,paid_amount=20,payment_status='Paid',status='confirmed')
 session.add_all([buyer,seller,booking,seat]);session.commit()
 refid=booking.id if kind=='booking' else name+'-item'
 if not missing:
  ok,_,err=drive(deduct_credits(name,20,'booking_payment' if kind=='booking' else 'gallery_purchase',db,reference_type=kind,reference_id=refid,counterparty_id=seller.id));assert ok,err;session.commit()
 tx=session.execute(select(CreditTransaction).where(CreditTransaction.user_id==name,CreditTransaction.amount<0)).scalar_one_or_none()
 return buyer,seller,booking,tx,refid

def state(name):
 with Session(engine)as read:
  user=read.get(Profile,name)
  rows=read.execute(select(CreditTransaction).where(CreditTransaction.user_id==name,CreditTransaction.amount>0)).scalars().all()
  return (user.credit_balance,user.spend_only_credits,user.withdrawable_credits,[(r.amount,r.spend_only_amount,r.refund_of_transaction_id,r.transaction_type,r.counterparty_id)for r in rows])

def dispute(name,kind):
 buyer,seller,booking,tx,refid=seed(name,'gallery_item' if kind=='gallery' else 'booking',missing=kind in ('missing','unlinked','live-missing'))
 d=Dispute(id=name+'-dispute',complainant_id=name,respondent_id=seller.id,subject='Synthetic dispute',description='Disposable normal refund fixture',dispute_type='payment')
 if kind=='exact':d.transaction_id=tx.id
 elif kind in ('booking','missing'):d.booking_id=booking.id
 elif kind=='gallery':d.gallery_item_id=refid
 elif kind in ('live','live-missing'):
  live=LiveSession(id=name+'-live',photographer_id=seller.id);session.add(live)
  session.add(LiveSessionParticipant(id=name+'-live-seat',photographer_id=seller.id,surfer_id=name,live_session_id=live.id,amount_paid=20,payment_credit_transaction_id=tx.id if tx else None));d.live_session_id=live.id
 session.add(d);session.commit()
 return d,buyer

def resolve(d,amount):
 return drive(moderation.update_dispute(d.id,moderation.UpdateDisputeRequest(status='resolved_refunded',amount_refunded=amount),admin=d.complainant,db=db))
def telemetry_test():
 buyer,seller,b,tx,_=seed('telemetry');drive(telemetry._perform_real_cancellation_refund(b.id,db));a=state(buyer.id)
 assert a[:3]==(115,15,100),a
 assert a[3]==[(20,15,tx.id,'booking_refund',seller.id)],a
 assert session.get(BookingParticipant,'telemetry-seat').payment_status=='Refunded'
 drive(telemetry._perform_real_cancellation_refund(b.id,db));assert state(buyer.id)==a

def telemetry_missing():
 buyer,_,b,_,_=seed('telemetry-missing',missing=True)
 try:drive(telemetry._perform_real_cancellation_refund(b.id,db));raise AssertionError('expected reconciliation error')
 except HTTPException as e:assert e.status_code==409
 assert session.get(Booking,b.id).status=='Confirmed';assert state(buyer.id)==(115,15,100,[])

def telemetry_atomic():
 buyer,_,booking,_,_=seed('telemetry-atomic')
 other=Profile(id='telemetry-other',user_id='telemetry-other',email='telemetry-other@example.invalid',role=RoleEnum.PHOTOGRAPHER,credit_balance=115,spend_only_credits=15,withdrawable_credits=100)
 seat=BookingParticipant(id='telemetry-other-seat',booking_id=booking.id,participant_id=other.id,paid_amount=20,payment_status='Paid',status='confirmed')
 session.add_all([other,seat]);session.commit();session.expire(booking,['participants'])
 try:drive(telemetry._perform_real_cancellation_refund(booking.id,db));raise AssertionError('expected reconciliation error')
 except HTTPException as e:assert e.status_code==409
 assert state(buyer.id)==(95,0,95,[]);assert state(other.id)==(115,15,100,[])
 assert session.get(Booking,booking.id).status=='Confirmed'
 assert session.get(BookingParticipant,'telemetry-atomic-seat').payment_status=='Paid'

def telemetry_pending(status,closed):
 name='pending-'+status.replace(' ','-')+('-closed' if closed else '-unknown')
 buyer,_,booking,_,_=seed(name);booking.status=status;session.commit()
 module_name='routes.bookings.stripe_checkout';prior=sys.modules.get(module_name)
 double=types.ModuleType(module_name);calls=[]
 async def reconcile(candidate,database_session):
  # Only orchestration is doubled. All cancellation, credit and ledger work is real.
  assert candidate.id==booking.id and candidate.status==status
  assert database_session is db and state(buyer.id)==(95,0,95,[])
  calls.append(candidate.id);return closed
 double.reconcile_expired_booking_checkout=reconcile;sys.modules[module_name]=double
 try:
  if closed:
   drive(telemetry._perform_real_cancellation_refund(booking.id,db))
   assert state(buyer.id)[:3]==(115,15,100)
   assert session.get(Booking,booking.id).status=='Cancelled'
   assert session.get(BookingParticipant,name+'-seat').payment_status=='Refunded'
  else:
   try:drive(telemetry._perform_real_cancellation_refund(booking.id,db));raise AssertionError('expected checkout reconciliation')
   except HTTPException as e:assert e.status_code==409
   assert state(buyer.id)==(95,0,95,[])
   assert session.get(Booking,booking.id).status==status
   assert session.get(BookingParticipant,name+'-seat').payment_status=='Paid'
  assert calls==[booking.id]
 finally:
  if prior is None:sys.modules.pop(module_name,None)
  else:sys.modules[module_name]=prior

def linked(kind):
 d,buyer=dispute('dispute-'+kind,kind);resolve(d,5);a=state(buyer.id);assert a[:3]==(100,5,95),a
 resolve(d,15);a=state(buyer.id);assert a[:3]==(115,15,100),a;assert all(r[2] and r[3]=='dispute_refund' for r in a[3]),a
 try:resolve(d,1);raise AssertionError('expected exhausted payment')
 except HTTPException as e:assert e.status_code==409
 assert state(buyer.id)==a

def missing(kind):
 d,buyer=dispute('dispute-'+kind,kind)
 try:resolve(d,5);raise AssertionError('expected reconciliation error')
 except HTTPException as e:assert e.status_code==409
 assert state(buyer.id)==(115,15,100,[]);assert session.get(Dispute,d.id).status=='open'
def compensation():
 d,buyer=dispute('dispute-unlinked','unlinked');resolve(d,5);a=state(buyer.id)
 assert a[:3]==(120,15,105),a;assert a[3]==[(5,0,None,'dispute_refund',None)],a
cases=[('admin cancellation composition and repeat',telemetry_test),('admin cancellation failure rollback',telemetry_missing),('multi-participant cancellation rollback',telemetry_atomic)]+[(kind+' dispute partial/full/repeat',lambda kind=kind:linked(kind))for kind in ('exact','booking','gallery','live')]+[(kind+' dispute reconciliation rollback',lambda kind=kind:missing(kind))for kind in ('missing','live-missing')]+[('unlinked admin compensation remains separate',compensation)]
cases += [(status+(' closed checkout' if closed else ' unknown checkout'),lambda status=status,closed=closed:telemetry_pending(status,closed))for status in ('Pending Payment','PendingPayment')for closed in (False,True)]
failures=[]
try:
 for name,fn in cases:
  try:fn();print('PASS',name)
  except Exception as e:session.rollback();failures.append(name);print('FAIL',name,type(e).__name__,str(e))
 print(f'{len(cases)-len(failures)}/{len(cases)} admin refund cases passed')
 raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
