"""Disposable signed-session ASGI fixture. No normal app startup or external calls.
Tokens and signing material are generated in memory, never retained as evidence.
"""
import os,sys,json,socket,types,uuid,asyncio
from pathlib import Path
from datetime import datetime,timedelta,timezone
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(TESTING='1',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',DATABASE_URL='sqlite+aiosqlite:///:memory:',SECRET_KEY=uuid.uuid4().hex)
sys.dont_write_bytecode=True
loop=asyncio.new_event_loop();asyncio.set_event_loop(loop)
root=Path(__file__).resolve().parents[4];backend=root/'backend';sys.path.insert(0,str(backend))
def blocked(*args,**kwargs):raise RuntimeError('External network disabled in disposable role fixture')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.subscriptions_billing',backend/'routes/subscriptions_billing'),('routes.commerce',backend/'routes/commerce')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from fastapi import FastAPI
import httpx,database
from sqlalchemy import select
from models import Profile,CreditTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription,PaymentTransaction,RoleEnum
from core.security import create_access_token
from routes.subscriptions_billing import photo_subscriptions as routes, subscriptions as billing, subscription_lifecycle as lifecycle
paid={};provider_reads=[];accounts={};scenarios={};requests=[]
def create(**kwargs):
 key='fictional_checkout_'+uuid.uuid4().hex
 paid[key]=types.SimpleNamespace(id=key,url='https://checkout.fixture.invalid/'+key,payment_status='paid',status='complete',currency='usd',metadata=kwargs['metadata'],amount_total=kwargs['line_items'][0]['price_data']['unit_amount'])
 return paid[key]
def retrieve(key):provider_reads.append(key);return paid[key]
routes.STRIPE_API_KEY=True;routes.stripe.checkout.Session.create=create;routes.stripe.checkout.Session.retrieve=retrieve
app=FastAPI();app.include_router(routes.router,prefix='/api')
async def setup():
 async with database.engine.begin() as conn:
  for cls in [Profile,CreditTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription,PaymentTransaction]:await conn.run_sync(cls.__table__.create)
 async with database.AsyncSessionLocal() as s:
  for name,role,tier,admin in [('photographer',RoleEnum.PHOTOGRAPHER,'basic',False),('approved_pro',RoleEnum.APPROVED_PRO,'premium',False),('admin',RoleEnum.SURFER,'basic',True)]:
   ident=str(uuid.uuid4());s.add(Profile(id=ident,user_id=ident,email=name+'@example.invalid',full_name='Fictional '+name,role=role,subscription_tier=tier,is_admin=admin,credit_balance=40,spend_only_credits=5,withdrawable_credits=35));accounts[name]=dict(id=ident,role=role.value,is_admin=admin,access_token=create_access_token({'sub':ident,'role':role.value}))
  await s.commit()
 return dict(accounts=accounts,transport='in-process ASGI; real JWT dependency; disposable async SQLite',normal_app_startup=False)
async def seed(label,premium=False):
 buyer=str(uuid.uuid4());seller=accounts['approved_pro' if premium else 'photographer']['id'];plan=str(uuid.uuid4());role=RoleEnum.COMP_SURFER if premium else RoleEnum.SURFER
 async with database.AsyncSessionLocal() as s:
  s.add(Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',full_name='Fictional '+label,role=role,credit_balance=100,spend_only_credits=10,withdrawable_credits=0))
  s.add(PhotographerSubscriptionPlan(id=plan,photographer_id=seller,name='Fictional '+label,interval='weekly',price=40 if premium else 20,photos_included=8,videos_included=2,live_session_buyins=1,sessions_included=1,booking_discount_pct=10,on_demand_discount_pct=5))
  await s.commit()
 account=dict(id=buyer,role=role.value,access_token=create_access_token({'sub':buyer,'role':role.value}))
 accounts[label]=account;scenarios[label]=dict(buyer=buyer,seller=seller,plan=plan,premium=premium)
 return dict(account=account,plan=plan)
async def snapshot(label):
 f=scenarios[label]
 async with database.AsyncSessionLocal() as s:
  subs=(await s.execute(select(SurferPhotoSubscription).where(SurferPhotoSubscription.surfer_id==f['buyer']))).scalars().all()
  receipts=(await s.execute(select(CreditTransaction).where(CreditTransaction.counterparty_id==f['buyer']))).scalars().all()
  txs=(await s.execute(select(PaymentTransaction).where(PaymentTransaction.user_id==f['buyer']))).scalars().all()
  seller=await s.get(Profile,f['seller']);buyer=await s.get(Profile,f['buyer'])
  return dict(subscriptions=[routes._sub_to_dict(x) for x in subs],earning_count=sum(x.transaction_type=='photo_subscription_earning' for x in receipts),earning_net=sum(float(x.amount) for x in receipts if x.transaction_type=='photo_subscription_earning'),transactions={x.session_id:[x.payment_status,x.status] for x in txs},seller_wallet=[seller.credit_balance,seller.spend_only_credits,seller.withdrawable_credits],buyer_wallet=[buyer.credit_balance,buyer.spend_only_credits],provider_reads=len(provider_reads),http_requests=len(requests))
async def mutate(label,action):
 f=scenarios[label]
 async with database.AsyncSessionLocal() as s:
  plan=await s.get(PhotographerSubscriptionPlan,f['plan'])
  if action=='edit_plan':plan.price=70;plan.photos_included=1;plan.interval='monthly';plan.booking_discount_pct=0
  elif action=='refund':
   sub=(await s.execute(select(SurferPhotoSubscription).where(SurferPhotoSubscription.surfer_id==f['buyer']))).scalar_one();sub.status='expired';sub.expires_at=datetime.now(timezone.utc)-timedelta(days=1)
   tx=(await s.execute(select(PaymentTransaction).where(PaymentTransaction.user_id==f['buyer']))).scalar_one();tx.payment_status='refunded';tx.status='refunded'
   receipt=(await s.execute(select(CreditTransaction).where(CreditTransaction.counterparty_id==f['buyer'],CreditTransaction.transaction_type=='photo_subscription_earning'))).scalar_one()
   seller=await s.get(Profile,f['seller']);seller.credit_balance-=receipt.amount;seller.withdrawable_credits-=receipt.amount
   s.add(CreditTransaction(user_id=seller.id,amount=-receipt.amount,balance_before=seller.credit_balance+receipt.amount,balance_after=seller.credit_balance,spend_only_amount=0,transaction_type='photo_subscription_refund',reference_type='photo_subscription',reference_id=sub.id,counterparty_id=f['buyer'],refund_of_transaction_id=receipt.id))
  elif action=='orphan_completed':
   tx=(await s.execute(select(PaymentTransaction).where(PaymentTransaction.user_id==f['buyer']))).scalar_one();tx.payment_status='completed';tx.status='completed'
  await s.commit()
 return dict(done=True)

app.include_router(billing.router,prefix='/api');app.include_router(lifecycle.router,prefix='/api')
billing.STRIPE_API_KEY=lifecycle.STRIPE_API_KEY=True
async def main():
 await setup()
 http_requests=0;results=[]
 async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture.invalid') as client:
  for tier,name,nullable in [('tier_2','basic',False),('tier_3','premium',False),('tier_2','basic',True)]:
   parent,child=[str(uuid.uuid4()) for _ in range(2)]
   async with database.AsyncSessionLocal() as s:
    s.add_all([Profile(id=parent,user_id=parent,email=parent+'@example.invalid',role=RoleEnum.SURFER if nullable else RoleEnum.GROM_PARENT,is_grom_parent=nullable,subscription_tier=None if nullable else 'premium',credit_balance=50,spend_only_credits=9,withdrawable_credits=41),Profile(id=child,user_id=child,email=child+'@example.invalid',full_name='Fictional child',role=RoleEnum.GROM,parent_id=parent,parent_link_approved=True,subscription_tier='free',is_ad_supported=True,credit_balance=4,spend_only_credits=1,withdrawable_credits=3)]);await s.commit()
   headers={'Authorization':'Bearer '+create_access_token({'sub':parent,'role':RoleEnum.SURFER.value if nullable else RoleEnum.GROM_PARENT.value})}
   response=await client.post('/api/subscriptions/grom-tier/'+parent,headers=headers,json={'grom_id':child,'tier_id':tier,'origin_url':'http://fixture.invalid'});http_requests+=1;assert response.status_code==200,response.status_code;key=response.json()['session_id']
   response=await client.get('/api/subscriptions/status/'+key,headers=headers);http_requests+=1;assert response.status_code==200,response.status_code;answer=response.json();assert answer['grom_id']==child and answer['current_tier']==name and answer['subscription_type']=='grom_subscription'
   async with database.AsyncSessionLocal() as s:
    payer=await s.get(Profile,parent);target=await s.get(Profile,child);assert (payer.subscription_tier,payer.credit_balance,payer.spend_only_credits,payer.withdrawable_credits)==((None if nullable else 'premium'),50,9,41);assert (target.subscription_tier,target.is_ad_supported,target.credit_balance,target.spend_only_credits,target.withdrawable_credits)==(name,False,4,1,3)
    target.subscription_tier='free';target.is_ad_supported=True;await s.commit()
   results.append(dict(case=name+' paid child fulfillment through ASGI',passed=True,parent_unchanged=True,child_only=True))
   reads=len(provider_reads);response=await client.get('/api/subscriptions/status/'+key,headers=headers);http_requests+=1;assert response.status_code==200 and response.json()['current_tier']=='free' and len(provider_reads)==reads
   results.append(dict(case=name+' replay after later free choice',passed=True,no_provider_read=True,no_tier_reapply=True))
 await database.engine.dispose()
 summary=dict(results=results,passed=len(results),total=6,signed_http_requests=http_requests,all_http_200=True,actual_jwt_dependency=True,actual_routes_and_async_sqlite=True,provider='in-memory Checkout double',external_calls=False,normal_app_startup=False,database_disposed=True)
 (Path(__file__).parent/'http_results.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print('6/6 ASGI cases;9 signed HTTP200; parent pockets preserved')
try:loop.run_until_complete(main())
finally:loop.close()
