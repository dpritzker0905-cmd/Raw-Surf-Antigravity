"""Synthetic gear receipt linkage via actual ASGI, JWT and AsyncSession only."""
import os,sys,uuid,asyncio,socket,types,json,logging
from pathlib import Path
from urllib.parse import urlsplit
loop=asyncio.new_event_loop();asyncio.set_event_loop(loop)
fixture_url=os.environ.get('CHECKOUT_FIXTURE_DATABASE_URL') if '--pg' in sys.argv else None
if '--pg' in sys.argv:assert fixture_url,'Missing isolated fixture database environment'
if fixture_url:
    parsed=urlsplit(fixture_url);assert parsed.hostname=='127.0.0.1' and parsed.port and parsed.scheme in ('postgresql+asyncpg','postgresql')
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep);os.environ.update(TESTING='1',DATABASE_URL=fixture_url or 'sqlite+aiosqlite:///:memory:',PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',SECRET_KEY=uuid.uuid4().hex)
sys.dont_write_bytecode=True;logging.disable(logging.CRITICAL)
original_connect=socket.socket.connect
def blocked(*a,**k):raise RuntimeError('External connections disabled')
def local_connect(self,address):
    if fixture_url and address[0]=='127.0.0.1' and address[1]==parsed.port:return original_connect(self,address)
    return blocked()
socket.socket.connect=local_connect;socket.socket.connect_ex=socket.create_connection=blocked
ROOT=Path(__file__).resolve().parents[4];sys.path.insert(0,str(ROOT/'backend'))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name in ('routes','routes.commerce'):
    module=types.ModuleType(name);module.__path__=[str(ROOT/'backend'/name.replace('.','/'))];sys.modules[name]=module
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import database,httpx
from models import Profile,RoleEnum,GearCatalog,GearPurchase,GearCategory,Notification,CreditTransaction
from core.security import create_access_token
from routes.commerce import gear_hub
if '--baseline' in sys.argv:exec(compile((Path(__file__).parent/'baseline_gear_hub.py').read_text(encoding='utf-8-sig'),'baseline_gear_hub.py','exec'),gear_hub.__dict__)
app=FastAPI();app.include_router(gear_hub.router,prefix='/api')
MODE=None
class FaultSession(AsyncSession):
    def add(self,instance,*args,**kwargs):
        if MODE=='constraint_failure' and isinstance(instance,GearPurchase):instance.credits_spent=None
        if MODE=='notification_staging_failure' and isinstance(instance,Notification):raise RuntimeError('Synthetic notification staging failure')
        return super().add(instance,*args,**kwargs)
    async def commit(self):
        if MODE=='commit_failure':raise RuntimeError('Synthetic commit failure')
        return await super().commit()
async def session_dependency():
    async with FaultSession(bind=database.engine,expire_on_commit=False,autoflush=False) as session:yield session
app.dependency_overrides[database.get_db]=session_dependency
CASES=[('hobbyist',RoleEnum.HOBBYIST),('pro',RoleEnum.PHOTOGRAPHER),('grom_parent',RoleEnum.GROM_PARENT),('constraint_failure',RoleEnum.HOBBYIST),('notification_staging_failure',RoleEnum.HOBBYIST),('commit_failure',RoleEnum.HOBBYIST)]
OBSERVATIONS={}
async def initialize():
    models=[Profile,GearCatalog,GearPurchase,Notification,CreditTransaction]
    async with database.engine.begin() as conn:
        if fixture_url:
            tables={c.__table__ for c in models}
            while True:
                expanded=tables|{fk.column.table for t in tables for fk in t.foreign_keys}
                if expanded==tables:break
                tables=expanded
            await conn.run_sync(lambda sync:database.Base.metadata.create_all(sync,tables=list(tables)))
        else:
            for cls in models:await conn.run_sync(cls.__table__.create)
async def snapshot(buyer,item_id):
    async with database.AsyncSessionLocal() as session:
        b=await session.get(Profile,buyer);item=await session.get(GearCatalog,item_id)
        purchases=(await session.execute(select(GearPurchase).where(GearPurchase.user_id==buyer))).scalars().all()
        notifications=(await session.execute(select(Notification).where(Notification.user_id==buyer))).scalars().all()
        ledger=(await session.execute(select(CreditTransaction).where(CreditTransaction.user_id==buyer))).scalars().all()
        return dict(wallet=[b.gear_only_credits,b.credit_balance,b.spend_only_credits,b.withdrawable_credits],purchase_count=item.purchase_count,purchases=[dict(id=p.id,item=p.gear_item_id,spent=p.credits_spent,url=p.affiliate_url_used,partner=p.affiliate_partner,status=p.status) for p in purchases],notifications=[dict(type=n.type,data=json.loads(n.data)) for n in notifications],ledger_count=len(ledger))
async def run(client,name,role):
    global MODE
    buyer,item_id=[str(uuid.uuid4()) for _ in range(2)];url='https://fixture.invalid/gear/'+item_id
    async with database.AsyncSessionLocal() as session:
        session.add(Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',full_name='Fictional Gear Buyer',role=role,gear_only_credits=32,credit_balance=40,spend_only_credits=8,withdrawable_credits=0));await session.flush()
        session.add(GearCatalog(id=item_id,name='Fictional Camera',category=GearCategory.CAMERA,price_credits=12.5,affiliate_partner='bh',affiliate_url=url,is_active=True,purchase_count=0));await session.commit()
    before=await snapshot(buyer,item_id);MODE=name if name.endswith('failure') else None
    response=await client.post('/api/gear-hub/'+item_id+'/purchase',headers={'Authorization':'Bearer '+create_access_token({'sub':buyer,'role':role.value})})
    MODE=None;after=await snapshot(buyer,item_id)
    if name.endswith('failure'):
        OBSERVATIONS[name]=dict(http_status=response.status_code,before=before,after=after,rollback_preserved=before==after)
        assert response.status_code==500 and before==after
        return
    assert response.status_code==200,(response.status_code,response.text[:120])
    answer=response.json();purchase=after['purchases'][0];notification=after['notifications'][0]
    OBSERVATIONS[name]=dict(http_status=response.status_code,response_purchase_id=answer['purchase_id'],persisted_purchase_id=purchase['id'],notification_purchase_id=notification['data']['purchase_id'],wallet_before=before['wallet'],wallet_after=after['wallet'],status=purchase['status'],ledger_count=after['ledger_count'])
    assert len(after['purchases'])==len(after['notifications'])==1
    assert purchase['id'] and notification['data']['purchase_id']==purchase['id']==answer['purchase_id'],'Notification purchase_id must match persisted/API receipt'
    uuid.UUID(purchase['id'])
    assert purchase==dict(id=purchase['id'],item=item_id,spent=12.5,url=url,partner='bh',status='clicked')
    assert notification['type']=='gear_purchase' and notification['data']==dict(purchase_id=purchase['id'],item_name='Fictional Camera',affiliate_url=url,affiliate_partner='bh')
    assert after['wallet']==[19.5,40 if role==RoleEnum.PHOTOGRAPHER else 27.5,8,0]
    assert after['purchase_count']==1 and after['ledger_count']==0
    assert answer['credits_spent']==12.5 and answer['remaining_credits']==19.5 and answer['affiliate_url']==url and answer['affiliate_partner']=='bh'
async def main():
    results=[]
    try:
        await initialize()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
            for name,role in CASES:
                try:await run(client,name,role);results.append(dict(name=name,passed=True))
                except Exception as error:results.append(dict(name=name,passed=False,error=str(error)))
    finally:await database.engine.dispose()
    summary=dict(passed=sum(r['passed'] for r in results),total=len(CASES),baseline='--baseline' in sys.argv,database='isolated PostgreSQL' if fixture_url else 'isolated in-memory SQLite',actual_asgi=True,actual_async_session=True,actual_jwt=True,normal_startup=False,external_connections=False,database_disposed=True,results=results,observations=OBSERVATIONS)
    print(json.dumps(summary,indent=2));return 0 if summary['passed']==summary['total'] else 1
if __name__=='__main__':sys.exit(loop.run_until_complete(main()))
