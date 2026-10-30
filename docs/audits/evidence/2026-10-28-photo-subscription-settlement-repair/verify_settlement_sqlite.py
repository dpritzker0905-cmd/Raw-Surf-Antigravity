"""Actual normal cancellation and expired-checkout refund handlers, disposable SQLite.
No scheduler/server startup, real identity, provider, weather or external network.
"""
import os,sys,socket,types
from pathlib import Path
from datetime import datetime,timedelta,timezone
keep={k:os.environ[k]for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH')if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(TESTING='1',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*a,**k):raise RuntimeError('External connection disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.bookings',backend/'routes/bookings'),('routes.notifications',backend/'routes/notifications'),('routes.subscriptions_billing',backend/'routes/subscriptions_billing')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
import database
import json
from sqlalchemy import func, delete
from fastapi import HTTPException
from models import Profile,CreditTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription,PaymentTransaction,RoleEnum
if '--baseline' in sys.argv:
 source=json.loads((Path(__file__).parent/'baseline_source.json').read_text(encoding='utf-8'))['backend/routes/subscriptions_billing/photo_subscriptions.py']
 name='routes.subscriptions_billing.photo_subscriptions';module=types.ModuleType(name);module.__package__='routes.subscriptions_billing';sys.modules[name]=module
 exec(compile(source,name,'exec'),module.__dict__)
from routes.subscriptions_billing import photo_subscriptions as routes
engine=create_engine('sqlite:///:memory:')
for model in (Profile,CreditTransaction,PhotographerSubscriptionPlan,SurferPhotoSubscription,PaymentTransaction):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 fail_commit=False
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):
  if self.fail_commit:self.fail_commit=False;raise RuntimeError('Synthetic commit unavailable')
  session.commit()
 async def rollback(self):session.rollback()
 async def flush(self):session.flush()
 async def refresh(self,*a,**k):session.refresh(*a,**k)
db=Adapter()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected I/O {v}')
def seed(name,tier='basic',gross=20,role=RoleEnum.PHOTOGRAPHER,total=40,promo=5,pocket=35):
 buyer=Profile(id=name,user_id=name,email=name+'@example.invalid',role=RoleEnum.SURFER,credit_balance=115,spend_only_credits=15)
 seller=Profile(id=name+'-seller',user_id=name+'-seller',email=name+'-seller@example.invalid',role=role,subscription_tier=tier,credit_balance=total,spend_only_credits=promo,withdrawable_credits=pocket,gear_only_credits=7)
 plan=PhotographerSubscriptionPlan(id=name+'-plan',photographer_id=seller.id,name='Synthetic weekly',interval='weekly',price=gross,photos_included=10)
 session.add_all([buyer,seller,plan]);session.commit();return buyer,seller,plan

def credit(buyer,plan):return drive(routes.subscribe_to_plan(routes.SubscribeRequest(plan_id=plan.id,payment_method='credits'),buyer.id,buyer.id,db))
def rows(model,owner):
 key=model.user_id if model is CreditTransaction else model.surfer_id
 return session.execute(select(model).where(key==owner)).scalars().all()
def wallet(profile):return tuple(round(float(value or 0),2)for value in (profile.credit_balance,profile.spend_only_credits,profile.withdrawable_credits))
def check_receipt(buyer,seller,gross,net,before=(40,5,35)):
 assert wallet(seller)==(round(before[0]+net,2),before[1],round(before[2]+net,2)),wallet(seller)
 assert seller.gear_only_credits==7,'Separate Pro gear pool changed'
 subs=rows(SurferPhotoSubscription,buyer.id);assert len(subs)==1
 assert subs[0].amount_paid==gross and subs[0].plan_price==gross,(subs[0].amount_paid,subs[0].plan_price)
 ledger=rows(CreditTransaction,seller.id);assert len(ledger)==1,[(r.amount,r.transaction_type)for r in ledger]
 row=ledger[0];assert (row.amount,row.spend_only_amount,row.transaction_type,row.reference_type,row.reference_id,row.counterparty_id)==(net,0,'photo_subscription_earning','photo_subscription',subs[0].id,buyer.id)
 assert (round(row.balance_before,2),round(row.balance_after,2))==(before[0],round(before[0]+net,2))
 return subs[0]

def normal_credit(tier,role=RoleEnum.PHOTOGRAPHER,gross=20):
 name='credit-'+tier+'-'+role.name+str(gross);buyer,seller,plan=seed(name,tier,gross,role)
 credit(buyer,plan);paid=round(gross,2);net=round(paid*(0.85 if tier=='premium' else 0.8),2)
 check_receipt(buyer,seller,paid,net)
 assert (buyer.credit_balance,buyer.spend_only_credits)==(round(115-paid,2),max(0,round(15-paid,2)))
 debit=rows(CreditTransaction,buyer.id);assert len(debit)==1 and debit[0].amount==-paid and debit[0].spend_only_amount==-min(15,paid)

def refusal(kind):
 kwargs={'total':10,'promo':0,'pocket':100}if kind=='legacy'else{'total':10,'promo':15,'pocket':0}if kind=='subset'else{'role':RoleEnum.HOBBYIST}
 buyer,seller,plan=seed('refusal-'+kind,**kwargs);before=wallet(seller)
 try:credit(buyer,plan);raise AssertionError('expected seller reconciliation refusal')
 except HTTPException as e:assert e.status_code==409
 assert wallet(buyer)[:2]==(115,15) and wallet(seller)==before
 assert not rows(SurferPhotoSubscription,buyer.id) and not rows(CreditTransaction,buyer.id) and not rows(CreditTransaction,seller.id)

def paid_fixture(name,**kwargs):
 buyer,seller,plan=seed(name,**kwargs)
 tx=PaymentTransaction(id=name+'-payment',user_id=buyer.id,session_id=name+'-checkout',amount=plan.price,currency='usd',payment_status='pending',status='pending',transaction_metadata=json.dumps({'type':'photo_subscription','plan_id':plan.id,'photographer_id':seller.id}))
 session.add(tx);session.commit();return buyer,seller,plan,tx

original_retrieve=routes.stripe.checkout.Session.retrieve
original_create=routes.stripe.checkout.Session.create
routes.STRIPE_API_KEY=True

def verify_paid(buyer,plan,tx,cents=None):
 routes.stripe.checkout.Session.retrieve=lambda identifier:types.SimpleNamespace(payment_status='paid',metadata={'type':'photo_subscription','surfer_id':buyer.id,'plan_id':plan.id},amount_total=cents if cents is not None else round(tx.amount*100))
 return drive(routes.complete_card_subscription(tx.session_id,buyer.id,db))

def normal_card(tier='basic',edited=False,legacy_fraction=False):
 name='card-'+tier+str(edited)+str(legacy_fraction);buyer,seller,plan,tx=paid_fixture(name,tier=tier,gross=19.999 if legacy_fraction else 19.99)
 if edited:plan.price=90;session.commit()
 cents=1999;verify_paid(buyer,plan,tx,cents);paid=19.99;net=round(paid*(0.85 if tier=='premium' else .8),2)
 check_receipt(buyer,seller,paid,net)
 assert (buyer.credit_balance,buyer.spend_only_credits)==(115,15)
 assert tx.payment_status=='completed'
 verify_paid(buyer,plan,tx,cents);check_receipt(buyer,seller,paid,net)

def card_retry():
 buyer,seller,plan,tx=paid_fixture('card-retry',total=10,promo=0,pocket=100)
 try:verify_paid(buyer,plan,tx);raise AssertionError('expected legacy reconciliation')
 except HTTPException as e:assert e.status_code==409
 assert tx.payment_status=='pending' and tx.status=='pending'
 assert wallet(seller)==(10,0,100) and not rows(CreditTransaction,seller.id) and not rows(SurferPhotoSubscription,buyer.id)
 # Reconcile only disposable fixture data, then retry this same paid receipt.
 seller.credit_balance=100;session.commit();verify_paid(buyer,plan,tx);check_receipt(buyer,seller,20,16,before=(100,0,100))
 verify_paid(buyer,plan,tx);check_receipt(buyer,seller,20,16,before=(100,0,100))

def commit_failure(card=False):
 name='commit-'+str(card)
 if card:buyer,seller,plan,tx=paid_fixture(name)
 else:buyer,seller,plan=seed(name)
 db.fail_commit=True
 try:
  verify_paid(buyer,plan,tx)if card else credit(buyer,plan)
  raise AssertionError('expected commit failure')
 except RuntimeError as e:assert 'Synthetic commit' in str(e)
 assert not session.new,'Failed activation left new subscription/ledger rows staged'
 assert wallet(buyer)[:2]==(115,15) and wallet(seller)==(40,5,35)
 if card:
  assert tx.payment_status=='pending' and tx.status=='pending'
  verify_paid(buyer,plan,tx);check_receipt(buyer,seller,20,16)
 assert not rows(CreditTransaction,buyer.id)

def grant_failure():
 buyer,seller,plan=seed('grant-failure');original=getattr(routes,'add_credits',None)
 async def refuse(*a,**k):return False,0,'Synthetic seller credit unavailable'
 routes.add_credits=refuse
 try:
  try:credit(buyer,plan);raise AssertionError('expected credit refusal')
  except HTTPException as e:assert e.status_code==409
  assert wallet(buyer)[:2]==(115,15) and wallet(seller)==(40,5,35)
  assert not rows(CreditTransaction,buyer.id) and not rows(SurferPhotoSubscription,buyer.id)
 finally:
  if original is None:del routes.add_credits
  else:routes.add_credits=original

def checkout_cents():
 buyer,_,plan=seed('checkout-cents',gross=19.99);seen=[]
 def create(**payload):seen.append(payload);return types.SimpleNamespace(id='checkout-cents-session',url='https://fixture.invalid/checkout')
 routes.stripe.checkout.Session.create=create
 result=drive(routes.subscribe_to_plan(routes.SubscribeRequest(plan_id=plan.id,payment_method='card'),buyer.id,buyer.id,db))
 assert result['requires_payment']
 assert seen[0]['line_items'][0]['price_data']['unit_amount']==1999,seen
 tx=session.execute(select(PaymentTransaction).where(PaymentTransaction.user_id==buyer.id)).scalar_one();assert tx.amount==19.99

def card_role_or_missing(kind):
 buyer,seller,plan,tx=paid_fixture('card-'+kind)
 if kind=='missing':
  session.expunge(seller);session.execute(delete(Profile).where(Profile.id==seller.id));session.commit()
 else:seller.role=RoleEnum.HOBBYIST;session.commit()
 try:verify_paid(buyer,plan,tx);raise AssertionError('expected seller reconciliation')
 except HTTPException as e:assert e.status_code==409
 assert tx.payment_status=='pending' and tx.status=='pending'
 assert not rows(CreditTransaction,seller.id) and not rows(SurferPhotoSubscription,buyer.id)
 if kind=='missing':
  session.add(Profile(id=seller.id,user_id=seller.id,email=seller.id+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,subscription_tier='basic',credit_balance=40,spend_only_credits=5,withdrawable_credits=35,gear_only_credits=7));session.commit();seller=session.get(Profile,seller.id)
 else:seller.role=RoleEnum.PHOTOGRAPHER;session.commit()
 verify_paid(buyer,plan,tx);check_receipt(buyer,seller,20,16)
 verify_paid(buyer,plan,tx);check_receipt(buyer,seller,20,16)

def floating_pocket():
 buyer,seller,plan=seed('float-pocket',pocket=35.00000000000001)
 credit(buyer,plan);check_receipt(buyer,seller,20,16)

def earnings_integration():
 buyer,seller,plan,tx=paid_fixture('earnings-integration')
 verify_paid(buyer,plan,tx);verify_paid(buyer,plan,tx)
 package=types.ModuleType('routes.photographer');package.__path__=[str(backend/'routes/photographer')];sys.modules['routes.photographer']=package
 from routes.photographer import pricing
 breakdown=drive(pricing.get_earnings_breakdown(seller.id,days=1,current_user_id=seller.id,db=db))
 assert breakdown.photo_subscriptions==16 and breakdown.total==16 and breakdown.gallery_sales==0,breakdown
 assert breakdown.wallet_balance==56 and breakdown.cash_available==51,breakdown
 history=drive(pricing.get_earnings_history(seller.id,months=2,current_user_id=seller.id,db=db))
 assert history['summary']['current_month']==16 and history['summary']['total_earnings']==16,history
 assert history['history'][0]['photo_subscriptions']==16 and history['history'][0]['gallery_sales']==0,history
 assert len(rows(CreditTransaction,seller.id))==1 and len(rows(SurferPhotoSubscription,buyer.id))==1

cases=[('credit basic net wallet and ledger',lambda:normal_credit('basic')),('credit premium preserves15percent fee',lambda:normal_credit('premium')),('approved Pro uses same settlement',lambda:normal_credit('basic',RoleEnum.APPROVED_PRO)),('credit19.99 uses cent-rounded net',lambda:normal_credit('basic',gross=19.99)),('legacy fractional credit gross matches rounded buyer debit',lambda:normal_credit('basic',gross=19.999))]+[(kind+' seller refusal leaves purchase unchanged',lambda kind=kind:refusal(kind))for kind in ('legacy','subset','role')]+[('card net receipt and repeat',normal_card),('premium card preserves15percent fee',lambda:normal_card('premium')),('card plan edit cannot change paid gross',lambda:normal_card(edited=True)),('legacy card fraction follows actual paid cents',lambda:normal_card(legacy_fraction=True)),('card seller reconciliation rollback and later retry exactly once',card_retry),('credit commit failure rolls back debit and earning',commit_failure),('card commit failure restores claim for retry',lambda:commit_failure(True)),('seller credit refusal rolls back buyer and subscription',grant_failure),('new card checkout rounds19.99 to1999cents',checkout_cents),('card missing seller rollback and retry',lambda:card_role_or_missing('missing')),('card role change rollback and retry',lambda:card_role_or_missing('role')),('actual producer receipt feeds breakdown and monthly history once',earnings_integration),('floating-point cents noise does not refuse a consistent cash pocket',floating_pocket)]
failures=[]
try:
 for name,fn in cases:
  try:fn();print('PASS',name)
  except Exception as e:session.rollback();db.fail_commit=False;failures.append(name);print('FAIL',name,type(e).__name__,str(e))
 print(f'{len(cases)-len(failures)}/{len(cases)} photo subscription settlement cases passed');raise SystemExit(bool(failures))
finally:
 routes.stripe.checkout.Session.retrieve=original_retrieve;routes.stripe.checkout.Session.create=original_create
 session.close();engine.dispose()
