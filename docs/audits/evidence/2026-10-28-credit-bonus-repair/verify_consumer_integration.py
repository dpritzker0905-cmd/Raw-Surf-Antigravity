"""Current normal consumer handlers with real in-memory SQLite/accounting.
Synthetic route identities, no real authentication, HTTP, provider or concurrency.
Manually driven async functions use a synchronous adapter. Socket stubs are not OS egress isolation.
"""
import os,sys,socket,types
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
for name,folder in [('routes',backend/'routes'),('routes.subscriptions_billing',backend/'routes/subscriptions_billing'),('routes.commerce',backend/'routes/commerce'),('routes.gallery',backend/'routes/gallery')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from models import Profile,RoleEnum,CreditTransaction,AdConfig,Notification,Gallery,GalleryItem,GalleryPurchase,XPTransaction,SurferPhotoSubscription,GlobalPricingConfig
from routes.subscriptions_billing import subscriptions_credits
from routes.commerce import ad_controls,ad_analytics
from routes.gallery import gallery_purchases
from routes.gallery.schemas import PurchaseRequest
async def noop(*a,**k):return None
gallery_purchases.check_badge_milestones=noop;gallery_purchases.broadcast_earnings_update=noop
engine=create_engine('sqlite:///:memory:')
for model in (Profile,CreditTransaction,AdConfig,Notification,Gallery,GalleryItem,GalleryPurchase,XPTransaction,SurferPhotoSubscription,GlobalPricingConfig):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
 async def flush(self):return session.flush()
 async def rollback(self):return session.rollback()
db=Adapter()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected asynchronous I/O {v}')
def profile(uid,total,promo,role=RoleEnum.SURFER,tier='free'):
 row=Profile(id=uid,user_id=uid,email=uid+'@example.invalid',full_name='Synthetic '+uid,role=role,subscription_tier=tier,credit_balance=total,spend_only_credits=promo,withdrawable_credits=total-promo if role==RoleEnum.PHOTOGRAPHER else 0)
 session.add(row);session.commit();return row

def subscription_case():
 uid='subscription-consumer';profile(uid,10,3)
 result=drive(subscriptions_credits.pay_subscription_with_credits(uid,subscriptions_credits.CreditSubscriptionPaymentRequest(tier_id='tier_2'),uid,db))
 assert result['success'] and result['credits_used']==5
 with Session(engine) as read:
  user=read.get(Profile,uid);ledger=read.execute(select(CreditTransaction).where(CreditTransaction.user_id==uid)).scalar_one()
  assert user.credit_balance==5 and user.spend_only_credits==0 and user.subscription_tier=='basic'
  assert ledger.amount==-5 and ledger.spend_only_amount==-3 and ledger.balance_before==10 and ledger.balance_after==5
 print('PASS subscription handler: total10->5, promo3->0, signed ledger -5/-3')

def ad_case():
 uid='ad-consumer';profile(uid,15,5,RoleEnum.PHOTOGRAPHER)
 session.add(AdConfig(id='synthetic-ad-config',config_data={'variants':[]},is_active=True));session.commit()
 data=ad_controls.UserAdSubmission(headline='Synthetic promotion',description='Disposable ad',cta='Learn more',cta_link='http://fixture.invalid/learn',budget_credits=8)
 result=drive(ad_controls.submit_user_ad(data,uid,db));ad_id=result['ad_id']
 with Session(engine) as read:
  user=read.get(Profile,uid);debit=read.execute(select(CreditTransaction).where(CreditTransaction.reference_id==ad_id,CreditTransaction.amount<0)).scalar_one();debit_id=debit.id
  assert user.credit_balance==7 and user.spend_only_credits==0 and user.withdrawable_credits==7
  assert debit.amount==-8 and debit.spend_only_amount==-5
 cancelled=drive(ad_analytics.cancel_ad_submission(ad_id,uid,db));assert cancelled['success'] and cancelled['refund_amount']==8
 with Session(engine) as read:
  user=read.get(Profile,uid);refund=read.execute(select(CreditTransaction).where(CreditTransaction.refund_of_transaction_id==debit_id)).scalar_one()
  assert user.credit_balance==15 and user.spend_only_credits==5 and user.withdrawable_credits==10
  assert refund.amount==8 and refund.spend_only_amount==5 and refund.balance_before==7 and refund.balance_after==15
  cfg=read.get(AdConfig,'synthetic-ad-config');assert all(ad['id']!=ad_id for ad in cfg.config_data['variants'])
 print('PASS ad submit/cancel: total15->7->15, promo5->0->5; original debit-linked refund; cash restored10')

def gallery_case():
 uid='gallery-consumer';seller='gallery-seller';profile(uid,15,5);profile(seller,0,0,RoleEnum.PHOTOGRAPHER,tier='basic')
 session.add(GalleryItem(id='consumer-photo',photographer_id=seller,media_type='image',is_for_sale=True,original_url='fixture-original',preview_url='fixture-preview',price_web=9));session.commit()
 result=drive(gallery_purchases.purchase_gallery_item('consumer-photo',uid,PurchaseRequest(quality_tier='web',payment_method='credits'),uid,db));assert result['amount_paid']==9
 with Session(engine) as read:
  user=read.get(Profile,uid);creator=read.get(Profile,seller)
  debit=read.execute(select(CreditTransaction).where(CreditTransaction.user_id==uid)).scalar_one()
  purchase=read.execute(select(GalleryPurchase).where(GalleryPurchase.gallery_item_id=='consumer-photo')).scalar_one()
  assert user.credit_balance==6 and user.spend_only_credits==0
  assert debit.amount==-9 and debit.spend_only_amount==-5 and purchase.amount_paid==9
  assert creator.credit_balance==7.2
 print('PASS normal gallery purchase: total15->6, promo5->0, debit -9/-5, persisted purchase9')
failures=[]
try:
 for name,fn in [('subscription',subscription_case),('ad cancellation',ad_case),('gallery',gallery_case)]:
  try:fn()
  except Exception as error:session.rollback();failures.append(name);print('FAIL',name,type(error).__name__,str(error))
 print(f'{3-len(failures)}/3 normal consumer integration cases passed');raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
