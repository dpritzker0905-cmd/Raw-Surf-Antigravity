"""Actual dispatch route/AsyncSession fixture, fake provider, no normal startup."""
import os,sys,uuid,asyncio,socket,types,json,logging
from urllib.parse import urlsplit
from pathlib import Path
loop=asyncio.new_event_loop();asyncio.set_event_loop(loop)
fixture_url=os.environ.get('CHECKOUT_FIXTURE_DATABASE_URL') if '--pg' in sys.argv else None
if fixture_url:
 parsed=urlsplit(fixture_url);assert parsed.hostname=='127.0.0.1' and parsed.scheme in ['postgresql+asyncpg','postgresql'], 'Only an owned loopback fixture is accepted'
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep);os.environ.update(TESTING='1',DATABASE_URL=fixture_url or 'sqlite+aiosqlite:///:memory:',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',SECRET_KEY=uuid.uuid4().hex)
sys.dont_write_bytecode=True;logging.disable(logging.CRITICAL)
ROOT=Path(__file__).resolve().parents[4];sys.path.insert(0,str(ROOT/'backend'))
def blocked(*a,**k):raise RuntimeError('External network disabled')
original_connect=socket.socket.connect
def fixture_connect(self,address):
 if fixture_url and address[0]=='127.0.0.1' and address[1]==parsed.port:return original_connect(self,address)
 return blocked()
socket.socket.connect=fixture_connect;socket.socket.connect_ex=socket.create_connection=blocked
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name in ['routes','routes.dispatch']:
 m=types.ModuleType(name);m.__path__=[str(ROOT/'backend'/name.replace('.','/'))];sys.modules[name]=m
async def noop(*a,**k):return None
alerts=types.ModuleType('utils.parental_alerts');alerts.check_and_send_spending_alert=noop;sys.modules[alerts.__name__]=alerts
onesignal=types.ModuleType('services.onesignal_service');onesignal.onesignal_service=types.SimpleNamespace();sys.modules[onesignal.__name__]=onesignal
matching=types.ModuleType('routes.dispatch.dispatch_matching')
for name in ['dispatch_payment_success','process_dispatch_notifications','notify_crew_members']:setattr(matching,name,noop)
sys.modules[matching.__name__]=matching
from fastapi import FastAPI
import httpx,database
from sqlalchemy import select,func,update,delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from models import Profile,RoleEnum,PaymentTransaction,DispatchRequest,DispatchRequestParticipant,DispatchRequestStatusEnum,CreditTransaction
from core.security import create_access_token
from routes.dispatch import sessions as route
if '--baseline' in sys.argv:
 exec(compile((Path(__file__).parent/'baseline_sessions.py').read_text(encoding='utf-8-sig'),'baseline_sessions.py','exec'),route.__dict__)
context={};provider={}
class FaultSession(AsyncSession):
 async def flush(self,*a,**k):
  if context.get('created') and context['mode'] in ['flush_fail','precommit_readback_fail']:raise IntegrityError('Fictional staging failure',{},Exception())
  return await super().flush(*a,**k)
 def add(self,*a,**k):
  if context.get('created') and context['mode']=='add_fail':raise ValueError('Fictional staging failure')
  return super().add(*a,**k)
 async def commit(self):
  mode=context['mode']
  if mode=='success' or mode=='retained_session':return await super().commit()
  if mode.startswith('ack_'):
   await super().commit()
   async with database.AsyncSessionLocal() as other:
    if mode=='ack_wallet':await other.execute(update(Profile).where(Profile.id==context['buyer']).values(credit_balance=Profile.credit_balance+4))
    if mode=='ack_conflict':await other.execute(update(PaymentTransaction).where(PaymentTransaction.user_id==context['buyer']).values(amount=999))
    if mode=='ack_dispatch':await other.execute(update(DispatchRequest).where(DispatchRequest.id==context['dispatch']).values(stripe_checkout_session_id='fictional_another_session'))
    if mode=='ack_partial':await other.execute(delete(PaymentTransaction).where(PaymentTransaction.user_id==context['buyer']))
    await other.commit()
   raise RuntimeError('Fictional acknowledgement lost')
  if mode in ['definite_fail','expire_fail','paid_race','already_expired','expiry_unknown','retained_dispatch','definite_changed','definite_missing']:raise IntegrityError('Fictional deferred constraint',{},Exception())
  raise RuntimeError('Fictional uncertain commit')
 async def rollback(self):
  if context['mode']=='rollback_fail':raise RuntimeError('Fictional unavailable rollback')
  result=await super().rollback();context['readback']=True
  if context['mode'] in ['definite_changed','definite_missing'] and not context.get('other_changed'):
   context['other_changed']=True
   async with database.AsyncSessionLocal() as other:
    if context['mode']=='definite_changed':await other.execute(update(DispatchRequest).where(DispatchRequest.id==context['dispatch']).values(location_name='Changed independently'))
    else:await other.execute(delete(DispatchRequest).where(DispatchRequest.id==context['dispatch']))
    await other.commit()
  return result
 async def execute(self,*a,**k):
  if context.get('readback') and context['mode'] in ['readback_fail','precommit_readback_fail']:raise RuntimeError('Fictional unavailable read')
  return await super().execute(*a,**k)
async def get_fault_db():
 async with FaultSession(bind=database.engine,expire_on_commit=False,autoflush=False) as session:yield session
app=FastAPI();app.dependency_overrides[database.get_db]=get_fault_db;app.include_router(route.router,prefix='/api');route.stripe.api_key=True

def create(**kwargs):
 if context['mode']=='provider_fail':raise route.stripe.error.StripeError('Fictional provider failure')
 key=context.get('retained_session') or 'fictional_dispatch_'+uuid.uuid4().hex;provider[key]=types.SimpleNamespace(id=key,url='https://fixture.invalid/'+key,status='open',payment_status='unpaid');context['created'].append(key);context['provider_quote']=kwargs;return provider[key]
def expire(key):
 context['expired'].append(key);mode=context['mode']
 if mode in ['expire_fail','paid_race','already_expired']:
  if mode=='paid_race':provider[key].status='complete';provider[key].payment_status='paid'
  if mode=='already_expired':provider[key].status='expired'
  raise RuntimeError('Fictional expiry unavailable')
 provider[key].status='unknown' if mode=='expiry_unknown' else 'expired';return provider[key]
route.stripe.checkout.Session.create=create;route.stripe.checkout.Session.expire=expire;route.stripe.checkout.Session.retrieve=lambda key:provider[key]
original_payment=route.PaymentTransaction
def build_payment(**kwargs):
 if context['mode']=='factory_fail':raise TypeError('Fictional constructor failure')
 return original_payment(**kwargs)
route.PaymentTransaction=build_payment
async def main():
 async with database.engine.begin() as conn:
  models=[Profile,DispatchRequest,DispatchRequestParticipant,PaymentTransaction,CreditTransaction]
  if fixture_url:
   tables={cls.__table__ for cls in models}
   while True:
    expanded=tables|{fk.column.table for table in tables for fk in table.foreign_keys}
    if expanded==tables:break
    tables=expanded
   await conn.run_sync(lambda sync:database.Base.metadata.create_all(sync,tables=list(tables)))
  else:
   for cls in models:await conn.run_sync(cls.__table__.create)
 results=[]
 async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
  for shared,prior_link in [(shared,prior_link) for shared in [False,True] for prior_link in [False,True]]:
   for mode in ['success','ack_lost','definite_fail','unknown_commit','rollback_fail','readback_fail','ack_conflict','ack_dispatch','ack_partial','ack_wallet','flush_fail','precommit_readback_fail','retained_session','retained_dispatch','expire_fail','paid_race','already_expired','expiry_unknown','provider_fail','add_fail','factory_fail','definite_changed','definite_missing']:
    context.clear();context.update(mode=mode,created=[],expired=[],readback=False);buyer,seller,dispatch_id,participant_id=[str(uuid.uuid4()) for _ in range(4)];context.update(buyer=buyer,dispatch=dispatch_id)
    old_link='fictional_old_'+uuid.uuid4().hex if prior_link else None;amount=12.5 if shared else 30.25
    async with database.AsyncSessionLocal() as s:
     s.add_all([Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',full_name='Fictional Buyer',role=RoleEnum.SURFER,credit_balance=20,spend_only_credits=8,withdrawable_credits=0),Profile(id=seller,user_id=seller,email=seller+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Fictional Photographer',credit_balance=0,spend_only_credits=0,withdrawable_credits=0)]);await s.flush()
     dispatch=DispatchRequest(id=dispatch_id,requester_id=buyer,target_photographer_id=seller if shared else None,latitude=0,longitude=0,location_name='Fictional Beach',hourly_rate=121,estimated_duration_hours=1,estimated_total=121,deposit_amount=30.25,captain_share_amount=12.5 if shared else None,is_shared=shared,stripe_checkout_session_id=old_link,status=DispatchRequestStatusEnum.PENDING_PAYMENT);s.add(dispatch);await s.flush()
     s.add(DispatchRequestParticipant(id=participant_id,dispatch_request_id=dispatch_id,participant_id=seller,share_amount=17.75,paid=False,status='invited'))
     if mode in ['retained_session','retained_dispatch']:
      context['retained_session']='fictional_retained_'+uuid.uuid4().hex;context['retained_id']=str(uuid.uuid4())
      if mode=='retained_session':s.add(PaymentTransaction(id=context['retained_id'],user_id=seller,session_id=context['retained_session'],amount=1,currency='usd'))
      else:s.add(DispatchRequest(id=context['retained_id'],requester_id=seller,latitude=0,longitude=0,hourly_rate=1,estimated_total=1,deposit_amount=1,stripe_checkout_session_id=context['retained_session']))
     await s.commit()
    headers={'Authorization':'Bearer '+create_access_token({'sub':buyer,'role':RoleEnum.SURFER.value})}
    response=await client.post('/api/dispatch/checkout',headers=headers,json=dict(dispatch_id=dispatch_id,payer_id=buyer,amount=999,origin_url='http://fixture.invalid'))
    expected=200 if mode in ['success','ack_lost','ack_wallet'] else 503 if mode in ['definite_fail','already_expired','flush_fail','add_fail','factory_fail'] else 500 if mode=='provider_fail' else 409
    errors=[]
    if response.status_code!=expected:errors.append('status '+str(response.status_code)+' expected '+str(expected))
    if expected==409 and context['expired'] and mode not in ['expire_fail','paid_race','expiry_unknown']:errors.append('uncertain/reference checkout expired')
    if expected==503 and len(context['expired'])!=1:errors.append('failed untracked checkout not closed')
    if expected in [409,503] and response.status_code==expected and response.headers.get('X-Checkout-Recovery')!=('closed' if expected==503 else 'review-required'):errors.append('recovery header')
    if response.status_code==200:
     if context['expired']:errors.append('durable checkout expired')
     body=response.json()
     if (body['dispatch_id'],body['amount'])!=(dispatch_id,amount) or not body.get('checkout_url'):errors.append('wrong primitive receipt')
    if mode!='provider_fail' and context['provider_quote']['line_items'][0]['price_data']['unit_amount']!=int(round(amount*100)):errors.append('quote not from captain terms')
    async with database.AsyncSessionLocal() as s:
     payer=await s.get(Profile,buyer);retained_dispatch=await s.get(DispatchRequest,dispatch_id);participant=await s.get(DispatchRequestParticipant,participant_id)
     durable=mode.startswith('ack_') or mode=='success';rows=(await s.execute(select(PaymentTransaction).where(PaymentTransaction.user_id==buyer))).scalars().all();wanted=0 if mode=='ack_partial' else int(durable)
     if len(rows)!=wanted:errors.append('payment row count '+str(len(rows))+' expected '+str(wanted))
     desired_link=('fictional_another_session' if mode=='ack_dispatch' else context['created'][0]) if durable else old_link
     if mode=='definite_missing':
      if retained_dispatch is not None:errors.append('missing dispatch recreated')
     else:
      if retained_dispatch.stripe_checkout_session_id!=desired_link:errors.append('dispatch link changed/lost')
      if retained_dispatch.status!=DispatchRequestStatusEnum.PENDING_PAYMENT or retained_dispatch.deposit_paid:errors.append('checkout granted dispatch entitlement')
      if mode=='definite_changed' and retained_dispatch.location_name!='Changed independently':errors.append('independent dispatch change overwritten')
     if (payer.credit_balance,payer.spend_only_credits,payer.withdrawable_credits)!=(24 if mode=='ack_wallet' else 20,8,0):errors.append('wallet/provenance')
     if mode!='definite_missing' and (participant is None or participant.paid or participant.status!='invited'):errors.append('crew changed')
     ledger_count=(await s.execute(select(func.count()).select_from(CreditTransaction).where(CreditTransaction.user_id==buyer))).scalar_one()
     if ledger_count:errors.append('checkout wrote wallet ledger')
     if mode=='retained_session':
      retained=await s.get(PaymentTransaction,context['retained_id'])
      if retained is None or (retained.user_id,retained.session_id,retained.amount)!=(seller,context['retained_session'],1):errors.append('retained receipt altered')
     if mode=='retained_dispatch':
      retained=await s.get(DispatchRequest,context['retained_id'])
      if retained is None or retained.stripe_checkout_session_id!=context['retained_session']:errors.append('retained foreign dispatch altered')
    if len(context['created'])!=(0 if mode=='provider_fail' else 1):errors.append('duplicate/missing provider creation')
    ok=not errors;results.append(dict(shared=shared,prior_link=prior_link,mode=mode,passed=ok,errors=errors,status=response.status_code));print(('PASS ' if ok else 'FAIL ')+str(shared)+'/'+str(prior_link)+'/'+mode+(' '+str(errors) if errors else ''),flush=True)
 await database.engine.dispose();print(json.dumps(dict(passed=sum(r['passed'] for r in results),total=len(results),results=results,database='disposable-loopback-PostgreSQL' if fixture_url else 'in-memory-async-SQLite',actual_jwt=True,external_calls=False,normal_startup=False,database_disposed=True),indent=2));return all(r['passed'] for r in results)
try:ok=loop.run_until_complete(main())
finally:loop.close()
raise SystemExit(0 if ok else 1)
