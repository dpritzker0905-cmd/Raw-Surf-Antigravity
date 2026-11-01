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
failures=[]
def check_new(amount,expected):
 uid=f'user-{amount}';session.add(Profile(id=uid,user_id=uid,email=uid+'@example.invalid',role=RoleEnum.SURFER,credit_balance=0));session.commit()
 current=drive(credits.get_credit_packages(db))
 result=drive(credits.purchase_credits(credits.CreditPurchaseRequest(amount=amount,origin_url='http://fixture.invalid',offer_id=current['offer_id']),uid,db))
 tx=session.execute(select(PaymentTransaction).where(PaymentTransaction.session_id==result['session_id'])).scalar_one()
 meta=json.loads(tx.transaction_metadata)
 assert meta['credits']==expected,(meta,expected)
 assert float(created[-1]['metadata']['credits'])==expected
 assert created[-1]['line_items'][0]['price_data']['unit_amount']==int(amount*100)
 credited,balance=drive(fulfill_wallet_payment(db,tx));session.commit()
 assert credited==balance==expected,(credited,balance,expected)
 again,balance=drive(fulfill_wallet_payment(db,tx));session.commit()
 assert again==0 and balance==expected
 with Session(engine) as readback:
  assert readback.get(Profile,uid).credit_balance==expected
  ledger=readback.execute(select(CreditTransaction).where(CreditTransaction.user_id==uid)).scalars().all()
  bonus=expected-int(amount)
  assert len(ledger)==(2 if bonus else 1) and sum(row.amount for row in ledger)==expected
  assert sum(row.spend_only_amount for row in ledger)==bonus
 print('PASS new checkout',amount,'credits',expected,'one fulfillment after repeat')
def check_legacy(label,amount,metadata,expected):
 uid='legacy-'+label;session.add(Profile(id=uid,user_id=uid,email=uid+'@example.invalid',role=RoleEnum.SURFER,credit_balance=0))
 tx=PaymentTransaction(user_id=uid,session_id=uid,amount=amount,transaction_metadata=metadata);session.add(tx);session.commit()
 credited,balance=drive(fulfill_wallet_payment(db,tx));session.commit();assert credited==balance==expected
 again,balance=drive(fulfill_wallet_payment(db,tx));session.commit();assert again==0 and balance==expected
 print('PASS legacy',label,'credits',expected)
try:
 for amount,expected in [(10,10),(25,25),(50,55),(100,115),(37,37),(37.5,37)]:
  try:check_new(amount,expected)
  except Exception as e:session.rollback();failures.append(str(amount));print('FAIL',amount,type(e).__name__,str(e))
 for args in [('wallet50',50,'{"credits":50}',50),('dict25',25,"{'credits': 25}",25),('deposit',12.5,"{'type':'request_a_pro_deposit'}",12.5)]:
  try:check_legacy(*args)
  except Exception as e:session.rollback();failures.append(args[0]);print('FAIL',args[0],type(e).__name__,str(e))
 print(f'{9-len(failures)}/9 credit cases passed');raise SystemExit(bool(failures))
finally:session.close();engine.dispose()
