"""Scheduled checkout normal/failure flows: real SQLite, provider double, no network/server."""
import os,sys,socket,types,json
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
for name,folder in [('routes',backend/'routes'),('routes.bookings',backend/'routes/bookings'),('routes.notifications',backend/'routes/notifications')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
async def noop(*a,**k):return None
push=types.ModuleType('routes.notifications.push_payloads');push.notify_booking=noop
sys.modules[push.__name__]=push
legacy=types.ModuleType('stripe_mcp_server');legacy.DB_PATH='unused-fixture-cache'
legacy_calls=[]
def legacy_create(**kw):legacy_calls.append(kw);return {'checkout_session_id':'cs_fixture_legacy','url':'https://fixture.invalid/legacy'}
legacy.stripe_create_checkout_session=legacy_create;sys.modules['stripe_mcp_server']=legacy
from sqlalchemy import create_engine,select,func
from sqlalchemy.orm import Session
from fastapi import HTTPException
from models import Profile,RoleEnum,Booking,BookingParticipant,PaymentTransaction,CreditTransaction,Notification
from routes.bookings import stripe_checkout as route
route.sqlite3=types.SimpleNamespace(connect=blocked)
policy=types.ModuleType('routes.sessions.payments');policy.checkout_emulation_allowed=lambda:False
sys.modules[policy.__name__]=policy
MODELS=(Profile,Booking,BookingParticipant,PaymentTransaction,CreditTransaction,Notification)
engine=create_engine('sqlite:///:memory:')
for model in MODELS:model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 fail_commit=False
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def flush(self):return session.flush()
 async def commit(self):
  if self.fail_commit:raise RuntimeError('Synthetic local commit failure')
  session.commit()
 async def rollback(self):session.rollback()
 async def refresh(self,*a,**k):session.refresh(*a,**k)
db=Adapter()
class Provider:
 def __init__(self):self.calls=[];self.expired=[];self.retrieved=[];self.fail=False;self.expire_fail=False;self.retrieve_fail=False;self.pay_on_expire_failure=False;self.objects={}
 def create(self,**kw):
  self.calls.append(kw)
  if self.fail:raise RuntimeError('Synthetic provider failure')
  sid='cs_fixture_'+str(len(self.calls));obj=types.SimpleNamespace(id=sid,url='https://fixture.invalid/'+sid,metadata=kw['metadata'],amount_total=kw['line_items'][0]['price_data']['unit_amount'],payment_status='unpaid',status='open')
  self.objects[sid]=obj;return obj
 def retrieve(self,sid):
  self.retrieved.append(sid)
  if self.retrieve_fail:raise RuntimeError('Synthetic retrieval failure')
  return self.objects[sid]
 def expire(self,sid):
  self.expired.append(sid)
  if self.expire_fail:
   if self.pay_on_expire_failure:self.objects[sid].payment_status='paid';self.objects[sid].status='complete'
   raise RuntimeError('Synthetic expiry failure')
  self.objects[sid].status='expired';return self.objects[sid]
provider=Provider()
route.stripe.checkout.Session.create=provider.create;route.stripe.checkout.Session.retrieve=provider.retrieve;route.stripe.checkout.Session.expire=provider.expire
route.STRIPE_API_KEY='synthetic-configured'
def drive(co):
 try:co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError('Unexpected asynchronous I/O')
def setup(label):
 session.rollback()
 for model in reversed(MODELS):session.execute(model.__table__.delete())
 session.add_all([Profile(id='buyer',user_id='buyer',email='buyer@example.invalid',full_name='Fixture Buyer',role=RoleEnum.SURFER,credit_balance=20,spend_only_credits=8,withdrawable_credits=0),Profile(id='seller',user_id='seller',email='seller@example.invalid',full_name='Fixture Photographer',role=RoleEnum.PHOTOGRAPHER,booking_hourly_rate=75,credit_balance=0,spend_only_credits=0,withdrawable_credits=0)])
 session.commit();provider.calls.clear();provider.expired.clear();provider.objects.clear();provider.retrieved.clear();legacy_calls.clear();provider.fail=False;provider.expire_fail=False;provider.retrieve_fail=False;provider.pay_on_expire_failure=False;db.fail_commit=False;route.STRIPE_API_KEY='synthetic-configured'
 return route.CreateBookingWithStripeRequest(photographer_id='seller',location='Fixture Beach',session_date='2030-06-10T12:00:00Z',duration=60,apply_credits=10,origin_url='https://fixture.invalid')
def counts():
 with Session(engine) as read:return tuple(read.scalar(select(func.count()).select_from(model)) for model in (Booking,BookingParticipant,PaymentTransaction,CreditTransaction))
def balances():
 with Session(engine) as read:
  row=read.get(Profile,'buyer');return(row.credit_balance,row.spend_only_credits,row.withdrawable_credits)
def unchanged():assert counts()==(0,0,0,0) and balances()==(20,8,0)
def success():
 data=setup('success');result=drive(route.create_booking_with_stripe(data,'buyer',db))
 assert len(provider.calls)==1 and not legacy_calls,'SDK Session.create must replace emulator'
 call=provider.calls[0];assert 'customer' not in call and call['customer_email']=='buyer@example.invalid'
 assert call['mode']=='payment' and call['payment_method_types']==['card']
 price=call['line_items'][0]['price_data'];assert price['unit_amount']==6500 and price['currency']=='usd' and price['product_data']['name']
 assert call['metadata']=={'user_id':'buyer','booking_id':str(result['booking_id']),'photographer_id':'seller','credits_applied':'10.0','type':'scheduled_booking'}
 assert result['amount_to_charge']==65 and result['credits_applied']==10 and result['remaining_credits']==10
 assert counts()==(1,1,1,1) and balances()==(10,0,0)
 with Session(engine) as read:
  tx=read.execute(select(PaymentTransaction)).scalar_one();part=read.execute(select(BookingParticipant)).scalar_one();debit=read.execute(select(CreditTransaction)).scalar_one()
  assert tx.session_id==result['session_id'] and tx.amount==65 and tx.payment_status=='Pending'
  assert json.loads(tx.transaction_metadata)['booking_id']==result['booking_id']
  assert part.paid_amount==10 and part.payment_status=='Pending'
  assert debit.amount==-10 and debit.spend_only_amount==-8 and str(debit.reference_id)==str(result['booking_id'])
 provider.objects[result['session_id']].payment_status='paid';provider.objects[result['session_id']].status='complete'
 confirmed=drive(route.booking_payment_success(result['session_id'],str(result['booking_id']),'buyer',db))
 assert confirmed['status']=='Confirmed' and provider.retrieved==[result['session_id']]
 with Session(engine) as read:
  booking=read.get(Booking,result['booking_id']);tx=read.execute(select(PaymentTransaction)).scalar_one();part=read.execute(select(BookingParticipant)).scalar_one()
  assert booking.status=='Confirmed' and booking.escrow_amount==60 and tx.payment_status=='paid' and part.paid_amount==75
 assert balances()==(10,0,0)
 # Ordinary successful callback retry must not add another debit or topup.
 before=counts();drive(route.booking_payment_success(result['session_id'],str(result['booking_id']),'buyer',db));assert counts()==before
 print('PASS SDK payload, persisted reservation/link/provenance, normal completion and callback retry')
def remaining_promo_completion():
 data=setup('remaining-promo');data.apply_credits=5
 result=drive(route.create_booking_with_stripe(data,'buyer',db))
 assert balances()==(15,3,0)
 provider.objects[result['session_id']].payment_status='paid';provider.objects[result['session_id']].status='complete'
 drive(route.booking_payment_success(result['session_id'],str(result['booking_id']),'buyer',db))
 assert balances()==(15,3,0),'Card settlement must preserve unspent bonus credits'
 print('PASS card settlement preserves remaining promo3 and total15')
def missing_config():
 data=setup('config');route.STRIPE_API_KEY=None
 try:drive(route.create_booking_with_stripe(data,'buyer',db))
 except HTTPException as e:assert e.status_code in (500,503)
 else:raise AssertionError('Missing configuration accepted')
 unchanged();assert not provider.calls and not legacy_calls
 print('PASS missing provider configuration: no booking, payment, participant or ledger writes')
def provider_failure():
 data=setup('provider');provider.fail=True
 try:drive(route.create_booking_with_stripe(data,'buyer',db))
 except HTTPException as e:assert e.status_code==500
 else:raise AssertionError('Provider failure accepted')
 unchanged();assert len(provider.calls)==1 and not provider.expired
 print('PASS provider failure rolls back pending booking and leaves wallet unchanged')
def commit_failure(expire_fails=False):
 data=setup('commit');db.fail_commit=True;provider.expire_fail=expire_fails
 try:drive(route.create_booking_with_stripe(data,'buyer',db))
 except Exception as e:assert 'Synthetic local commit failure' in str(e),'Original local failure must be preserved'
 else:raise AssertionError('Commit failure accepted')
 unchanged();assert provider.expired==['cs_fixture_1']
 print('PASS local commit failure rolls back reservation; expiry attempted; original failure preserved'+(' when expiry also fails' if expire_fails else ''))
def expiry():
 from datetime import datetime,timezone,timedelta
 import database
 m=types.ModuleType('scheduler');m.__path__=[str(backend/'scheduler')];sys.modules['scheduler']=m
 from scheduler.bookings import cleanup_expired_booking_payments_task
 class Context:
  async def __aenter__(self):return db
  async def __aexit__(self,*args):return False
 database.async_session_maker=lambda:Context()
 data=setup('expiry');result=drive(route.create_booking_with_stripe(data,'buyer',db))
 booking=session.get(Booking,result['booking_id']);booking.pending_payment_expires_at=datetime.now(timezone.utc)-timedelta(minutes=1);session.commit()
 with Session(engine) as read:debit_id=read.execute(select(CreditTransaction)).scalar_one().id
 drive(cleanup_expired_booking_payments_task())
 assert balances()==(20,8,0),'Expired checkout must restore original promo classification'
 with Session(engine) as read:
  booking=read.get(Booking,result['booking_id']);refund=read.execute(select(CreditTransaction).where(CreditTransaction.refund_of_transaction_id==debit_id)).scalar_one()
  assert booking.status=='Cancelled' and refund.amount==10 and refund.spend_only_amount==8
 before=counts();drive(cleanup_expired_booking_payments_task());assert counts()==before and balances()==(20,8,0)
 reads=len(provider.retrieved)
 try:drive(route.booking_payment_success(result['session_id'],str(result['booking_id']),'buyer',db))
 except HTTPException as error:assert error.status_code==409
 else:raise AssertionError('Late completion accepted after local expiry')
 assert counts()==before and balances()==(20,8,0) and len(provider.retrieved)==reads
 print('PASS normal expiry restores linked promo8; repeated cleanup adds no refund; delayed completion409 before provider read')
def insufficient_cash():
 setup('insufficient-cash')
 from utils.credits import deduct_credits
 result=drive(deduct_credits('buyer',13,'booking_payment',db,reference_type='booking',reference_id='fixture-cash-only',consume_spend_only=False))
 assert result[0] is False and balances()==(20,8,0) and counts()==(0,0,0,0)
 session.rollback()
 print('PASS cash-only settlement debit refuses13 against cash12 without touching promo8 or ledger')
def provider_expiry_case(kind):
 data=setup(kind);data.apply_credits=5
 result=drive(route.create_booking_with_stripe(data,'buyer',db));booking=session.get(Booking,result['booking_id']);obj=provider.objects[result['session_id']]
 if kind=='paid':obj.payment_status='paid';obj.status='complete'
 elif kind=='already expired':obj.status='expired'
 elif kind=='expiry failure':provider.expire_fail=True
 elif kind=='paid during expiry':provider.expire_fail=True;provider.pay_on_expire_failure=True
 elif kind=='retrieval failure':provider.retrieve_fail=True
 elif kind=='complete unpaid':obj.status='complete'
 elif kind=='missing transaction':session.execute(PaymentTransaction.__table__.delete());session.commit()
 elif kind=='ambiguous transaction':
  session.add(PaymentTransaction(user_id='buyer',session_id='cs_other_fixture',amount=70,currency='usd',payment_status='Pending',status='Pending',transaction_metadata=json.dumps({'booking_id':result['booking_id']})));session.commit()
 allowed=drive(route.reconcile_expired_booking_checkout(booking,db))
 if kind in ('paid','paid during expiry'):
  assert allowed is False and session.get(Booking,result['booking_id']).status=='Confirmed' and balances()==(15,3,0)
  before=counts();drive(route.booking_payment_success(result['session_id'],str(result['booking_id']),'buyer',db));assert counts()==before
 elif kind=='already expired':assert allowed is True and balances()==(15,3,0)
 else:assert allowed is False and session.get(Booking,result['booking_id']).status=='Pending Payment' and balances()==(15,3,0)
 if kind in ('missing transaction','ambiguous transaction'):assert not provider.retrieved
 print('PASS expiry reconciliation:',kind)
def real_test_id():
 data=setup('real-test-id');result=drive(route.create_booking_with_stripe(data,'buyer',db))
 old=result['session_id'];sid='cs_test_fixture_provider';obj=provider.objects.pop(old);obj.id=sid;obj.payment_status='paid';obj.status='complete';provider.objects[sid]=obj
 tx=session.execute(select(PaymentTransaction)).scalar_one();tx.session_id=sid;session.commit()
 policy.checkout_emulation_allowed=lambda:True
 try:
  confirmed=drive(route.booking_payment_success(sid,str(result['booking_id']),'buyer',db))
  assert confirmed['status']=='Confirmed' and provider.retrieved==[sid]
 finally:policy.checkout_emulation_allowed=lambda:False
 print('PASS real SDK-created cs_test-prefixed session retrieves provider even when legacy emulation is enabled')
def cents():
 data=setup('cents');seller=session.get(Profile,'seller');seller.booking_hourly_rate=75.25;session.commit();data.apply_credits=0
 result=drive(route.create_booking_with_stripe(data,'buyer',db));assert provider.calls[0]['line_items'][0]['price_data']['unit_amount']==7525 and result['amount_to_charge']==75.25
 assert balances()==(20,8,0) and counts()==(1,1,1,0)
 print('PASS dollar-to-cent conversion and no-credit checkout')
failures=[]
try:
 for name,fn in [('normal checkout/completion',success),('missing configuration',missing_config),('provider failure',provider_failure),('local commit failure',commit_failure),('cleanup failure',lambda:commit_failure(True)),('fractional cents',cents),('remaining promo completion',remaining_promo_completion),('normal scheduled expiry',expiry),('insufficient cash settlement',insufficient_cash),('real Stripe test session ID',real_test_id)]+[(kind,lambda kind=kind:provider_expiry_case(kind)) for kind in ('paid','already expired','expiry failure','paid during expiry','retrieval failure','complete unpaid','missing transaction','ambiguous transaction')]:
  try:fn()
  except Exception as error:session.rollback();failures.append(name);print('FAIL',name,type(error).__name__,str(error))
 print(f'{18-len(failures)}/18 isolated scheduled checkout cases passed');raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
