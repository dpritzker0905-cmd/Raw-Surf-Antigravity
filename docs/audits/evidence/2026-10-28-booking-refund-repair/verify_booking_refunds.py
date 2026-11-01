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
for name,folder in [('routes',backend/'routes'),('routes.bookings',backend/'routes/bookings'),('routes.notifications',backend/'routes/notifications'),('scheduler',backend/'scheduler')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
import database
from models import Profile,Booking,BookingParticipant,CreditTransaction,Notification,RoleEnum
from utils.credits import deduct_credits
from routes.bookings import booking_cancellation
from routes.notifications import push_payloads
from scheduler import bookings as scheduler_bookings
# This harness isolates refund composition after provider expiry was confirmed.
# Actual provider reconciliation is exercised in scheduled-checkout-repair.
checkout_seam=types.ModuleType('routes.bookings.stripe_checkout')
async def confirmed_expired(*a,**k):return True
checkout_seam.reconcile_expired_booking_checkout=confirmed_expired
sys.modules['routes.bookings.stripe_checkout']=checkout_seam
async def noop(*a,**k):pass
push_payloads.notify_booking=noop
engine=create_engine('sqlite:///:memory:')
for model in (Profile,Booking,BookingParticipant,CreditTransaction,Notification):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def rollback(self):return session.rollback()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
 async def flush(self):return session.flush()
 async def __aenter__(self):return self
 async def __aexit__(self,typ,value,tb):
  if typ:session.rollback()
db=Adapter();database.async_session_maker=lambda:db

def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected async I/O {v}')

def seed(name,promo=15,expired=False,missing=False):
 total=115 if promo else 100
 buyer=Profile(id=name,user_id=name,email=name+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Synthetic buyer',credit_balance=total,spend_only_credits=promo,withdrawable_credits=total-promo)
 seller=Profile(id=name+'-photo',user_id=name+'-photo',email=name+'-photo@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Synthetic seller')
 booking=Booking(id=name+'-booking',photographer_id=seller.id,creator_id=name,location='Synthetic beach',session_date=datetime.now(timezone.utc)+timedelta(hours=36),duration=60,max_participants=1,total_price=20,price_per_person=20,status='Pending Payment'if expired else'Confirmed',pending_payment_expires_at=datetime.now(timezone.utc)-timedelta(hours=1)if expired else None,escrow_status='held')
 participant=BookingParticipant(id=name+'-seat',booking_id=booking.id,participant_id=name,paid_amount=20,payment_status='Paid',status='confirmed')
 session.add_all([buyer,seller,booking,participant]);session.commit()
 if not missing:
  ok,_,error=drive(deduct_credits(name,20,'booking_payment',db,reference_type='booking',reference_id=booking.id,counterparty_id=seller.id));assert ok,error;session.commit()
 return booking.id,seller.id,total

def state(name):
 with Session(engine)as read:
  user=read.get(Profile,name);booking=read.get(Booking,name+'-booking')
  tx=read.execute(select(CreditTransaction).where(CreditTransaction.user_id==name,CreditTransaction.amount>0)).scalars().all()
  return (user.credit_balance,user.spend_only_credits,user.withdrawable_credits,booking.status,[(t.amount,t.spend_only_amount,t.refund_of_transaction_id,t.counterparty_id)for t in tx])

cases=[]
def test(name,fn):cases.append((name,fn))
def expiry():
 seed('expiry',expired=True);drive(scheduler_bookings.cleanup_expired_booking_payments_task());a=state('expiry');assert a[:4]==(115,15,100,'Cancelled'),a;assert len(a[4])==1 and a[4][0][1]==15 and a[4][0][2] and a[4][0][3]=='expiry-photo',a
 test_state=a;drive(scheduler_bookings.cleanup_expired_booking_payments_task());assert state('expiry')==test_state

def cancel(full):
 name='cancel-full'if full else'cancel-partial';bid,seller,_=seed(name)
 result=drive(booking_cancellation.cancel_booking(bid,booking_cancellation.CancelBookingRequest(reason='Synthetic normal cancellation'),seller if full else name,db))
 a=state(name);expected=(115,15,100,'Cancelled')if full else(105,10,95,'Cancelled');assert a[:4]==expected,(a,result)
 assert a[4][0][2] and a[4][0][3]==seller,a

def legacy():
 seed('legacy',promo=0,expired=True);drive(scheduler_bookings.cleanup_expired_booking_payments_task());a=state('legacy');assert a[:4]==(100,0,100,'Cancelled'),a

def missing():
 seed('missing',expired=True,missing=True);drive(scheduler_bookings.cleanup_expired_booking_payments_task());a=state('missing');assert a[:4]==(115,15,100,'Pending Payment')and not a[4],a

def pending_cancel(closed):
 name='pending-closed'if closed else'pending-unknown';bid,seller,_=seed(name,expired=True)
 async def provider_result(*a,**k):return closed
 checkout_seam.reconcile_expired_booking_checkout=provider_result
 try:
  try:drive(booking_cancellation.cancel_booking(bid,booking_cancellation.CancelBookingRequest(reason='Synthetic normal cancellation'),seller,db));assert closed
  except booking_cancellation.HTTPException as error:assert not closed and error.status_code==409
  a=state(name)
  expected=(115,15,100,'Cancelled')if closed else(95,0,95,'Pending Payment')
  assert a[:4]==expected,a
  assert len(a[4])==(1 if closed else 0),a
 finally:checkout_seam.reconcile_expired_booking_checkout=confirmed_expired

def expiry_batch():
 seed('batch-first',expired=True);seed('batch-uncertain',expired=True)
 async def reconcile(booking,db):
  if booking.id=='batch-uncertain-booking':await db.rollback();return False
  return True
 checkout_seam.reconcile_expired_booking_checkout=reconcile
 try:
  drive(scheduler_bookings.cleanup_expired_booking_payments_task())
  assert state('batch-first')[:4]==(115,15,100,'Cancelled'),state('batch-first')
  assert state('batch-uncertain')[:4]==(95,0,95,'Pending Payment'),state('batch-uncertain')
 finally:
  checkout_seam.reconcile_expired_booking_checkout=confirmed_expired
  # Remove this synthetic uncertain row from subsequent expiry cases.
  row=session.get(Booking,'batch-uncertain-booking');row.pending_payment_expires_at=datetime.now(timezone.utc)+timedelta(days=1);session.commit()

test('expiry restores original promo and repeat is inert',expiry)
test('photographer cancellation full composition',lambda:cancel(True))
test('normal partial cancellation promo-first restoration',lambda:cancel(False))
test('legacy cash-only expiry remains cash',legacy)
test('provider rollback does not undo prior booking refund',expiry_batch)
test('failed provenance refund does not cancel or add credits',missing)
test('pending checkout cancellation waits on uncertain provider',lambda:pending_cancel(False))
test('pending checkout cancellation refunds verified closed checkout',lambda:pending_cancel(True))
failures=[]
try:
 for name,fn in cases:
  try:fn();print('PASS',name)
  except Exception as e:session.rollback();failures.append(name);print('FAIL',name,type(e).__name__,str(e))
 print(f'{len(cases)-len(failures)}/{len(cases)} booking refund cases passed')
 raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
