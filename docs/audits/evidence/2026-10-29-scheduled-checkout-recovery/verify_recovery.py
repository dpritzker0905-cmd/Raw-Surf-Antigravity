"""Real async SQLite booking/participant/payment/credit tests, fake provider only."""
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
for name in ['routes','routes.bookings','routes.notifications']:
 m=types.ModuleType(name);m.__path__=[str(ROOT/'backend'/name.replace('.','/'))];sys.modules[name]=m
async def noop(*a,**k):return None
push=types.ModuleType('routes.notifications.push_payloads');push.notify_booking=noop;sys.modules[push.__name__]=push
legacy=types.ModuleType('stripe_mcp_server');legacy.DB_PATH='unused-fixture';sys.modules[legacy.__name__]=legacy
from fastapi import FastAPI
import httpx,database
from sqlalchemy import select,func,update,delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from models import Profile,RoleEnum,PaymentTransaction,Booking,BookingParticipant,CreditTransaction,Notification
from core.security import create_access_token
from routes.bookings import stripe_checkout as route
if '--baseline' in sys.argv:
 exec(compile((Path(__file__).parent/'baseline_stripe_checkout.py').read_text(encoding='utf-8'),'baseline_stripe_checkout.py','exec'),route.__dict__)
context={};provider={}
class FaultSession(AsyncSession):
 async def flush(self,*a,**k):
  if context.get('created') and context['mode'] in ['flush_fail','precommit_readback_fail']:raise IntegrityError('Fictional staging failure',{},Exception())
  return await super().flush(*a,**k)
 async def commit(self):
  mode=context['mode']
  if mode=='success':return await super().commit()
  if mode.startswith('ack_'):
   await super().commit()
   if mode=='ack_wallet':
    async with database.AsyncSessionLocal() as other:
     await other.execute(update(Profile).where(Profile.id==context['buyer']).values(credit_balance=Profile.credit_balance+4));await other.commit()
   if mode=='ack_ledger':
    async with database.AsyncSessionLocal() as other:
     await other.execute(update(CreditTransaction).where(CreditTransaction.user_id==context['buyer']).values(spend_only_amount=0));await other.commit()
   if mode=='ack_conflict':
    async with database.AsyncSessionLocal() as other:
     await other.execute(update(PaymentTransaction).where(PaymentTransaction.user_id==context['buyer']).values(amount=999));await other.commit()
   if mode=='ack_partial':
    async with database.AsyncSessionLocal() as other:
     await other.execute(delete(BookingParticipant).where(BookingParticipant.participant_id==context['buyer']));await other.commit()
   raise RuntimeError('Fictional acknowledgement lost')
  if mode in ['definite_fail','expire_fail','paid_race','already_expired','expiry_unknown']:raise IntegrityError('Fictional deferred constraint',{},Exception())
  raise RuntimeError('Fictional uncertain commit')
 async def rollback(self):
  if context['mode']=='rollback_fail':raise RuntimeError('Fictional unavailable rollback')
  return await super().rollback()
 async def execute(self,*a,**k):
  if context.get('readback') and context['mode'] in ['readback_fail','precommit_readback_fail']:raise RuntimeError('Fictional unavailable read')
  return await super().execute(*a,**k)
async def get_fault_db():
 async with FaultSession(bind=database.engine,expire_on_commit=False,autoflush=False) as session:yield session
app=FastAPI();app.dependency_overrides[database.get_db]=get_fault_db;app.include_router(route.router,prefix='/api');route.STRIPE_API_KEY=True
original_rollback=FaultSession.rollback
async def rollback_mark(self):
 result=await original_rollback(self);context['readback']=True;return result
FaultSession.rollback=rollback_mark

def create(**kwargs):
 if context['mode']=='provider_fail':raise RuntimeError('Fictional provider failure')
 key=context.get('retained_session') or 'fictional_booking_'+uuid.uuid4().hex;provider[key]=types.SimpleNamespace(id=key,url='https://fixture.invalid/'+key,status='open',payment_status='unpaid');context['created'].append(key);return provider[key]
def expire(key):
 context['expired'].append(key);mode=context['mode']
 if mode in ['expire_fail','paid_race','already_expired']:
  if mode=='paid_race':provider[key].status='complete';provider[key].payment_status='paid'
  if mode=='already_expired':provider[key].status='expired'
  raise RuntimeError('Fictional expiry unavailable')
 provider[key].status='unknown' if mode=='expiry_unknown' else 'expired';return provider[key]
route.stripe.checkout.Session.create=create;route.stripe.checkout.Session.expire=expire;route.stripe.checkout.Session.retrieve=lambda key:provider[key]
async def main():
 async with database.engine.begin() as conn:
  if fixture_url:
   tables={cls.__table__ for cls in [Profile,Booking,BookingParticipant,PaymentTransaction,CreditTransaction,Notification]}
   while True:
    expanded=tables|{fk.column.table for table in tables for fk in table.foreign_keys}
    if expanded==tables:break
    tables=expanded
   await conn.run_sync(lambda sync:database.Base.metadata.create_all(sync,tables=list(tables)))
  else:
   for cls in [Profile,Booking,BookingParticipant,PaymentTransaction,CreditTransaction,Notification]:await conn.run_sync(cls.__table__.create)
 results=[]
 async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
  for credits in [0,10]:
   for mode in ['success','ack_lost','definite_fail','unknown_commit','rollback_fail','readback_fail','ack_conflict','ack_partial','expire_fail','paid_race','already_expired','expiry_unknown','provider_fail','ack_wallet','ack_ledger','flush_fail','retained_session','precommit_readback_fail']:
    context.clear();context.update(mode=mode,created=[],expired=[],readback=False);buyer,seller=[str(uuid.uuid4()) for _ in range(2)];context['buyer']=buyer
    async with database.AsyncSessionLocal() as s:
     s.add_all([Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',full_name='Fictional Buyer',role=RoleEnum.SURFER,credit_balance=20,spend_only_credits=8,withdrawable_credits=0),Profile(id=seller,user_id=seller,email=seller+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Fictional Photographer',booking_hourly_rate=75,credit_balance=0,spend_only_credits=0,withdrawable_credits=0)])
     if mode=='retained_session':
      context['retained_session']='fictional_retained_'+uuid.uuid4().hex;context['retained_id']=str(uuid.uuid4());s.add(PaymentTransaction(id=context['retained_id'],user_id=seller,session_id=context['retained_session'],amount=1,currency='usd'))
     await s.commit()
    headers={'Authorization':'Bearer '+create_access_token({'sub':buyer,'role':RoleEnum.SURFER.value})}
    response=await client.post('/api/bookings/create-with-stripe',headers=headers,json=dict(photographer_id=seller,location='Fictional Beach',session_date='2030-06-10T12:00:00Z',duration=60,apply_credits=credits,origin_url='http://fixture.invalid'))
    expected=200 if mode in ['success','ack_lost','ack_wallet'] or (mode=='ack_ledger' and not credits) else 503 if mode in ['definite_fail','already_expired','flush_fail'] else 500 if mode=='provider_fail' else 409
    errors=[]
    if response.status_code!=expected:errors.append('status '+str(response.status_code)+' expected '+str(expected))
    if expected==409 and context['expired'] and mode not in ['expire_fail','paid_race','expiry_unknown']:errors.append('uncertain commit expired')
    if expected==200:
     if context['expired']:errors.append('durable checkout expired')
     if response.status_code==200:
      body=response.json()
      if (body['amount_to_charge'],body['credits_applied'],body['remaining_credits'])!=(75-credits,credits,20-credits):errors.append('wrong primitive receipt')
    async with database.AsyncSessionLocal() as s:
     payer=await s.get(Profile,buyer)
     if mode=='retained_session':
      retained=await s.get(PaymentTransaction,context['retained_id'])
      if retained is None or (retained.user_id,retained.session_id,retained.amount)!=(seller,context['retained_session'],1):errors.append('retained foreign receipt altered')
     durable=mode.startswith('ack_') or mode=='success'
     count=tuple([(await s.execute(select(func.count()).select_from(cls).where(getattr(cls,field)==buyer))).scalar_one() for cls,field in [(Booking,'creator_id'),(BookingParticipant,'participant_id'),(PaymentTransaction,'user_id'),(CreditTransaction,'user_id')]])
     wanted=(1,0 if mode=='ack_partial' else 1,1,int(credits>0)) if durable else (0,0,0,0)
     if count!=wanted:errors.append('rows '+str(count)+' expected '+str(wanted))
     if (payer.credit_balance,payer.spend_only_credits)!=((20-credits+(4 if mode=='ack_wallet' else 0),8-min(8,credits)) if durable else (20,8)):errors.append('wallet/provenance')
    if len(context['created'])!=(0 if mode=='provider_fail' else 1):errors.append('duplicate/missing provider creation')
    ok=not errors;results.append(dict(credits=credits,mode=mode,passed=ok,errors=errors,status=response.status_code));print(('PASS ' if ok else 'FAIL ')+str(credits)+'/'+mode+(' '+str(errors) if errors else ''),flush=True)
 await database.engine.dispose();print(json.dumps(dict(passed=sum(r['passed'] for r in results),total=len(results),results=results,database='disposable-loopback-PostgreSQL' if fixture_url else 'in-memory-async-SQLite',actual_jwt=True,external_calls=False,normal_startup=False,database_disposed=True),indent=2));return all(r['passed'] for r in results)
try:ok=loop.run_until_complete(main())
finally:loop.close()
raise SystemExit(0 if ok else 1)
