"""Actual valid-session ASGI + async SQLite recovery tests; provider calls doubled."""
import os,sys,uuid,asyncio,socket,types,json,logging
from pathlib import Path
loop=asyncio.new_event_loop();asyncio.set_event_loop(loop)
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ};os.environ.clear();os.environ.update(keep);os.environ.update(TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',SECRET_KEY=uuid.uuid4().hex);sys.dont_write_bytecode=True;logging.disable(logging.CRITICAL)
ROOT=Path(__file__).resolve().parents[4];sys.path.insert(0,str(ROOT/'backend'))
def blocked(*a,**k):raise RuntimeError('External network disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name in ['routes','routes.subscriptions_billing','routes.commerce']:
 m=types.ModuleType(name);m.__path__=[str(ROOT/'backend'/name.replace('.','/'))];sys.modules[name]=m
from fastapi import FastAPI
import httpx,database
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from models import Profile,RoleEnum,PaymentTransaction,GlobalPricingConfig,PhotographerSubscriptionPlan,SurferPhotoSubscription,CreditTransaction
from core.security import create_access_token
from routes.subscriptions_billing import subscriptions as general,subscription_lifecycle as lifecycle,photo_subscriptions as photo,credits,payments
context={};provider={};calls=[]
class FaultSession(AsyncSession):
 async def commit(self):
  if getattr(self,'failed',False) or context['mode']=='success':return await super().commit()
  self.failed=True
  if context['mode']=='ack_lost':await super().commit();raise RuntimeError('Fictional acknowledgement lost')
  if context['mode']=='unknown_commit':raise RuntimeError('Fictional uncertain commit')
  raise IntegrityError('Fictional deferred constraint',{},Exception())
async def get_fault_db():
 async with FaultSession(bind=database.engine,expire_on_commit=False) as session:yield session
app=FastAPI();app.dependency_overrides[database.get_db]=get_fault_db
for module in [general,lifecycle,photo,credits,payments]:app.include_router(module.router,prefix='/api');module.STRIPE_API_KEY=True
def create(**kwargs):
 key='fictional_http_'+uuid.uuid4().hex;provider[key]=types.SimpleNamespace(id=key,url='https://fixture.invalid/'+key,status='open',payment_status='unpaid',currency='usd',metadata=kwargs.get('metadata',{}),amount_total=kwargs['line_items'][0]['price_data']['unit_amount']);context['created'].append(key);return provider[key]
def expire(key):context['expired'].append(key);provider[key].status='expired';return provider[key]
general.stripe.checkout.Session.create=create;general.stripe.checkout.Session.expire=expire;general.stripe.checkout.Session.retrieve=lambda key:provider[key]
async def main():
 async with database.engine.begin() as conn:
  for cls in [Profile,PaymentTransaction,GlobalPricingConfig,PhotographerSubscriptionPlan,SurferPhotoSubscription,CreditTransaction]:await conn.run_sync(cls.__table__.create)
 results=[]
 async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture.invalid') as client:
  for path in ['general','account','grom','photo','credits','deposit']:
   for mode in ['success','definite_fail','ack_lost','unknown_commit']:
    context.clear();context.update(mode=mode,created=[],expired=[]);buyer,seller,child,plan=[str(uuid.uuid4()) for _ in range(4)]
    async with database.AsyncSessionLocal() as s:
     s.add_all([Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',role=RoleEnum.SURFER,is_grom_parent=True,subscription_tier='premium',credit_balance=50,spend_only_credits=9,withdrawable_credits=41),Profile(id=seller,user_id=seller,email=seller+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Fictional Photographer',subscription_tier='basic',credit_balance=40,spend_only_credits=5,withdrawable_credits=35),Profile(id=child,user_id=child,email=child+'@example.invalid',role=RoleEnum.GROM,parent_id=buyer,parent_link_approved=True,subscription_tier='free')]);await s.flush();s.add(PhotographerSubscriptionPlan(id=plan,photographer_id=seller,name='Fictional weekly',interval='weekly',price=20,photos_included=8));await s.commit()
    headers={'Authorization':'Bearer '+create_access_token({'sub':buyer,'role':RoleEnum.SURFER.value})}
    if path=='general':url='/api/subscriptions/checkout';data={'tier_id':'surfer_basic','origin_url':'http://fixture.invalid'}
    elif path=='account':url='/api/subscriptions/upgrade-tier/'+buyer;data={'tier_id':'tier_2','origin_url':'http://fixture.invalid'}
    elif path=='grom':url='/api/subscriptions/grom-tier/'+buyer;data={'grom_id':child,'tier_id':'tier_2','origin_url':'http://fixture.invalid'}
    elif path=='photo':url='/api/photo-subscriptions/subscribe?surfer_id='+buyer;data={'plan_id':plan,'payment_method':'card','origin_url':'http://fixture.invalid'}
    elif path=='credits':
     offer=await client.get('/api/credits/packages',headers=headers);assert offer.status_code==200;url='/api/credits/purchase';data={'amount':25,'offer_id':offer.json()['offer_id'],'origin_url':'http://fixture.invalid'}
    else:url='/api/payments/checkout';data={'package_id':'1hr','origin_url':'http://fixture.invalid','photographer_id':seller}
    response=await client.post(url,headers=headers,json=data);calls.append(dict(path=path,mode=mode,status=response.status_code));expected=200 if mode in ['success','ack_lost'] else 503 if mode=='definite_fail' else 409;assert response.status_code==expected,(path,mode,response.status_code,response.text[:160])
    if mode=='definite_fail':assert response.headers.get('X-Checkout-Recovery')=='closed' and len(context['expired'])==1
    elif mode=='unknown_commit':assert response.headers.get('X-Checkout-Recovery')=='review-required' and not context['expired']
    else:
     assert not context['expired'];assert response.json().get('checkout_url') or response.json().get('url')
     if path=='deposit':assert response.json()['photographer_name']=='Fictional Photographer'
    async with database.AsyncSessionLocal() as s:
     rows=(await s.execute(select(PaymentTransaction).where(PaymentTransaction.user_id==buyer))).scalars().all();assert len(rows)==(1 if expected==200 else 0)
     payer=await s.get(Profile,buyer);grom=await s.get(Profile,child);assert (payer.subscription_tier,payer.credit_balance,payer.spend_only_credits,payer.withdrawable_credits)==('premium',50,9,41) and grom.subscription_tier=='free'
    assert len(context['created'])==1,'Recovery created duplicate provider checkout'
    results.append(dict(path=path,mode=mode,passed=True,status=response.status_code));print('HTTP PASS '+path+'/'+mode,flush=True)
 await database.engine.dispose();summary=dict(results=results,passed=len(results),total=24,signed_creator_requests=len(calls),actual_jwt_dependency=True,actual_async_session=True,photographer_selected_deposit=True,external_calls=False,provider='in-memory Checkout double',normal_app_startup=False,database_disposed=True);(Path(__file__).parent/'http_results.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print('24/24 actual ASGI recovery cases')
try:loop.run_until_complete(main())
finally:loop.close()
