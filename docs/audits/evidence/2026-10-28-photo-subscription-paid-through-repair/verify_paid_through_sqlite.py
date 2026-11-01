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
for name,folder in [('routes',backend/'routes'),('routes.bookings',backend/'routes/bookings'),('routes.notifications',backend/'routes/notifications'),('routes.subscriptions_billing',backend/'routes/subscriptions_billing')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
import database
import json
from sqlalchemy import func
from fastapi import HTTPException
from models import Profile,CreditTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription,RoleEnum
if '--baseline' in sys.argv:
 sources=json.loads((Path(__file__).parent/'baseline_sources.json').read_text(encoding='utf-8'))
 for short in ('photo_sub_helpers','photo_subscriptions'):
  name='routes.subscriptions_billing.'+short;module=types.ModuleType(name);module.__package__='routes.subscriptions_billing'
  sys.modules[name]=module
  exec(compile(sources['backend/routes/subscriptions_billing/'+short+'.py'],name,'exec'),module.__dict__)
from routes.subscriptions_billing import photo_subscriptions as routes,photo_sub_helpers as helpers
class Clock(datetime):
 @classmethod
 def now(cls,tz=None):return fixed if tz else fixed.replace(tzinfo=None)
fixed=datetime(2026,10,28,12,0,tzinfo=timezone.utc)
routes.datetime=helpers.datetime=Clock
engine=create_engine('sqlite:///:memory:')
for model in (Profile,CreditTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):session.commit()
 async def rollback(self):session.rollback()
 async def flush(self):session.flush()
 async def refresh(self,*a,**k):session.refresh(*a,**k)
db=Adapter()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected I/O {v}')
def seed(name,status='active',expiry=None):
 buyer=Profile(id=name,user_id=name,email=name+'@example.invalid',role=RoleEnum.SURFER,credit_balance=115,spend_only_credits=15,withdrawable_credits=0)
 seller=Profile(id=name+'-seller',user_id=name+'-seller',email=name+'-seller@example.invalid',role=RoleEnum.PHOTOGRAPHER)
 plan=PhotographerSubscriptionPlan(id=name+'-plan',photographer_id=seller.id,name='Synthetic weekly',interval='weekly',price=20,photos_included=10,booking_discount_pct=25,on_demand_discount_pct=30)
 sub=SurferPhotoSubscription(id=name+'-sub',surfer_id=name,photographer_id=seller.id,plan_id=plan.id,plan_name=plan.name,plan_interval='weekly',plan_price=20,status=status,started_at=fixed-timedelta(days=2),expires_at=expiry or fixed+timedelta(days=2),amount_paid=20,photos_remaining=10,videos_remaining=2,live_session_buyins_remaining=3,sessions_remaining=4,booking_discount_pct=25,on_demand_discount_pct=30)
 session.add_all([buyer,seller,plan,sub]);session.commit();return buyer,seller,plan,sub

def quota_access():
 buyer,seller,_,sub=seed('access');drive(routes.cancel_subscription(sub.id,buyer.id,buyer.id,db))
 assert sub.status=='cancelled'
 assert drive(helpers.check_quota_inline(db,buyer.id,seller.id,'photo'))['has_quota']
 assert drive(helpers.get_subscription_discount(db,buyer.id,seller.id))==25
 assert drive(helpers.get_subscription_discount(db,buyer.id,seller.id,'on_demand'))==30
 assert drive(routes.check_quota(buyer.id,seller.id,'photo',buyer.id,db))['has_quota']
 assert drive(helpers.try_use_subscription_quota(db,buyer.id,seller.id,'photo'))['remaining']==9
 assert drive(routes.use_quota(buyer.id,seller.id,'photo',2,buyer.id,db))['remaining']==7
 session.refresh(sub);assert sub.photos_remaining==7

def renewal(status,expired):
 name='renew-'+status+str(expired);buyer,seller,plan,sub=seed(name,status,fixed-timedelta(seconds=1)if expired else fixed+timedelta(days=1))
 before=(buyer.credit_balance,buyer.spend_only_credits)
 data=routes.SubscribeRequest(plan_id=plan.id,payment_method='credits')
 if expired:
  result=drive(routes.subscribe_to_plan(data,buyer.id,buyer.id,db));assert result['success'],result
  assert (buyer.credit_balance,buyer.spend_only_credits)==(95,0)
  ledger=session.execute(select(CreditTransaction).where(CreditTransaction.user_id==buyer.id)).scalars().all()
  assert len(ledger)==1 and ledger[0].amount==-20 and ledger[0].spend_only_amount==-15
 else:
  try:drive(routes.subscribe_to_plan(data,buyer.id,buyer.id,db));raise AssertionError('expected duplicate block')
  except HTTPException as e:assert e.status_code==400
  assert (buyer.credit_balance,buyer.spend_only_credits)==before
  assert session.execute(select(func.count(CreditTransaction.id)).where(CreditTransaction.user_id==buyer.id)).scalar()==0

def overlap():
 buyer,seller,_,active=seed('overlap');cancelled=SurferPhotoSubscription(id='overlap-new-cancelled',surfer_id=buyer.id,photographer_id=seller.id,status='cancelled',started_at=fixed-timedelta(days=1),expires_at=fixed+timedelta(days=5),photos_remaining=99,booking_discount_pct=99,amount_paid=20)
 older=SurferPhotoSubscription(id='overlap-old-active',surfer_id=buyer.id,photographer_id=seller.id,status='active',started_at=fixed-timedelta(days=3),expires_at=fixed+timedelta(days=5),photos_remaining=44,booking_discount_pct=44,amount_paid=20)
 session.add_all([cancelled,older]);session.commit()
 assert drive(helpers.get_subscription_discount(db,buyer.id,seller.id))==25
 assert drive(helpers.try_use_subscription_quota(db,buyer.id,seller.id,'photo'))['subscription_id']==active.id
 assert drive(routes.check_quota(buyer.id,seller.id,'photo',buyer.id,db))['subscription_id']==active.id
 assert drive(routes.use_quota(buyer.id,seller.id,'photo',1,buyer.id,db))['remaining']==8

def card_duplicate():
 buyer,_,plan,_=seed('card-duplicate','cancelled')
 try:
  drive(routes.subscribe_to_plan(routes.SubscribeRequest(plan_id=plan.id,payment_method='card'),buyer.id,buyer.id,db))
  raise AssertionError('expected duplicate block before any provider branch')
 except HTTPException as e:assert e.status_code==400
 assert buyer.credit_balance==115 and buyer.spend_only_credits==15
 assert session.execute(select(func.count(SurferPhotoSubscription.id)).where(SurferPhotoSubscription.surfer_id==buyer.id)).scalar()==1

def cancelled_latest():
 buyer,seller,_,sub=seed('cancelled-latest','cancelled');new=SurferPhotoSubscription(id='cancelled-latest-new',surfer_id=buyer.id,photographer_id=seller.id,status='cancelled',started_at=fixed-timedelta(days=1),expires_at=fixed+timedelta(days=5),photos_remaining=12,booking_discount_pct=45,amount_paid=20)
 session.add(new);session.commit();assert drive(helpers.get_subscription_discount(db,buyer.id,seller.id))==45
 assert drive(helpers.try_use_subscription_quota(db,buyer.id,seller.id,'photo'))['subscription_id']==new.id

def cutoff():
 buyer,seller,_,sub=seed('cutoff','cancelled',fixed)
 assert not drive(helpers.check_quota_inline(db,buyer.id,seller.id,'photo'))['subscription_active']
 assert drive(helpers.get_subscription_discount(db,buyer.id,seller.id))==0
 assert not drive(helpers.try_use_subscription_quota(db,buyer.id,seller.id,'photo'))['used']
 assert not drive(routes.check_quota(buyer.id,seller.id,'photo',buyer.id,db))['subscription_active']
 assert not routes._sub_to_dict(sub)['access_active']

def counts():
 buyer,seller,plan,sub=seed('counts','cancelled');expired=SurferPhotoSubscription(id='counts-expired',surfer_id=buyer.id,photographer_id=seller.id,plan_id=plan.id,status='active',expires_at=fixed,amount_paid=20)
 session.add(expired);session.commit()
 assert drive(routes.get_plans(seller.id,db))[0]['subscriber_count']==1
 subscribers=drive(routes.get_my_subscribers(seller.id,seller.id,db));assert subscribers['total']==1 and subscribers['subscribers'][0]['id']==sub.id,subscribers
 rows=drive(routes.get_my_subscriptions(buyer.id,buyer.id,db));byid={row['id']:row for row in rows}
 assert byid[sub.id]['access_active'] and not byid[expired.id]['access_active']
 assert byid[sub.id]['expires_at'].endswith('+00:00')
 assert session.get(SurferPhotoSubscription,expired.id).status=='expired'

def timestamps():
 _,_,_,sub=seed('timestamps','cancelled')
 sub.expires_at=fixed.replace(hour=15,tzinfo=timezone(timedelta(hours=2)))
 result=routes._sub_to_dict(sub);assert result['access_active'] and result['expires_at']=='2026-10-28T13:00:00+00:00',result
 sub.expires_at=fixed.replace(hour=14,tzinfo=timezone(timedelta(hours=2)))
 assert not routes._sub_to_dict(sub)['access_active']
 sub.expires_at=fixed.replace(hour=13,tzinfo=None)
 result=routes._sub_to_dict(sub);assert result['access_active'] and result['expires_at']=='2026-10-28T13:00:00+00:00',result
 session.rollback()

cases=[('cancel retains all quota and discounts through expiry',quota_access)]+[(status+(' expired renewal preserves spend-only debit'if expired else' paid-through duplicate blocked'),lambda status=status,expired=expired:renewal(status,expired))for status in ('active','cancelled')for expired in (False,True)]+[('overlap deterministically prefers newest active',overlap),('cancelled-only overlap selects latest without aggregation',cancelled_latest),('exact expiry is inactive at all seams',cutoff),('counts views and UTC serialization agree',counts),('aware offset and legacy naive timestamps normalize to UTC',timestamps),('cancelled paid-through blocks card initiation before provider branch',card_duplicate)]
failures=[]
try:
 for name,fn in cases:
  try:fn();print('PASS',name)
  except Exception as e:session.rollback();failures.append(name);print('FAIL',name,type(e).__name__,str(e))
 print(f'{len(cases)-len(failures)}/{len(cases)} paid-through backend cases passed');raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
