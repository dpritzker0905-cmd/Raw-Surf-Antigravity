"""Actual ordinary single-item purchase with real SQLite/credit utilities.
Synthetic route identity; no auth/HTTP/provider/PostgreSQL/concurrency proof.
Only badges, subscription quota in its control case, and earnings push are doubled.
Python socket guards are in-process, not an OS firewall.
"""
import json,os,socket,sys,types
from pathlib import Path
keep={k:os.environ[k]for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH')if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*a,**k):raise RuntimeError('External connection disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.gallery',backend/'routes/gallery')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from models import Profile,RoleEnum,Gallery,GalleryItem,GalleryPurchase,CreditTransaction,Notification,XPTransaction,SurferPhotoSubscription,GlobalPricingConfig,LiveSession,LiveSessionParticipant
from routes.gallery import gallery_purchases as purchase
from routes.gallery.schemas import PurchaseRequest
from routes.subscriptions_billing import photo_sub_helpers as quota
async def noop(*a,**k):return None
purchase.check_badge_milestones=noop
original_quota=quota.try_use_subscription_quota

def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected asynchronous I/O {v}')
class Adapter:
 def __init__(self,s):self.s=s
 async def execute(self,*a,**k):return self.s.execute(*a,**k)
 def add(self,*a,**k):return self.s.add(*a,**k)
 async def commit(self):return self.s.commit()
 async def refresh(self,*a,**k):return self.s.refresh(*a,**k)
 async def flush(self):return self.s.flush()
 async def rollback(self):return self.s.rollback()

def run(name,expected,*,tier='premium',role=RoleEnum.PHOTOGRAPHER,price=9,override=None,included=False,covered=False,video=False):
 engine=create_engine('sqlite:///:memory:')
 for model in (Profile,Gallery,GalleryItem,GalleryPurchase,CreditTransaction,Notification,XPTransaction,SurferPhotoSubscription,GlobalPricingConfig,LiveSession,LiveSessionParticipant):model.__table__.create(engine)
 session=Session(engine,expire_on_commit=False);events=[]
 async def broadcast(**kw):events.append(kw)
 purchase.broadcast_earnings_update=broadcast
 async def quota_use(*a,**k):return {'used':True}
 quota.try_use_subscription_quota=quota_use if covered else original_quota
 try:
  session.add_all([Profile(id='buyer',user_id='buyer',email='buyer@example.invalid',full_name='Synthetic buyer',role=RoleEnum.SURFER,credit_balance=100),Profile(id='seller',user_id='seller',email='seller@example.invalid',full_name='Synthetic seller',role=role,subscription_tier=tier,credit_balance=0)])
  if override is not None:
   session.add(GlobalPricingConfig(id='old',pricing_data={},version=1,is_active=False,commission_rates={'tier_3':60}))
   session.add(GlobalPricingConfig(id='active',pricing_data={},version=2,is_active=True,commission_rates={'tier_3':override,'tier_2':20,'free':25}))
  if included:
   session.add(LiveSession(id='live',photographer_id='seller',photos_included=1,status='active'))
   session.add(Gallery(id='gallery',title='Synthetic gallery',photographer_id='seller',live_session_id='live'))
   session.add(LiveSessionParticipant(id='participant',photographer_id='seller',surfer_id='buyer',live_session_id='live',status='active'))
  session.add(GalleryItem(id='item',photographer_id='seller',gallery_id='gallery'if included else None,media_type='video'if video else'image',is_for_sale=True,original_url='synthetic-original',preview_url='synthetic-preview',price_web=price,price_720p=price))
  session.commit();db=Adapter(session)
  result=drive(purchase.purchase_gallery_item('item','buyer',PurchaseRequest(quality_tier='720p'if video else'web',payment_method='credits'),'buyer',db))
  paid=0 if included or covered else price
  with Session(engine)as read:
   saved=read.execute(select(GalleryPurchase)).scalar_one();buyer=read.get(Profile,'buyer');seller=read.get(Profile,'seller')
   sales=read.execute(select(CreditTransaction).where(CreditTransaction.user_id=='seller')).scalars().all()
   assert saved.amount_paid==result['amount_paid']==paid,(name,'paid',saved.amount_paid,paid)
   assert round(buyer.credit_balance,2)==round(100-paid,2),(name,'buyer',buyer.credit_balance)
   assert seller.credit_balance==expected,(name,'seller',seller.credit_balance,expected)
   assert seller.spend_only_credits==0,(name,'seller promo changed')
   assert sum(t.amount for t in sales)==expected,(name,'ledger share',sales)
   if expected:assert len(sales)==1 and sales[0].balance_before==0 and sales[0].balance_after==expected
   notification=read.execute(select(Notification).where(Notification.user_id=='seller')).scalar_one()
   assert f'You earned ${expected:.2f} credits' in notification.body,(name,'notice',notification.body)
   assert len(events)==1 and events[0]['amount']==expected,(name,'broadcast',events)
  print('PASS',name,'paid',paid,'seller/ledger/notice/broadcast',expected)
 finally:
  session.close();engine.dispose();quota.try_use_subscription_quota=original_quota
cases=[('Premium default85%',7.65,{}),('Basic default80%',7.2,{'tier':'basic'}),('Free Pro default75%',6.75,{'tier':'free'}),('Approved Pro premium85%',7.65,{'role':RoleEnum.APPROVED_PRO}),('Admin override12%',7.92,{'override':12}),('Admin zero commission',9,{'override':0}),('Non-Pro preserves80%',7.2,{'role':RoleEnum.HOBBYIST}),('Subscription covered no earning',0,{'covered':True}),('Session included no earning',0,{'included':True}),('Basic cent rounding',0.81,{'tier':'basic','price':1.01}),('Premium cent rounding',0.86,{'price':1.01}),('Premium video share',6.8,{'video':True,'price':8})]
failed=[]
for name,expected,kwargs in cases:
 try:run(name,expected,**kwargs)
 except Exception as e:failed.append(name);print('FAIL',name,type(e).__name__,str(e))
print(f'{len(cases)-len(failed)}/{len(cases)} single-item commission cases passed');raise SystemExit(bool(failed))
