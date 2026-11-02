"""Ordinary parent/Grom billing on disposable SQLite and Checkout doubles only."""
import os,sys,socket,types,json,uuid
from pathlib import Path
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ};os.environ.clear();os.environ.update(keep);os.environ.update(TESTING='1',PYTHON_DOTENV_DISABLED='1',DATABASE_URL='sqlite+aiosqlite:///:memory:',SECRET_KEY=uuid.uuid4().hex,PYDANTIC_DISABLE_PLUGINS='__all__');sys.dont_write_bytecode=True
root=Path(__file__).resolve().parents[4];sys.path.insert(0,str(root/'backend'))
def blocked(*a,**k):raise RuntimeError('External network disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name in ['routes','routes.subscriptions_billing','routes.commerce']:
 m=types.ModuleType(name);m.__path__=[str(root/'backend'/name.replace('.','/'))];sys.modules[name]=m
if '--baseline' in sys.argv:
 saved=json.loads((Path(__file__).parent/'baseline_sources.json').read_text(encoding='utf-8'))
 import utils
 module=types.ModuleType('utils.payment_fulfillment');module.__package__='utils';sys.modules[module.__name__]=module
 exec(compile(saved['backend/utils/payment_fulfillment.py'],module.__name__,'exec'),module.__dict__)
 for name in ['subscriptions','subscription_lifecycle']:
  key='routes.subscriptions_billing.'+name;m=types.ModuleType(key);m.__package__='routes.subscriptions_billing';sys.modules[key]=m;exec(compile(saved['backend/routes/subscriptions_billing/'+name+'.py'],key,'exec'),m.__dict__)
from routes.subscriptions_billing import subscriptions as billing,subscription_lifecycle as lifecycle
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from fastapi import HTTPException
from models import Profile,RoleEnum,PaymentTransaction,GlobalPricingConfig,CreditTransaction
engine=create_engine('sqlite:///:memory:')
for model in [Profile,PaymentTransaction,GlobalPricingConfig,CreditTransaction]:model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 fail=False
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):session.add(*a,**k)
 async def commit(self):
  if self.fail:self.fail=False;raise RuntimeError('Fictional commit failure')
  session.commit()
 async def rollback(self):session.rollback()
 async def flush(self):session.flush()
 async def refresh(self,*a,**k):session.refresh(*a,**k)
db=Adapter()
def drive(co):
 try:co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError('Unexpected asynchronous I/O')
provider={};reads=[]
def create(**kwargs):
 key='fictional_'+uuid.uuid4().hex;provider[key]=types.SimpleNamespace(id=key,url='https://fixture.invalid/'+key,metadata=kwargs['metadata'],payment_status='paid',amount_total=kwargs['line_items'][0]['price_data']['unit_amount'],currency='usd');return provider[key]
def retrieve(key):reads.append(key);return provider[key]
billing.stripe.checkout.Session.create=create;billing.stripe.checkout.Session.retrieve=retrieve;billing.STRIPE_API_KEY=lifecycle.STRIPE_API_KEY=True
cases=[]
def test(name,fn):cases.append((name,fn))
def seed(tier='tier_2',flag=False):
 n=uuid.uuid4().hex;parent=Profile(id=n,user_id=n,email=n+'@example.invalid',role=RoleEnum.SURFER if flag else RoleEnum.GROM_PARENT,is_grom_parent=flag,subscription_tier='premium',credit_balance=50,spend_only_credits=9,withdrawable_credits=41)
 child=Profile(id=n+'-g',user_id=n+'-g',email=n+'-g@example.invalid',full_name='Fictional Grom',role=RoleEnum.GROM,parent_id=n,parent_link_approved=True,subscription_tier='free',is_ad_supported=True,credit_balance=4,spend_only_credits=1,withdrawable_credits=3);session.add_all([parent,child]);session.commit()
 reply=drive(lifecycle.update_grom_subscription(parent.id,lifecycle.GromSubscriptionRequest(grom_id=child.id,tier_id=tier,origin_url='http://fixture.invalid'),parent.id,db));return parent,child,reply

def tx(key):return session.execute(select(PaymentTransaction).where(PaymentTransaction.session_id==key)).scalar_one()
def complete(key):return drive(billing.check_subscription_status(key,db))
def preserved(p,c):assert (p.subscription_tier,p.credit_balance,p.spend_only_credits,p.withdrawable_credits)==('premium',50,9,41),'Parent tier/wallet changed';assert (c.credit_balance,c.spend_only_credits,c.withdrawable_credits)==(4,1,3),'Child wallet changed'
for tier,name in [('tier_2','basic'),('tier_3','premium')]:
 def paid(tier=tier,name=name):
  p,c,r=seed(tier);answer=complete(r['session_id']);preserved(p,c);assert c.subscription_tier==name and c.is_ad_supported is False,'Grom entitlement not applied';assert answer.get('grom_id')==c.id and answer.get('current_tier')==name and answer.get('subscription_type')=='grom_subscription','Missing child-specific completion';assert tx(r['session_id']).payment_status=='completed'
 test('Paid '+name+' targets Grom, preserves parent and pockets',paid)
def flagged():
 p,c,r=seed(flag=True);complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='basic'
test('Eligible flagged parent ordinary purchase',flagged)
def receipt():
 p,c,r=seed();d=json.loads(tx(r['session_id']).transaction_metadata);f=d.get('receipt',{});assert f.get('version')==1 and f.get('parent_id')==p.id and f.get('grom_id')==c.id and f.get('tier_name')=='basic' and f.get('amount_cents')==300 and f.get('currency')=='usd','No frozen child receipt'
test('New checkout freezes payer child tier amount receipt',receipt)
def replay():
 p,c,r=seed();complete(r['session_id']);p.subscription_tier='premium';c.subscription_tier='premium';session.commit();before=len(reads);answer=complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='premium' and answer.get('current_tier')=='premium' and len(reads)==before,'Replay reapplied old tier/provider request'
test('Completed replay reports current child tier without reapplying',replay)
def legacy():
 p,c,r=seed();row=tx(r['session_id']);d=json.loads(row.transaction_metadata);d.pop('receipt',None);row.transaction_metadata=json.dumps(d);session.commit();complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='basic'
test('Legacy explicit child metadata and exact provider receipt',legacy)
def pending():
 p,c,r=seed();provider[r['session_id']].payment_status='unpaid';a=complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='free' and a['status']=='unpaid' and tx(r['session_id']).payment_status=='pending'
test('Unpaid checkout grants nothing',pending)
def refund():
 p,c,r=seed();row=tx(r['session_id']);row.payment_status='refunded';row.status='refunded';session.commit();before=len(reads);answer=complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='free' and row.payment_status=='refunded' and len(reads)==before and answer['status']=='refunded'
test('Recorded refund cannot fulfill or contact provider',refund)
def amount():
 p,c,r=seed();provider[r['session_id']].amount_total=301
 try:complete(r['session_id']);raise AssertionError('Conflicting paid amount fulfilled')
 except HTTPException as error:assert error.status_code==409
 preserved(p,c);assert c.subscription_tier=='free' and tx(r['session_id']).payment_status=='pending'
test('Conflicting historical payment amount needs reconciliation',amount)
def rollback():
 p,c,r=seed();db.fail=True
 try:complete(r['session_id']);raise AssertionError('Injected failure not raised')
 except RuntimeError:pass
 preserved(p,c);assert c.subscription_tier=='free' and tx(r['session_id']).payment_status=='pending','Failed commit was not rolled back';complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='basic'
test('Commit failure rolls back child and receipt; retry once',rollback)
def edited_price():
 p,c,r=seed();old=billing.GROM_SUBSCRIPTION_TIERS['tier_2']['price'];billing.GROM_SUBSCRIPTION_TIERS['tier_2']['price']=9
 try:complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='basic'
 finally:billing.GROM_SUBSCRIPTION_TIERS['tier_2']['price']=old
test('Later configured price does not change frozen paid receipt',edited_price)
def free():
 p,c,r=seed('tier_1');preserved(p,c);assert c.subscription_tier=='free' and c.is_ad_supported and not r['checkout_url']
test('Existing free child plan path stays local and preserves parent',free)

def null_receipt():
 p,c,r=seed();row=tx(r['session_id']);d=json.loads(row.transaction_metadata);d['receipt']=None;row.transaction_metadata=json.dumps(d);session.commit()
 try:complete(r['session_id']);raise AssertionError('Explicit incomplete receipt treated as legacy')
 except HTTPException as error:assert error.status_code==409
 preserved(p,c);assert c.subscription_tier=='free'
test('Explicit incomplete frozen receipt stays unreconciled',null_receipt)
def currency():
 p,c,r=seed();provider[r['session_id']].currency='eur'
 try:complete(r['session_id']);raise AssertionError('Conflicting receipt currency fulfilled')
 except HTTPException as error:assert error.status_code==409
 preserved(p,c);assert c.subscription_tier=='free'
test('Conflicting provider currency does not grant',currency)
def old_completed():
 p,c,r=seed();row=tx(r['session_id']);row.payment_status='completed';row.status='completed';p.subscription_tier='basic';session.commit();before=len(reads);answer=complete(r['session_id']);assert p.subscription_tier=='basic' and c.subscription_tier=='free' and answer.get('current_tier')=='free' and len(reads)==before,'Historical completion silently backfilled'
test('Historical completed receipt does not silently repair old balances or tiers',old_completed)
def provider_failure():
 p,c,r=seed();original=billing.stripe.checkout.Session.retrieve
 def unavailable(key):raise billing.stripe.error.StripeError('Fictional provider unavailable')
 billing.stripe.checkout.Session.retrieve=unavailable
 try:
  try:complete(r['session_id']);raise AssertionError('Provider failure fulfilled')
  except HTTPException as error:assert error.status_code==502
  preserved(p,c);assert c.subscription_tier=='free' and tx(r['session_id']).payment_status=='pending'
 finally:billing.stripe.checkout.Session.retrieve=original
test('Provider failure leaves recipient and receipt unchanged',provider_failure)

def no_parent_plan():
 p,c,r=seed(flag=True);p.subscription_tier=None;session.commit();answer=complete(r['session_id']);assert p.subscription_tier is None and (p.credit_balance,p.spend_only_credits,p.withdrawable_credits)==(50,9,41) and c.subscription_tier=='basic' and answer['current_tier']=='basic'
test('Eligible parent without own plan funds child without selecting parent tier',no_parent_plan)

def wallet_route():
 from utils.payment_fulfillment import fulfill_wallet_payment
 p,c,r=seed();row=tx(r['session_id']);result=drive(fulfill_wallet_payment(db,row));assert result==(0.0,None) and row.payment_status=='pending' and c.subscription_tier=='free';preserved(p,c);complete(r['session_id']);preserved(p,c);assert c.subscription_tier=='basic'
test('Generic wallet callback defers Grom receipt without funding parent',wallet_route)
passed=0
for name,fn in cases:
 try:fn();passed+=1;print('PASS '+name)
 except Exception as error:session.rollback();print('FAIL '+name+': '+type(error).__name__+' '+str(error)[:200])
print(f'{passed}/{len(cases)} Grom card cases');session.close();engine.dispose();raise SystemExit(0 if passed==len(cases) else 1)
