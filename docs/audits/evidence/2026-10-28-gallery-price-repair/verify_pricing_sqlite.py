"""Actual ordinary locked-photo quote and purchase with real SQLite ORM and credit utilities.
Only external earnings push and badge side effects are suppressed. Identity is passed
as synthetic route input; this is not authentication, HTTP or PostgreSQL concurrency proof.
Sync DB adapter manually drives the actual async route; no server or event loop.
Python socket guards are not an OS firewall. No live provider, user or balance.
"""
import os, sys, socket, types
from pathlib import Path
from types import SimpleNamespace as NS
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
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
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from models import Profile, RoleEnum, Gallery, GalleryItem, GalleryPurchase, CreditTransaction, Notification, XPTransaction, SurferPhotoSubscription, GlobalPricingConfig
from routes.gallery import gallery_pricing, gallery_purchases
from routes.gallery.schemas import PurchaseRequest
async def noop(*a,**k):return None
gallery_purchases.check_badge_milestones=noop
gallery_purchases.broadcast_earnings_update=noop
engine=create_engine('sqlite:///:memory:')
for model in (Profile,Gallery,GalleryItem,GalleryPurchase,CreditTransaction,Notification,XPTransaction,SurferPhotoSubscription,GlobalPricingConfig):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
 async def flush(self):return session.flush()
 async def rollback(self):return session.rollback()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected asynchronous I/O {v}')
try:
 session.add_all([Profile(id='buyer',user_id='buyer',email='buyer@example.invalid',full_name='Synthetic buyer',role=RoleEnum.SURFER,credit_balance=100),Profile(id='seller',user_id='seller',email='seller@example.invalid',full_name='Synthetic photographer',role=RoleEnum.PHOTOGRAPHER,subscription_tier='basic',credit_balance=0),GalleryItem(id='item',photographer_id='seller',media_type='image',is_for_sale=True,original_url='synthetic-original',preview_url='synthetic-preview',price_web=9,locked_price_web=2)])
 session.commit();db=Adapter()
 quote=drive(gallery_pricing.get_gallery_item_pricing('item','buyer','buyer',db));web=next(t for t in quote['pricing']['tiers'] if t['tier']=='web')
 assert web['price']==2 and web['price_source']=='item_locked' and not web['is_purchased']
 response=drive(gallery_purchases.purchase_gallery_item('item','buyer',PurchaseRequest(quality_tier='web',payment_method='credits'),'buyer',db))
 session.close()
 with Session(engine) as readback:
  purchase=readback.execute(select(GalleryPurchase)).scalar_one()
  tx=readback.execute(select(CreditTransaction).order_by(CreditTransaction.amount)).scalars().all()
  buyer=readback.get(Profile,'buyer');seller=readback.get(Profile,'seller')
  assert response['amount_paid']==purchase.amount_paid==web['price']==2
  assert buyer.credit_balance==98 and seller.credit_balance==1.6
  assert len(tx)==2 and [(t.user_id,t.amount) for t in tx]==[('buyer',-2),('seller',1.6)]
  assert [(t.balance_before,t.balance_after) for t in tx]==[(100,98),(0,1.6)]
  print('PASS persisted SQLite purchase: quote/debit/amount_paid 2; buyer 98; seller 1.6; two reconciled credit rows')
finally:
 session.close();engine.dispose()
