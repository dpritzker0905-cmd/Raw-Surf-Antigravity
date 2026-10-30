"""Gallery cent parity through actual routes, async storage and wallet utilities."""
import os,sys,uuid,asyncio,socket,types,json,logging
from pathlib import Path
from datetime import datetime,timezone,timedelta
from urllib.parse import urlsplit
loop=asyncio.new_event_loop();asyncio.set_event_loop(loop)
fixture_url=os.environ.get('CHECKOUT_FIXTURE_DATABASE_URL') if '--pg' in sys.argv else None
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
for name in ('routes','routes.gallery','routes.subscriptions_billing'):
    module=types.ModuleType(name);module.__path__=[str(ROOT/'backend'/name.replace('.','/'))];sys.modules[name]=module
async def noop(*a,**k):return None
for name,symbol in [('routes.career_hub.gamification','check_badge_milestones'),('websocket_manager','broadcast_earnings_update'),('services.watermark','generate_watermarked_preview')]:
    module=types.ModuleType(name);setattr(module,symbol,noop);sys.modules[name]=module
from fastapi import FastAPI
import database,httpx
from sqlalchemy import select
from models import Profile,RoleEnum,Gallery,GalleryItem,GalleryPurchase,CreditTransaction,Notification,XPTransaction,SurferPhotoSubscription,GlobalPricingConfig,LiveSession,LiveSessionParticipant
from core.security import create_access_token
from routes.gallery import pricing_resolver
if '--baseline' in sys.argv:exec(compile((Path(__file__).parent/'baseline_pricing_resolver.py').read_text(encoding='utf-8-sig'),'baseline_pricing_resolver.py','exec'),pricing_resolver.__dict__)
from routes.gallery import gallery_pricing,gallery_purchases
if '--baseline' in sys.argv:exec(compile((Path(__file__).parent/'baseline_gallery_purchases.py').read_text(encoding='utf-8-sig'),'baseline_gallery_purchases.py','exec'),gallery_purchases.__dict__)
app=FastAPI();app.include_router(gallery_pricing.router,prefix='/api');app.include_router(gallery_purchases.router,prefix='/api')
CASES=[
 ('photo_fraction','item',1.239,1.24,'web',100,False),
 ('photo_half_even','item',2.675,2.67,'standard',100,False),
 ('photo_general','photographer',2.675,2.67,'high',100,False),
 ('photo_gallery','gallery',9.999,10.00,'web',100,False),
 ('photo_item_locked','item_locked',7.999,8.00,'standard',100,False),
 ('photo_participant_locked','participant_locked',1.005,1.00,'high',100,False),
 ('photo_session_override','session',6.666,6.67,'web',100,False),
 ('photo_buyin_free','included',9.999,0.00,'web',100,True),
 ('photo_quota','item',9.999,10.00,'web',100,True),
 ('video_720_fraction','video',1.239,1.24,'720p',100,False),
 ('video_1080_half','video',2.675,2.67,'1080p',100,False),
 ('video_4k_fraction','video',7.999,8.00,'4k',100,False),
 ('video_quota','video',9.999,10.00,'720p',100,True),
 ('photo_subcent_zero','item',0.004,0.00,'web',0,True),
 ('video_subcent_zero','video',0.004,0.00,'720p',0,True),
 ('photo_halfcent','item',0.005,0.01,'web',1,False),
 ('subcent_item_lock','item_locked',0.004,0.00,'web',0,True),
 ('subcent_participant_lock','participant_locked',0.004,0.00,'standard',0,True),
 ('subcent_session_override','session',0.004,0.00,'high',0,True),
 ('exact_balance','item',2.675,2.67,'web',2.67,False),
 ('insufficient_balance','item',2.675,2.67,'web',2.66,False),
 ('photo_whole_cent_control','item',2.00,2.00,'web',100,False),
 ('video_whole_cent_control','video',8.00,8.00,'720p',100,False),
]
async def initialize():
    models=[Profile,Gallery,GalleryItem,GalleryPurchase,CreditTransaction,Notification,XPTransaction,SurferPhotoSubscription,GlobalPricingConfig,LiveSession,LiveSessionParticipant]
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
OBSERVATIONS={}
async def run(client,row):
    name,source,raw,quoted,tier,balance,quota=row;buyer,seller,item_id,gallery_id,session_id,sub_id=[str(uuid.uuid4()) for _ in range(6)]
    promo=min(8,balance);video=source=='video';session_context=source in ('participant_locked','session','included');field={'web':'price_web','standard':'price_standard','high':'price_high','720p':'price_720p','1080p':'price_1080p','4k':'price_4k'}[tier]
    async with database.AsyncSessionLocal() as session:
        seller_row=Profile(id=seller,user_id=seller,email=seller+'@example.invalid',full_name='Fictional Seller',role=RoleEnum.PHOTOGRAPHER,subscription_tier='basic',credit_balance=0,spend_only_credits=0,withdrawable_credits=0,photo_price_web=3,photo_price_standard=5,photo_price_high=10,video_price_720p=8,video_price_1080p=15,video_price_4k=30)
        if source=='photographer':setattr(seller_row,'photo_'+field,raw)
        session.add_all([Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',full_name='Fictional Buyer',role=RoleEnum.SURFER,credit_balance=balance,spend_only_credits=promo,withdrawable_credits=0),seller_row]);await session.flush()
        if session_context:
            session.add(LiveSession(id=session_id,photographer_id=seller,session_photo_price=raw,photo_price=raw,photos_included=1 if source=='included' else 0));await session.flush()
            member=LiveSessionParticipant(photographer_id=seller,surfer_id=buyer,live_session_id=session_id,status='active')
            if source=='participant_locked':setattr(member,'locked_'+field,raw)
            session.add(member)
        gallery=Gallery(id=gallery_id,photographer_id=seller,title='Fictional gallery',live_session_id=session_id if session_context else None)
        if source=='gallery':setattr(gallery,field,raw)
        session.add(gallery);await session.flush()
        item=GalleryItem(id=item_id,photographer_id=seller,gallery_id=gallery_id,media_type='video' if video else 'image',title='Fictional item',is_for_sale=True,original_url='https://fixture.invalid/original',preview_url='https://fixture.invalid/preview')
        if source in ('item','video'):setattr(item,field,raw)
        if source=='item_locked':setattr(item,'locked_'+field,raw)
        if source=='included':setattr(item,field,raw)
        session.add(item)
        if quota:session.add(SurferPhotoSubscription(id=sub_id,surfer_id=buyer,photographer_id=seller,status='active',expires_at=datetime.now(timezone.utc)+timedelta(days=1),photos_remaining=3,videos_remaining=3,amount_paid=20,payment_method='credits'))
        await session.commit()
    headers={'Authorization':'Bearer '+create_access_token({'sub':buyer,'role':RoleEnum.SURFER.value})};url='/api/gallery/item/'+item_id
    response=await client.get(url+'/pricing?viewer_id='+buyer,headers=headers);assert response.status_code==200,(name,response.status_code)
    quote=response.json();selected=next(t for t in quote['pricing']['tiers'] if t['tier']==tier)
    issues=[]
    if selected['price']!=quoted:issues.append(('quote',selected['price'],quoted))
    if not video:
        assert selected['price_source']=={'included':'free_from_buyin','item_locked':'item_locked','participant_locked':'participant_locked','session':'session_override'}.get(source,'general')
        assert quote['is_free_from_session']==(source=='included')
    for t in quote['pricing']['tiers']:
        for key in ('price','general_price'):
            if key in t and t[key]!=round(t[key],2):issues.append((key,t[key],'fractional cent'))
    if source=='session' and quote['session_price_override']!=quoted:issues.append(('session override',quote['session_price_override'],quoted))
    charged=0 if quota else quoted
    result=await client.post(url+'/purchase?buyer_id='+buyer,headers=headers,json={'quality_tier':tier,'payment_method':'credits'})
    if name=='insufficient_balance':
        assert result.status_code==400
        async with database.AsyncSessionLocal() as session:
            assert not (await session.execute(select(GalleryPurchase).where(GalleryPurchase.gallery_item_id==item_id))).scalars().all()
            b=await session.get(Profile,buyer);assert (b.credit_balance,b.spend_only_credits)==(balance,promo)
        OBSERVATIONS[name]=dict(quote=selected['price'],expected_quote=quoted,purchase_http_status=result.status_code,balance_before=balance,balance_after=b.credit_balance)
        assert not issues,issues
        return
    assert result.status_code==200,(name,result.status_code,result.text[:100]);answer=result.json()
    async with database.AsyncSessionLocal() as session:
        purchase=(await session.execute(select(GalleryPurchase).where(GalleryPurchase.gallery_item_id==item_id))).scalar_one();b=await session.get(Profile,buyer);s=await session.get(Profile,seller)
        ledger=(await session.execute(select(CreditTransaction).where(CreditTransaction.reference_type=='gallery_item',CreditTransaction.reference_id==item_id))).scalars().all()
        OBSERVATIONS[name]=dict(quote=selected['price'],response_amount_paid=answer['amount_paid'],persisted_amount_paid=purchase.amount_paid,balance_before=balance,balance_after=b.credit_balance,actual_buyer_debit=round(balance-b.credit_balance,2),buyer_ledger=[t.amount for t in ledger if t.user_id==buyer],seller_ledger=[t.amount for t in ledger if t.user_id==seller])
        assert answer['amount_paid']==charged,(name,'response paid',answer['amount_paid'],charged)
        expected_net=round(charged*0.8,2)
        assert purchase.amount_paid==charged and round(balance-b.credit_balance,2)==charged,(name,'persisted/debit',purchase.amount_paid,b.credit_balance,charged)
        assert b.spend_only_credits==round(promo-min(promo,charged),2)
        assert s.credit_balance==expected_net and s.withdrawable_credits==expected_net
        if charged:
            assert len(ledger)==2;debit=next(t for t in ledger if t.user_id==buyer);credit=next(t for t in ledger if t.user_id==seller)
            assert debit.amount==-charged and credit.amount==expected_net
        else:assert all(t.amount==0 for t in ledger)
        if quota:
            sub=await session.get(SurferPhotoSubscription,sub_id);expected_remaining=2 if quoted and source!='included' else 3
            assert (sub.videos_remaining if video else sub.photos_remaining)==expected_remaining,(name,'quota',expected_remaining)
    replay_quote=await client.get(url+'/pricing?viewer_id='+buyer,headers=headers);assert next(t for t in replay_quote.json()['pricing']['tiers'] if t['tier']==tier)['is_purchased'] is True
    assert not issues,issues
async def main():
    await initialize();results=[]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
        for row in CASES:
            try:await run(client,row);ok=True;error=None
            except Exception as e:ok=False;error=type(e).__name__+': '+str(e)[:190]
            results.append(dict(case=row[0],passed=ok,error=error,observed=OBSERVATIONS.get(row[0])));print(('PASS ' if ok else 'FAIL ')+row[0]+(' '+error if error else ''),flush=True)
    await database.engine.dispose();summary=dict(passed=sum(r['passed'] for r in results),total=len(results),results=results,actual_asgi=True,actual_jwt=True,actual_async_session=True,actual_credit_utilities=True,database='disposable-loopback-PostgreSQL' if fixture_url else 'in-memory SQLite',provider_calls=False,external_calls=False,normal_startup=False,database_disposed=True);print(json.dumps(summary,indent=2));return summary['passed']==summary['total']
if __name__=='__main__':
    try:ok=loop.run_until_complete(main())
    finally:loop.close()
    raise SystemExit(0 if ok else 1)
