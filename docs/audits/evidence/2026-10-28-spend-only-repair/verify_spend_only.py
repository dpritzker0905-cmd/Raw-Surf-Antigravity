"""Real disposable SQLite accounting; no auth, server, provider or concurrency proof."""
import os,sys,socket,types,json
from pathlib import Path
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*a,**k):raise RuntimeError('External connections disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.admin',backend/'routes/admin')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from models import Profile,RoleEnum,PaymentTransaction,CreditTransaction,GlobalPricingConfig,PayoutBatch
from utils.credits import add_credits,add_spend_only_credits,deduct_credits,refund_credits,consume_spend_only_for_debit,transfer_credits
from utils.payment_fulfillment import fulfill_wallet_payment
from utils.credit_packages import credit_package_metadata
from utils.revenue_routing import migrate_user_credits,get_available_credits,process_creator_earnings
from routes.admin import finance
engine=create_engine('sqlite:///:memory:')
for model in (Profile,PaymentTransaction,CreditTransaction,GlobalPricingConfig,PayoutBatch):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
 async def flush(self):return session.flush()
 async def rollback(self):return session.rollback()
db=Adapter()
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected asynchronous I/O {v}')
def user(uid,role=RoleEnum.PHOTOGRAPHER,total=0,promo=0,cash=0):
 obj=Profile(id=uid,user_id=uid,email=uid+'@example.invalid',role=role,full_name='Synthetic',credit_balance=total,spend_only_credits=promo,withdrawable_credits=cash)
 session.add(obj);session.commit();return obj
def state(obj):session.refresh(obj);return tuple(round(v or 0,2) for v in (obj.credit_balance,obj.spend_only_credits,obj.withdrawable_credits))
def check(ok):assert ok
checks=0
def passed(name):
 global checks
 checks+=1;print('PASS',name)
async def noop(*a,**k):pass
finance.log_audit=noop
try:
 pro=user('pro');tx=PaymentTransaction(user_id=pro.id,session_id='fixture-pro',amount=100,transaction_metadata=json.dumps(credit_package_metadata(100,version=1)))
 session.add(tx);session.commit()
 check(drive(fulfill_wallet_payment(db,tx))==(115,115));session.commit();check(state(pro)==(115,15,100))
 rows=session.execute(select(CreditTransaction).where(CreditTransaction.user_id==pro.id)).scalars().all();check(sorted((r.amount,r.spend_only_amount) for r in rows)==[(15,15),(100,0)]);passed('base plus bonus grant stays spend-only')
 check(drive(fulfill_wallet_payment(db,tx))==(0,115));session.commit();check(state(pro)==(115,15,100));check(session.query(CreditTransaction).filter_by(user_id=pro.id).count()==2);passed('repeat fulfillment no second grant')
 check(drive(deduct_credits(pro.id,20,'fixture_purchase',db,reference_type='booking',reference_id='booking1',transaction_id='debit1'))[0]);session.commit();check(state(pro)==(95,0,95))
 debit=session.get(CreditTransaction,'debit1');check(debit.spend_only_amount==-15);passed('bonus-first debit tracks consumed component')
 check(drive(refund_credits(pro.id,5,db,original_transaction_id='debit1'))[0]);session.commit();check(state(pro)==(100,5,95));passed('partial refund restores promotional component first')
 check(drive(refund_credits(pro.id,15,db,original_transaction_id='debit1'))[0]);session.commit();check(state(pro)==(115,15,100));passed('remaining refund restores original cash pocket')
 before=state(pro);check(not drive(refund_credits(pro.id,1,db,original_transaction_id='debit1'))[0]);check(state(pro)==before);passed('repeat refund capped by original payment')
 check(not drive(refund_credits(pro.id,5,db,original_transaction_id='missing-debit'))[0]);check(state(pro)==before);passed('missing explicit debit cannot mint refund')
 for key in ('multi1','multi2'):
  check(drive(deduct_credits(pro.id,10,'fixture_purchase',db,reference_type='booking',reference_id='many',transaction_id=key))[0]);session.commit()
 check(drive(refund_credits(pro.id,20,db,reference_type='booking',reference_id='many'))[0]);session.commit();check(state(pro)==(115,15,100));passed('reference refund spans multiple debits with exact composition')
 direct=user('direct',total=115,promo=15,cash=100);direct.credit_balance-=10;check(consume_spend_only_for_debit(direct,10)==10);session.commit();check(state(direct)==(105,5,100));passed('legacy direct debit classification')
 migrate=user('migrate',total=115,promo=15,cash=0);drive(migrate_user_credits(migrate.id,db));session.commit();check(state(migrate)==(115,15,100));check(get_available_credits(migrate)['total']==115);passed('role migration preserves promo exclusion')
 result=drive(process_creator_earnings(pro.id,20,'fixture_earning',db));session.commit();check(result['success']);check(state(pro)==(130,15,115));passed('creator earnings preserve promotional subset')
 stale=user('stale-cash',total=100,cash=0);stale.subscription_tier='basic';session.commit();drive(process_creator_earnings(stale.id,10,'fixture_earning',db));session.commit();check(state(stale)==(108,0,108));passed('earnings preserve legacy cash with stale zero pocket')
 stale_bonus=user('stale-bonus',total=115,promo=15,cash=0);stale_bonus.subscription_tier='basic';stale_bonus.gear_only_credits=20;session.commit();drive(process_creator_earnings(stale_bonus.id,10,'fixture_earning',db));session.commit();check(state(stale_bonus)==(123,15,108));session.refresh(stale_bonus);check(stale_bonus.gear_only_credits==20);passed('earnings preserve cash promo and separate gear despite stale pocket')
 hobby=user('hobby',RoleEnum.HOBBYIST,total=115,promo=15);drive(migrate_user_credits(hobby.id,db));session.commit();session.refresh(hobby);check(hobby.gear_only_credits==100 and hobby.spend_only_credits==15);check(get_available_credits(hobby)['total']==115);passed('hobbyist gear pocket excludes promo subset')
 separate=user('separate-gear',total=115,promo=15,cash=100);separate.gear_only_credits=20;session.commit();available=get_available_credits(separate);check(available['total']==135 and available['withdrawable']==100 and available['gear_only']==20);passed('separate Pro gear pocket remains visible')
 legacy=user('legacy',total=50,cash=50);check(drive(refund_credits(legacy.id,5,db,reference_type='historic',reference_id='no-ledger'))[0]);session.commit();check(state(legacy)==(55,0,55));passed('legacy no-promo refund compatibility')
 legacy_mixed=user('legacy-mixed',total=115,promo=15,cash=100)
 check(drive(refund_credits(legacy_mixed.id,5,db,allow_legacy_cash_refund=True,transaction_type='live_session_refund'))[0]);session.commit();check(state(legacy_mixed)==(120,15,105));passed('explicit known-legacy cash refund after later bonus')
 check(not drive(refund_credits(legacy_mixed.id,5,db,original_transaction_id='missing',allow_legacy_cash_refund=True))[0]);passed('missing explicit source cannot use legacy exception')
 oldpocket=user('legacy-ledger',total=100,promo=0,cash=0)
 session.add(CreditTransaction(user_id=oldpocket.id,amount=100,spend_only_amount=0,balance_before=0,balance_after=100,transaction_type='legacy_sale'));session.commit()
 failure=drive(transfer_credits(pro.id,'missing-recipient',20,'fixture_transfer',db));session.commit();check(not failure[0]);check(state(pro)==(130,15,115));passed('failed recipient restores debit cash-promo provenance')
 pocket_history=user('legacy-pocket',total=115,promo=15,cash=100);session.add(CreditTransaction(user_id=pocket_history.id,amount=15,spend_only_amount=15,balance_before=100,balance_after=115,transaction_type='wallet_bonus'));session.commit()
 only=user('bonus-only',total=15,promo=15,cash=15)
 preview=drive(finance.get_pending_payouts(admin=pro,db=db));balances={r['user_id']:r['balance'] for r in preview['pending_payouts']};check('bonus-only' not in balances);check(balances['pro']==115);check(balances['legacy-ledger']==100);check(balances['legacy-pocket']==100);passed('payout preview excludes promo and preserves both partial-history cash sources')
 batch=drive(finance.create_payout_batch(finance.CreatePayoutBatchRequest(user_ids=['pro','bonus-only']),admin=pro,db=db));check(batch['total_amount']==115 and batch['total_recipients']==1);passed('payout batch uses capped remaining cash not gross credits')
 print(f'{checks}/{checks} accounting scenarios passed')
finally:session.close();engine.dispose()
