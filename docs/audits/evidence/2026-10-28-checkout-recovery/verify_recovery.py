"""Checkout recovery through six actual creator handlers; no app startup/external calls."""
import os,sys,socket,types,json,uuid,logging
from pathlib import Path
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ};os.environ.clear();os.environ.update(keep);os.environ.update(TESTING='1',PYTHON_DOTENV_DISABLED='1',DATABASE_URL='sqlite+aiosqlite:///:memory:',SECRET_KEY=uuid.uuid4().hex,PYDANTIC_DISABLE_PLUGINS='__all__');sys.dont_write_bytecode=True;logging.disable(logging.CRITICAL)
ROOT=Path(__file__).resolve().parents[4];sys.path.insert(0,str(ROOT/'backend'))
def blocked(*a,**k):raise RuntimeError('External network disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name in ['routes','routes.subscriptions_billing','routes.commerce']:
 m=types.ModuleType(name);m.__path__=[str(ROOT/'backend'/name.replace('.','/'))];sys.modules[name]=m
if '--baseline' in sys.argv:
 saved=json.loads((Path(__file__).parent/'baseline_sources.json').read_text(encoding='utf-8'))
 for name in ['subscriptions','subscription_lifecycle','photo_subscriptions','credits','payments']:
  key='routes.subscriptions_billing.'+name;m=types.ModuleType(key);m.__package__='routes.subscriptions_billing';sys.modules[key]=m;exec(compile(saved['backend/routes/subscriptions_billing/'+name+'.py'],key,'exec'),m.__dict__)
from routes.subscriptions_billing import subscriptions as general,subscription_lifecycle as lifecycle,photo_subscriptions as photo,credits,payments
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError,OperationalError,DataError
from fastapi import HTTPException
from starlette.requests import Request
from models import Profile,RoleEnum,PaymentTransaction,GlobalPricingConfig,PhotographerSubscriptionPlan,SurferPhotoSubscription,CreditTransaction
engine=create_engine('sqlite:///:memory:')
for model in [Profile,PaymentTransaction,GlobalPricingConfig,PhotographerSubscriptionPlan,SurferPhotoSubscription,CreditTransaction]:model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
context={};objects={};events=[]
class Adapter:
 def __init__(self,mode):self.mode=mode;self.failed=False
 async def execute(self,*a,**k):
  if self.failed and self.mode=='readback_fail' and 'payment_transactions' in str(a[0]):raise OperationalError('Fictional read unavailable',{},Exception())
  return session.execute(*a,**k)
 def add(self,obj):
  if self.mode=='add_fail':raise RuntimeError('Fictional local staging failure')
  session.add(obj)
 async def flush(self):session.flush()
 async def refresh(self,*a,**k):session.refresh(*a,**k)
 async def commit(self):
  events.append('commit')
  if self.mode=='success':session.commit();return
  if self.failed:session.commit();return
  self.failed=True
  if self.mode in ['ack_lost','quote_conflict']:
   if self.mode=='quote_conflict':
    for obj in session.new:
     if isinstance(obj,PaymentTransaction):obj.amount+=1
   session.commit();raise RuntimeError('Fictional acknowledgement lost')
  if self.mode in ['unknown_commit','readback_fail']:raise RuntimeError('Fictional uncertain commit')
  if self.mode=='data_fail':raise DataError('Fictional data rejection',{},Exception())
  raise IntegrityError('Fictional deferred constraint',{},Exception('Definite transaction rejection'))
 async def rollback(self):
  events.append('rollback')
  if self.mode=='rollback_fail':raise RuntimeError('Fictional rollback unavailable')
  session.rollback()
def drive(co):
 try:co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError('Unexpected asynchronous I/O')
def create(**kwargs):
 if context['mode']=='create_fail':raise general.stripe.error.StripeError('Fictional provider unavailable')
 key='fictional_recovery_'+uuid.uuid4().hex;obj=types.SimpleNamespace(id=key,url='https://checkout.fixture.invalid/'+key,status='open',payment_status='unpaid',currency='usd',amount_total=kwargs['line_items'][0]['price_data']['unit_amount'],metadata=kwargs.get('metadata',{}));objects[key]=obj;context['created'].append(key);return obj
def expire(key):
 events.append('expire');context['expired'].append(key);obj=objects[key]
 if context['mode']=='expiry_unknown_response':return obj
 if context['mode']=='expiry_fail':raise RuntimeError('Fictional expiry unavailable')
 if context['mode']=='paid_race':obj.status='complete';obj.payment_status='paid';raise RuntimeError('Fictional checkout completed')
 obj.status='expired'
 if context['mode']=='already_expired':raise RuntimeError('Fictional already-expired response')
 return obj
def retrieve(key):events.append('retrieve');return objects[key]
for module in [general,lifecycle,photo,credits,payments]:module.STRIPE_API_KEY=True
general.stripe.checkout.Session.create=create;general.stripe.checkout.Session.expire=expire;general.stripe.checkout.Session.retrieve=retrieve
paths=['general','account','grom','photo','credits','deposit']

def run(path,mode):
 session.rollback();events.clear();context.clear();context.update(mode=mode,created=[],expired=[])
 buyer,seller,child,plan=[str(uuid.uuid4()) for _ in range(4)]
 session.add_all([Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',role=RoleEnum.SURFER,is_grom_parent=True,subscription_tier='premium',credit_balance=50,spend_only_credits=9,withdrawable_credits=41),Profile(id=seller,user_id=seller,email=seller+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,full_name='Fictional Photographer',subscription_tier='basic',credit_balance=40,spend_only_credits=5,withdrawable_credits=35),Profile(id=child,user_id=child,email=child+'@example.invalid',full_name='Fictional Grom',role=RoleEnum.GROM,parent_id=buyer,parent_link_approved=True,subscription_tier='free')]);session.flush();session.add(PhotographerSubscriptionPlan(id=plan,photographer_id=seller,name='Fictional weekly',interval='weekly',price=20,photos_included=8));session.commit()
 db=Adapter(mode);response=None;error=None
 original_model=general.PaymentTransaction
 if mode=='prepare_fail':
  def broken_record(**kwargs):raise TypeError('Fictional record construction failure')
  general.PaymentTransaction=broken_record
 try:
  if path=='general':response=drive(general.create_subscription_checkout(general.SubscriptionCheckoutRequest(tier_id='surfer_basic',origin_url='http://fixture.invalid'),buyer,db))
  elif path=='account':response=drive(lifecycle.upgrade_subscription_tier(buyer,lifecycle.SubscriptionTierRequest(tier_id='tier_2',origin_url='http://fixture.invalid'),buyer,db))
  elif path=='grom':response=drive(lifecycle.update_grom_subscription(buyer,lifecycle.GromSubscriptionRequest(grom_id=child,tier_id='tier_2',origin_url='http://fixture.invalid'),buyer,db))
  elif path=='photo':response=drive(photo.subscribe_to_plan(photo.SubscribeRequest(plan_id=plan,payment_method='card',origin_url='http://fixture.invalid'),buyer,buyer,db))
  elif path=='credits':
   offer=drive(credits.get_credit_package_offer(db));response=drive(credits.purchase_credits(credits.CreditPurchaseRequest(amount=25,origin_url='http://fixture.invalid',offer_id=offer['offer_id']),buyer,db))
  elif path in ['deposit','deposit_named']:response=drive(payments.create_checkout_session(Request({'type':'http','scheme':'http','server':('fixture.invalid',80),'path':'/api/payments/checkout','headers':[]}),payments.CheckoutRequest(package_id='1hr',origin_url='http://fixture.invalid',photographer_id=seller if path=='deposit_named' else None),buyer,db))
 except Exception as exc:error=exc
 finally:general.PaymentTransaction=original_model
 try:
  with session.no_autoflush:rows=session.execute(select(PaymentTransaction).where(PaymentTransaction.user_id==buyer)).scalars().all()
  if mode in ['success','ack_lost']:
   assert error is None,'Valid durable checkout was not recovered: '+type(error).__name__;assert response is not None and len(rows)==1 and len(context['created'])==1 and not context['expired'],'Valid checkout lost or expired'
   if path=='deposit_named':assert response['photographer_name']=='Fictional Photographer','Expired profile used in response'
  elif mode=='create_fail':assert error is not None and not rows and not context['created'] and not context['expired'],'Provider-create failure staged a checkout'
  else:
   assert isinstance(error,HTTPException),'Expected controlled recovery response, got '+type(error).__name__
   outcome=(error.headers or {}).get('X-Checkout-Recovery')
   assert error.status_code==(503 if outcome=='closed' else 409),'Wrong retry/review HTTP contract'
   if mode in ['definite_fail','add_fail','already_expired','prepare_fail','data_fail']:
    assert outcome=='closed' and len(context['expired'])==1 and objects[context['created'][0]].status=='expired' and not rows,'Untracked open checkout not closed';assert events.index('rollback')<events.index('expire'),'Provider cleanup preceded local rollback'
   else:
    assert outcome=='review-required','Uncertain checkout falsely declared closed'
    if mode in ['unknown_commit','readback_fail','rollback_fail','quote_conflict']:assert not context['expired'],'Uncertain durable checkout blindly expired'
    if mode=='quote_conflict':assert len(rows)==1,'Conflicting retained row overwritten'
    elif mode!='rollback_fail':assert not rows,'Failed save left payment row'
   assert response is None,'Failed recovery leaked successful checkout URL'
  assert not session.execute(select(CreditTransaction).where(CreditTransaction.user_id==buyer)).scalars().all(),'Recovery granted wallet credits'
  p=session.get(Profile,buyer);g=session.get(Profile,child);assert (p.subscription_tier,p.credit_balance,p.spend_only_credits,p.withdrawable_credits)==('premium',50,9,41) and g.subscription_tier=='free','Recovery changed entitlements or wallet'
 finally:session.rollback()

cases=[(p,m) for p in paths for m in ['success','definite_fail','add_fail','ack_lost','unknown_commit','expiry_fail','paid_race','already_expired']]+[('general',m) for m in ['rollback_fail','readback_fail','quote_conflict','create_fail','prepare_fail','expiry_unknown_response','data_fail']]+[('deposit_named',m) for m in ['success','ack_lost']]
passed=0;results=[]
for path,mode in cases:
 try:run(path,mode);passed+=1;results.append(dict(path=path,mode=mode,passed=True));print('PASS '+path+'/'+mode)
 except Exception as error:session.rollback();results.append(dict(path=path,mode=mode,passed=False,error=type(error).__name__,reason=str(error)[:180]));print('FAIL '+path+'/'+mode+': '+type(error).__name__+' '+str(error)[:160])
print(f'{passed}/{len(cases)} checkout recovery cases');session.close();engine.dispose()
if '--json' in sys.argv:print(json.dumps(dict(passed=passed,total=len(cases),results=results)))
raise SystemExit(0 if passed==len(cases) else 1)
