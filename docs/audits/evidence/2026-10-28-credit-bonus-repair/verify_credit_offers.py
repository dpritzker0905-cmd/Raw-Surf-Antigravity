"""Normal checkout/fulfillment with fake Stripe and real disposable SQLite credits.
Identity is synthetic; no provider, HTTP, concurrency or PostgreSQL proof.
Python socket guards are not an OS firewall. Run existing backend venv Python -B.
"""
import json, os, socket, sys, types
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
for name,folder in [('routes',backend/'routes'),('routes.subscriptions_billing',backend/'routes/subscriptions_billing')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from models import Profile,PaymentTransaction,CreditTransaction,RoleEnum,GlobalPricingConfig
from routes.subscriptions_billing import credits
from utils.payment_fulfillment import fulfill_wallet_payment,wallet_credit_amount
from utils.credit_packages import credit_package_metadata,validate_credit_package_receipt
engine=create_engine('sqlite:///:memory:')
for model in (Profile,PaymentTransaction,CreditTransaction,GlobalPricingConfig):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
 async def rollback(self):return session.rollback()
db=Adapter()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected asynchronous I/O {v}')
created=[]
def checkout(**kwargs):
 created.append(kwargs);return NS(id=f'fixture-session-{len(created)}',url='http://fixture.invalid/checkout')
credits.stripe.checkout.Session.create=checkout

checks=0
uid='offers-buyer'
session.add(Profile(id=uid,user_id=uid,email=uid+'@example.invalid',role=RoleEnum.PHOTOGRAPHER,credit_balance=0,spend_only_credits=0,withdrawable_credits=0));session.commit()
def offer():return drive(credits.get_credit_packages(db))
def buy(amount,seen):
 response=drive(credits.purchase_credits(credits.CreditPurchaseRequest(amount=amount,origin_url='http://fixture.invalid',offer_id=seen),uid,db))
 return session.execute(select(PaymentTransaction).where(PaymentTransaction.session_id==response['session_id'])).scalar_one()
def config(version,bonuses):
 for row in session.execute(select(GlobalPricingConfig)).scalars():row.is_active=False
 row=GlobalPricingConfig(id='config-'+str(version),version=version,pricing_data={},credit_package_bonuses=bonuses,is_active=True)
 session.add(row);session.commit();return row
running_total=0;running_bonus=0
def fulfill(tx,base,bonus):
 global running_total,running_bonus
 validated=drive(validate_credit_package_receipt(db,tx))
 if validated is not None:assert validated['base_credits']==base and validated['bonus_credits']==bonus
 before=session.query(CreditTransaction).count()
 credited,balance=drive(fulfill_wallet_payment(db,tx));session.commit()
 running_total+=base+bonus;running_bonus+=bonus
 assert credited==base+bonus and balance==running_total
 again,balance=drive(fulfill_wallet_payment(db,tx));session.commit()
 assert again==0 and balance==running_total
 session.expire_all();user=session.get(Profile,uid)
 assert user.credit_balance==running_total and user.spend_only_credits==running_bonus
 assert user.withdrawable_credits==running_total-running_bonus
 rows=session.execute(select(CreditTransaction).where(CreditTransaction.reference_id==tx.id)).scalars().all()
 assert sum(r.amount for r in rows)==base+bonus and sum(r.spend_only_amount for r in rows)==bonus
 assert session.query(CreditTransaction).count()==before+len(rows)
 assert len(rows)==(2 if bonus else 1)
def passed(name):
 global checks
 checks+=1;print('PASS',name)
try:
 initial=offer();assert initial['offer_id']=='default-v1'
 assert {p['amount']:p['bonus'] for p in initial['packages']}=={10:0,25:0,50:5,100:15};passed('public default offer')
 old_default=buy(50,initial['offer_id']);assert json.loads(old_default.transaction_metadata)['package_version']==2
 assert created[-1]['line_items'][0]['price_data']['unit_amount']==5000
 assert created[-1]['metadata']['offer_id']=='default-v1';passed('server-owned checkout terms')
 config(1,{'10':0,'25':0,'50':0,'100':0});zero=offer()
 assert all(p['bonus']==0 for p in zero['packages']);passed('admin zero offer preserved')
 count=len(created)
 try:buy(50,initial['offer_id'])
 except Exception as error:assert getattr(error,'status_code',None)==409
 else:raise AssertionError('Stale offer accepted')
 assert len(created)==count;passed('stale offer rejected before provider double')
 fulfill(old_default,50,5);passed('default receipt frozen after admin edit')
 fulfill(buy(50,zero['offer_id']),50,0);passed('zero bonus purchase')
 config(2,{'10':0,'25':0,'50':9,'100':0});custom=offer();old_custom=buy(50,custom['offer_id'])
 config(3,{'10':0,'25':0,'50':0,'100':0});fulfill(old_custom,50,9);passed('inactive historical config honors purchased bonus')
 current=offer();fulfill(buy(37,current['offer_id']),37,0);passed('different custom amount has no bonus')
 tx=PaymentTransaction(user_id=uid,session_id='legacy-json',amount=50,transaction_metadata='{"credits":50}')
 session.add(tx);session.commit();fulfill(tx,50,0);passed('legacy JSON receipt unchanged')
 tx=PaymentTransaction(user_id=uid,session_id='legacy-v1',amount=50,transaction_metadata=json.dumps(credit_package_metadata(50,version=1)))
 session.add(tx);session.commit();fulfill(tx,50,5);passed('version-one bonus receipt honored spend-only')
 print(f'{checks}/10 offer and receipt cases passed')
finally:session.close();engine.dispose()
