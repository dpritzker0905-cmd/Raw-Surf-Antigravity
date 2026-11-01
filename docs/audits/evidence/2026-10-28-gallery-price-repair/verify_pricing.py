"""Actual quote/purchase routes with synthetic DB responses and credit/provider doubles.
No authentication, real balance, async database, provider, concurrency or live acceptance.
Socket guards are in-process, not an OS firewall. Run backend venv Python -B.
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
from models import GalleryItem,GalleryPurchase,Profile,LiveSession,LiveSessionParticipant,GlobalPricingConfig,RoleEnum
from routes.gallery import gallery_pricing as quotes, gallery_purchases as purchases
from routes.gallery.schemas import PurchaseRequest
import utils.credits as credits
from routes.subscriptions_billing import photo_sub_helpers as subs
async def noop(*a,**k):return None
purchases.check_badge_milestones=noop;purchases.broadcast_earnings_update=noop
async def quota_hint(*a,**k):return {'has_quota':False,'remaining':0,'subscription_active':False}
subs.check_quota_inline=quota_hint
class Result:
 def __init__(self,x):self.x=x
 def scalar_one_or_none(self):return self.x
 def scalar(self):return self.x
 def fetchall(self):return self.x
class DB:
 def __init__(self,item,member,session,count):self.item=item;self.member=member;self.session=session;self.count=count;self.added=[]
 async def execute(self,q):
  sql=str(q)
  if 'count(' in sql:return Result(self.count)
  entity=q.column_descriptions[0]['entity']
  if entity is GlobalPricingConfig:return Result(None)
  if entity is GalleryItem:return Result(self.item)
  if entity is GalleryPurchase:return Result([] if 'quality_tier' in str(q.selected_columns) else None)
  if entity is Profile:return Result(NS(id='buyer',full_name='Synthetic buyer',credit_balance=100))
  if entity is LiveSessionParticipant:return Result(self.member)
  if entity is LiveSession:return Result(self.session)
  raise AssertionError(str(q))
 def add(self,x):self.added.append(x)
 async def commit(self):pass
 def balance(self):return 100-self.charged
async def deduct(**kw):
 db=kw['db'];db.charged=kw['amount'];return True,100-kw['amount'],None
async def credit(**kw):return True,kw['amount'],None
credits.deduct_credits=deduct;credits.add_credits=credit
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected I/O {v}')
def run(name,expected,*,locked=None,gallery_price=None,member_prices=None,session_price=None,included=0,claimed=0,video=False,quota=False,tier=None):
 photog=NS(role=RoleEnum.PHOTOGRAPHER,subscription_tier='basic',photo_price_web=3,photo_price_standard=5,photo_price_high=10,video_price_720p=8,video_price_1080p=15,video_price_4k=30)
 gallery=NS(id='gallery',live_session_id='session' if session_price is not None or member_prices or included else None,price_web=gallery_price,price_standard=None,price_high=None)
 item=NS(id='item',photographer_id='photographer',photographer=photog,gallery_id='gallery',gallery=gallery,media_type='video' if video else 'image',is_for_sale=True,price_web=9 if gallery_price is None else None,price_standard=None,price_high=None,price_720p=12,price_1080p=None,price_4k=None,locked_price_web=locked,locked_price_standard=None,locked_price_high=None,url_web='synthetic-web',preview_url='synthetic-preview',url_standard=None,original_url='synthetic-original',url_720p=None,url_1080p=None,session_origin_mode=None,purchase_count=0,title='Synthetic item')
 member=NS(locked_price_web=member_prices,locked_price_standard=None,locked_price_high=None) if gallery.live_session_id else None
 session=NS(session_photo_price=session_price,photo_price=6,photos_included=included)
 db=DB(item,member,session,claimed);db.charged=0
 quota_calls=[]
 async def quota_use(*a,**k):
  quota_calls.append(True);return {'used':quota}
 subs.try_use_subscription_quota=quota_use
 tier=tier or ('720p' if video else 'web')
 quote=drive(quotes.get_gallery_item_pricing('item','buyer','buyer',db));price=next(t['price'] for t in quote['pricing']['tiers'] if t['tier']==tier)
 result=drive(purchases.purchase_gallery_item('item','buyer',PurchaseRequest(quality_tier=tier,payment_method='credits'),'buyer',db))
 assert quote['is_session_participant']==bool(gallery.live_session_id)
 assert quote['has_locked_pricing']==bool(member_prices or locked)
 assert all(t['is_purchased'] is False for t in quote['pricing']['tiers'])
 charged=0 if quota else expected
 assert price==expected,(name,'quote',price,expected)
 assert result['amount_paid']==charged,(name,'paid',result['amount_paid'],charged)
 assert len(quota_calls)==(0 if expected==0 else 1),(name,'quota calls',len(quota_calls))
 assert result['subscription_covered']==(quota and expected!=0),(name,'quota coverage',result)
 assert result['remaining_credits']==100-charged,(name,'balance',result)
 purchase=next(x for x in db.added if isinstance(x,GalleryPurchase));assert purchase.amount_paid==charged
 print('PASS',name,'quote',price,'paid',result['amount_paid'])
cases=[('item lock',2,dict(locked=2)),('gallery fallback',4,dict(gallery_price=4)),('participant lock',2.5,dict(member_prices=2.5)),('session override',6,dict(session_price=6)),('included allowance',0,dict(session_price=6,included=1)),('allowance exhausted',6,dict(session_price=6,included=1,claimed=1)),('general photo',9,{}),('video control',12,dict(video=True)),('subscription control',9,dict(quota=True)),('included preserves quota',0,dict(session_price=6,included=1,quota=True)),('photo standard control',5,dict(tier='standard')),('partial item lock high fallback',10,dict(locked=2,tier='high')),('video full HD control',15,dict(video=True,tier='1080p')),('video 4K control',30,dict(video=True,tier='4k')),('zero lock legacy fallback',9,dict(locked=0)),('item lock beats participant',2,dict(locked=2,member_prices=2.5))]
failed=[]
for name,expected,kwargs in cases:
 try:run(name,expected,**kwargs)
 except Exception as e:failed.append(name);print('FAIL',name,type(e).__name__,str(e))
print(f'{len(cases)-len(failed)}/{len(cases)} pricing cases passed');raise SystemExit(bool(failed))
