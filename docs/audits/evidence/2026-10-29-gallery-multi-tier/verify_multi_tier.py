"""Ordinary gallery use by a buyer owning one or two legitimate quality tiers."""
from pathlib import Path
import importlib.util,sys,json,uuid,types
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('cent_fixture',ROOT/'docs/audits/evidence/2026-10-29-gallery-cent-parity/verify_pricing.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
# Unused sale collaborators remain local no-ops; no storage, watermark or push service is contacted.
setattr(sys.modules['services.watermark'],'watermark_image_from_url',f.noop)
sync=types.ModuleType('services.gallery_sync')
for name in ['distribute_gallery_item_to_participants','manually_assign_item_to_surfer','safe_delete_gallery_item']:setattr(sync,name,f.noop)
sys.modules[sync.__name__]=sync
from routes.gallery import sales
if '--baseline' in sys.argv:
    for module,name in [(sales,'sales.py'),(f.gallery_purchases,'gallery_purchases.py')]:
        exec(compile((Path(__file__).parent/('baseline_'+name)).read_text(encoding='utf-8-sig'),'baseline_'+name,'exec'),module.__dict__)
async def no_watermark(*a,**k):raise AssertionError('Owned preview should not generate a watermark')
f.gallery_purchases.generate_watermarked_preview=no_watermark
app=f.FastAPI();app.include_router(f.gallery_pricing.router,prefix='/api');app.include_router(f.gallery_purchases.router,prefix='/api');app.include_router(sales.router,prefix='/api')
CASES=[('bulk_single',False),('bulk_multiple',True),('preview_single',False),('preview_multiple',True),('download_single',False),('download_multiple',True),('download_explicit_web_multiple',True),('quote_multiple',True),('download_price_order_multiple',True)]
async def run(client,name,multiple):
    buyer,seller,gallery_id,item_id=[str(uuid.uuid4()) for _ in range(4)]
    async with f.database.AsyncSessionLocal() as session:
        session.add_all([f.Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',full_name='Fictional Buyer',role=f.RoleEnum.SURFER,credit_balance=100,spend_only_credits=8),f.Profile(id=seller,user_id=seller,email=seller+'@example.invalid',full_name='Fictional Seller',role=f.RoleEnum.PHOTOGRAPHER,credit_balance=0,spend_only_credits=0)]);await session.flush()
        session.add(f.Gallery(id=gallery_id,photographer_id=seller,title='Fictional Gallery'));await session.flush()
        session.add(f.GalleryItem(id=item_id,photographer_id=seller,gallery_id=gallery_id,media_type='image',title='Fictional Item',is_for_sale=True,price_web=3,price_standard=5,price_high=10,original_url='https://fixture.invalid/high',preview_url='https://fixture.invalid/preview',url_web='https://fixture.invalid/web',url_standard='https://fixture.invalid/standard'));await session.flush()
        price_order=name=='download_price_order_multiple'
        session.add(f.GalleryPurchase(gallery_item_id=item_id,buyer_id=buyer,photographer_id=seller,quality_tier='web',amount_paid=12 if price_order else 3,payment_method='credits',download_count=0,max_downloads=10))
        if multiple:session.add(f.GalleryPurchase(gallery_item_id=item_id,buyer_id=buyer,photographer_id=seller,quality_tier='high',amount_paid=6 if price_order else 10,payment_method='credits',download_count=0,max_downloads=10))
        await session.commit()
    async def snapshot():
        async with f.database.AsyncSessionLocal() as session:
            b=await session.get(f.Profile,buyer);s=await session.get(f.Profile,seller);item=await session.get(f.GalleryItem,item_id)
            purchases=(await session.execute(f.select(f.GalleryPurchase).where(f.GalleryPurchase.gallery_item_id==item_id).order_by(f.GalleryPurchase.quality_tier))).scalars().all()
            ledger=(await session.execute(f.select(f.CreditTransaction).where(f.CreditTransaction.user_id.in_([buyer,seller])))).scalars().all()
            notifications=(await session.execute(f.select(f.Notification).where(f.Notification.user_id.in_([buyer,seller])))).scalars().all()
            xp=(await session.execute(f.select(f.XPTransaction).where(f.XPTransaction.user_id.in_([buyer,seller])))).scalars().all()
            return dict(wallets=(b.credit_balance,b.spend_only_credits,s.credit_balance,s.spend_only_credits),item_count=item.purchase_count,purchases=[(p.id,p.quality_tier,p.amount_paid,p.download_count,p.max_downloads) for p in purchases],ledger=len(ledger),notifications=len(notifications),xp=len(xp))
    before=await snapshot();headers={'Authorization':'Bearer '+f.create_access_token({'sub':buyer,'role':f.RoleEnum.SURFER.value})}
    if name.startswith('bulk'):
        response=await client.post('/api/gallery/bulk-purchase',headers=headers,json=dict(item_ids=[item_id],quality_tiers={item_id:'standard'},buyer_id=buyer));expected=400
    elif name.startswith('preview'):
        response=await client.get('/api/gallery/watermarked-preview/'+item_id,headers=headers);expected=200
    elif name=='quote_multiple':
        response=await client.get('/api/gallery/item/'+item_id+'/pricing?viewer_id='+buyer,headers=headers);expected=200
    else:
        suffix='&quality=web' if name=='download_explicit_web_multiple' else ''
        response=await client.get('/api/gallery/download/'+item_id+'?buyer_id='+buyer+suffix,headers=headers);expected=200
    after=await snapshot();assert response.status_code==expected,(name,response.status_code,expected)
    if name.startswith('bulk'):
        assert 'already purchased' in response.json()['detail'].lower();assert before==after,'Already purchased rejection mutated data'
    elif name.startswith('preview'):
        assert response.json()==dict(preview_url='https://fixture.invalid/preview',is_watermarked=False,access_type='purchased');assert before==after
    elif name=='quote_multiple':
        flags={row['tier']:row['is_purchased'] for row in response.json()['pricing']['tiers']};assert flags=={'web':True,'standard':False,'high':True};assert before==after
    else:
        selected='web' if not multiple or name in ('download_explicit_web_multiple','download_price_order_multiple') else 'high'
        body=response.json();assert body['quality_tier']==selected and body['download_url']=='https://fixture.invalid/'+selected and body['downloads_remaining']==9
        expected_rows=[tuple(list(row[:3])+[row[3]+(1 if row[1]==selected else 0),row[4]]) for row in before['purchases']]
        assert after['purchases']==expected_rows,'Download updated wrong purchase or multiple rows'
        before['purchases']=expected_rows;assert before==after,'Download changed unrelated stored state'
    return dict(http_status=response.status_code,purchase_tiers=2 if multiple else 1,download_tier=response.json().get('quality_tier'))
async def main():
    await f.initialize();results=[]
    async with f.httpx.AsyncClient(transport=f.httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
        for name,multiple in CASES:
            try:observed=await run(client,name,multiple);passed=True;error=None
            except Exception as e:observed=None;passed=False;error=type(e).__name__+': '+str(e)[:160]
            results.append(dict(case=name,passed=passed,error=error,observed=observed));print(('PASS ' if passed else 'FAIL ')+name+(' '+error if error else ''),flush=True)
    await f.database.engine.dispose();summary=dict(passed=sum(r['passed'] for r in results),total=len(results),results=results,actual_asgi=True,actual_jwt=True,actual_async_session=True,database='owned loopback PostgreSQL' if f.fixture_url else 'in-memory SQLite',external_calls=False,normal_startup=False,security_probes=False,database_disposed=True);print(json.dumps(summary,indent=2));return summary['passed']==summary['total']
if __name__=='__main__':
    try:ok=f.loop.run_until_complete(main())
    finally:f.loop.close()
    raise SystemExit(0 if ok else 1)
