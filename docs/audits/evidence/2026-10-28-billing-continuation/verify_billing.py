"""Read-only app preparation: ordinary billing flows on disposable SQLite/provider doubles."""
import os,sys,socket,types,json,re
from datetime import datetime,timezone,timedelta
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
for name,folder in [('routes',backend/'routes'),('routes.subscriptions_billing',backend/'routes/subscriptions_billing'),('routes.commerce',backend/'routes/commerce')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from models import Profile,RoleEnum,PaymentTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription,GlobalPricingConfig,CreditTransaction
from routes.subscriptions_billing import subscriptions as billing,subscription_lifecycle as lifecycle,photo_subscriptions as photo,photo_sub_helpers as helpers
engine=create_engine('sqlite:///:memory:')
for model in (Profile,PaymentTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription,GlobalPricingConfig,CreditTransaction):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):session.add(*a,**k)
 async def flush(self):session.flush()
 async def commit(self):session.commit()
 async def rollback(self):session.rollback()
 async def refresh(self,*a,**k):session.refresh(*a,**k)
db=Adapter()
def drive(co):
 try:co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError('Unexpected asynchronous I/O')
requests=[];objects={}
def create(**kw):
 requests.append(kw);sid='cs_fixture_billing_'+str(len(requests));obj=types.SimpleNamespace(id=sid,url='https://fixture.invalid/'+sid,payment_status='paid',metadata=kw['metadata'],amount_total=kw['line_items'][0]['price_data']['unit_amount']);objects[sid]=obj;return obj
billing.stripe.checkout.Session.create=create;billing.stripe.checkout.Session.retrieve=lambda sid:objects[sid]
billing.STRIPE_API_KEY=lifecycle.STRIPE_API_KEY='synthetic-configured'
session.add_all([Profile(id='buyer',user_id='buyer',email='buyer@example.invalid',full_name='Fixture Buyer',role=RoleEnum.SURFER,credit_balance=20,spend_only_credits=8,subscription_tier='free'),Profile(id='seller',user_id='seller',email='seller@example.invalid',full_name='Fixture Photographer',role=RoleEnum.PHOTOGRAPHER,subscription_tier='basic')]);session.commit()

from copy import deepcopy
from routes.commerce.pricing_config import DEFAULT_PRICING_DATA
cases=[]
def test(name,fn):cases.append((name,fn))
def reset():
 session.rollback();session.execute(GlobalPricingConfig.__table__.delete());session.commit();billing.STRIPE_API_KEY=lifecycle.STRIPE_API_KEY='synthetic-configured'
 buyer=session.get(Profile,'buyer');buyer.subscription_tier='free';buyer.credit_balance=20;buyer.spend_only_credits=8;session.commit()
def balance():
 with Session(engine) as read:
  row=read.get(Profile,'buyer');return row.subscription_tier,row.credit_balance,row.spend_only_credits
for role,prefix,monthly in [('surfer','surfer',(5,10)),('photographer','photographer',(18,30)),('approved_pro_photographer','approved_pro',(25,50))]:
 for tier_index,tier_name in enumerate(('basic','premium')):
  for period,multiplier in [('monthly',1),('annual',9.6)]:
   def case(role=role,prefix=prefix,monthly=monthly,tier_index=tier_index,tier_name=tier_name,period=period,multiplier=multiplier):
    reset();plan_id=prefix+'_'+tier_name+('_annual' if period=='annual' else '')
    plans=drive(billing.get_subscription_plans(db));advertised=next(row for row in plans[role][period] if row['id']==plan_id)
    result=drive(billing.create_subscription_checkout(billing.SubscriptionCheckoutRequest(tier_id=plan_id,origin_url='https://fixture.invalid'),'buyer',db))
    expected=round(monthly[tier_index]*multiplier,2);assert advertised['price']==expected and objects[result.session_id].amount_total==int(round(expected*100))
    reply=drive(billing.check_subscription_status(result.session_id,db));assert reply['tier']==tier_name and balance()==(tier_name,20,8)
    with Session(engine) as read:
     tx=read.execute(select(PaymentTransaction).where(PaymentTransaction.session_id==result.session_id)).scalar_one();receipt=json.loads(tx.transaction_metadata)['receipt']
     assert tx.amount==expected and receipt['amount_cents']==int(round(expected*100)) and receipt['tier_name']==tier_name and receipt['billing_period']==period
   test(prefix+' '+tier_name+' '+period,case)
def account_premium():
 reset();result=drive(lifecycle.upgrade_subscription_tier('buyer',lifecycle.SubscriptionTierRequest(tier_id='tier_3',origin_url='https://fixture.invalid'),'buyer',db));reply=drive(billing.check_subscription_status(result['session_id'],db));assert reply['tier']=='premium' and balance()==('premium',20,8)
 test_reply=drive(lifecycle.get_account_billing_status('buyer','buyer',db));assert test_reply['current_tier_id']=='tier_3' and test_reply['current_tier_details']['price']==10
 test_result=reply
 assert test_result['status']=='completed'
test('account Premium completion and billing readback',account_premium)
for tier_id,expected in [('tier_3','premium'),('tier_2','basic'),('surfer_premium_annual','premium')]:
 def legacy(tier_id=tier_id,expected=expected):
  reset();sid='cs_fixture_legacy_'+tier_id
  session.add(PaymentTransaction(user_id='buyer',session_id=sid,amount=10,currency='usd',payment_status='pending',status='pending',transaction_metadata=json.dumps({'type':'subscription_tier','tier_id':tier_id})));session.commit()
  objects[sid]=types.SimpleNamespace(payment_status='paid')
  reply=drive(billing.check_subscription_status(sid,db));assert reply['tier']==expected and balance()[0]==expected
 test('existing frozen legacy '+tier_id,legacy)
def repeated():
 reset();result=drive(lifecycle.upgrade_subscription_tier('buyer',lifecycle.SubscriptionTierRequest(tier_id='tier_3',origin_url='https://fixture.invalid'),'buyer',db));drive(billing.check_subscription_status(result['session_id'],db))
 buyer=session.get(Profile,'buyer');buyer.subscription_tier='free';buyer.credit_balance=20;buyer.spend_only_credits=8;session.commit();calls=len(requests)
 reply=drive(billing.check_subscription_status(result['session_id'],db));assert reply['tier']=='premium' and balance()==('free',20,8) and len(requests)==calls
test('completed status does not reapply tier after later free choice',repeated)
def free():
 reset();billing.STRIPE_API_KEY=None;before=len(requests)
 result=drive(billing.create_subscription_checkout(billing.SubscriptionCheckoutRequest(tier_id='surfer_free',origin_url='https://fixture.invalid'),'buyer',db));assert result.session_id=='free' and len(requests)==before and balance()==('free',20,8)
 assert drive(billing.check_subscription_status('free',db))['tier']=='free'
test('free signup needs no Stripe provider',free)
def admin_frozen():
 reset();pricing=deepcopy(DEFAULT_PRICING_DATA);pricing['surfer']['tiers']['tier_2']['price']=7.25
 cfg=GlobalPricingConfig(id='fixture-pricing',pricing_data=pricing,version=1,is_active=True);session.add(cfg);session.commit()
 advertised=drive(billing.get_subscription_plans(db))['surfer']['monthly'];assert next(x for x in advertised if x['id']=='surfer_basic')['price']==7.25
 account=drive(lifecycle.get_account_billing_status('buyer','buyer',db));assert account['available_tiers']['tier_2']['price']==7.25
 result=drive(billing.create_subscription_checkout(billing.SubscriptionCheckoutRequest(tier_id='surfer_basic',origin_url='https://fixture.invalid'),'buyer',db));assert objects[result.session_id].amount_total==725
 pricing=deepcopy(pricing);pricing['surfer']['tiers']['tier_2']['price']=9;cfg.pricing_data=pricing;session.commit()
 reply=drive(billing.check_subscription_status(result.session_id,db));assert reply['tier']=='basic' and balance()==('basic',20,8)
 with Session(engine) as read:tx=read.execute(select(PaymentTransaction).where(PaymentTransaction.session_id==result.session_id)).scalar_one();assert tx.amount==7.25 and json.loads(tx.transaction_metadata)['receipt']['amount_cents']==725
 assert next(x for x in drive(billing.get_subscription_plans(db))['surfer']['monthly'] if x['id']=='surfer_basic')['price']==9
test('admin configured price shared with signup/account; existing receipt remains725 after change900',admin_frozen)
def unpaid():
 reset();result=drive(billing.create_subscription_checkout(billing.SubscriptionCheckoutRequest(tier_id='surfer_premium',origin_url='https://fixture.invalid'),'buyer',db));objects[result.session_id].payment_status='unpaid'
 assert drive(billing.check_subscription_status(result.session_id,db))['status']=='unpaid' and balance()==('free',20,8)
test('ordinary unpaid checkout preserves current tier',unpaid)
def zero_premium():
 reset();pricing=deepcopy(DEFAULT_PRICING_DATA);pricing['surfer']['tiers']['tier_3']['price']=0
 session.add(GlobalPricingConfig(id='zero-pricing',pricing_data=pricing,version=1,is_active=True));session.commit();before=len(requests)
 result=drive(billing.create_subscription_checkout(billing.SubscriptionCheckoutRequest(tier_id='surfer_premium',origin_url='https://fixture.invalid'),'buyer',db));assert result.session_id=='free' and balance()==('premium',20,8) and len(requests)==before
 reply=drive(lifecycle.upgrade_subscription_tier('buyer',lifecycle.SubscriptionTierRequest(tier_id='tier_3',origin_url='https://fixture.invalid'),'buyer',db));assert reply['new_tier']=='premium' and 'Premium' in reply['message'] and len(requests)==before
 assert next(x for x in drive(billing.get_subscription_plans(db))['surfer']['monthly'] if x['id']=='surfer_premium')['tier_name']=='premium'
test('admin zero-priced Premium signup and account activation retain selected tier',zero_premium)
def configured_credit_payment():
 from routes.subscriptions_billing import subscriptions_credits as credit
 reset();pricing=deepcopy(DEFAULT_PRICING_DATA);pricing['surfer']['tiers']['tier_2']['price']=7.25
 session.add(GlobalPricingConfig(id='credit-price',pricing_data=pricing,version=1,is_active=True));session.commit()
 result=drive(billing.create_subscription_checkout(billing.SubscriptionCheckoutRequest(tier_id='surfer_basic',origin_url='https://fixture.invalid'),'buyer',db));assert objects[result.session_id].amount_total==725
 quote=drive(credit.get_credit_payment_info('buyer','tier_2',db));assert quote['price_usd']==7.25 and quote['credits_required']==7.25 and quote['can_afford']
 reply=drive(credit.pay_subscription_with_credits('buyer',credit.CreditSubscriptionPaymentRequest(tier_id='tier_2'),'buyer',db))
 assert reply['credits_used']==7.25 and balance()==('basic',12.75,0.75)
 with Session(engine) as read:
  debit=read.execute(select(CreditTransaction).where(CreditTransaction.user_id=='buyer')).scalars().all()[-1]
  assert debit.amount==-7.25 and debit.spend_only_amount==-7.25 and debit.balance_before==20 and debit.balance_after==12.75
test('configured7.25 card quote equals credit debit and preserves promo0.75 ledger',configured_credit_payment)
def zero_credit_premium():
 from routes.subscriptions_billing import subscriptions_credits as credit
 reset();pricing=deepcopy(DEFAULT_PRICING_DATA);pricing['surfer']['tiers']['tier_3']['price']=0
 session.add(GlobalPricingConfig(id='zero-credit-price',pricing_data=pricing,version=1,is_active=True));session.commit()
 before=len(session.execute(select(CreditTransaction)).scalars().all())
 quote=drive(credit.get_credit_payment_info('buyer','tier_3',db));assert quote['price_usd']==0 and quote['credits_required']==0
 reply=drive(credit.pay_subscription_with_credits('buyer',credit.CreditSubscriptionPaymentRequest(tier_id='tier_3'),'buyer',db))
 assert reply['credits_used']==0 and reply['new_tier']=='premium' and balance()==('premium',20,8) and len(session.execute(select(CreditTransaction)).scalars().all())==before
test('zero-priced Premium credit activation retains Premium without ledger debit',zero_credit_premium)
failures=[]
try:
 for name,fn in cases:
  try:fn();print('PASS',name)
  except Exception as error:session.rollback();failures.append(name);print('FAIL',name,type(error).__name__,str(error))
 print(f'{len(cases)-len(failures)}/{len(cases)} isolated billing cases passed');raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
