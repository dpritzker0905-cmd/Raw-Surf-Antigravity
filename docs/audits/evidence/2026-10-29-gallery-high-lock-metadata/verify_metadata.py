"""Read-only quote metadata using actual API, disposable DB and positive JWTs."""
from pathlib import Path
import importlib.util,sys,json,uuid
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('cent_fixture',ROOT/'docs/audits/evidence/2026-10-29-gallery-cent-parity/verify_pricing.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
if '--baseline' in sys.argv:
    exec(compile((Path(__file__).parent/'baseline_pricing_resolver.py').read_text(encoding='utf-8-sig'),'baseline_pricing_resolver.py','exec'),f.pricing_resolver.__dict__)
    f.gallery_pricing.resolve_item_pricing=f.pricing_resolver.resolve_item_pricing
CASES=[('web','web',False,False),('standard','standard',False,False),('high_only','high',False,False),('no_lock',None,False,False),('zero_locks','zero',False,False),('high_subcent','high',False,False),('high_included','high',True,False),('participant_high','participant',False,False),('high_purchased','high',False,True)]
async def run(client,row):
    name,lock,included,purchased=row;buyer,seller,item_id,gallery_id,session_id=[str(uuid.uuid4()) for _ in range(5)];context=included or lock=='participant'
    async with f.database.AsyncSessionLocal() as s:
        s.add_all([f.Profile(id=buyer,user_id=buyer,email=buyer+'@example.invalid',full_name='Fictional Buyer',role=f.RoleEnum.SURFER,credit_balance=100,spend_only_credits=8),f.Profile(id=seller,user_id=seller,email=seller+'@example.invalid',full_name='Fictional Seller',role=f.RoleEnum.PHOTOGRAPHER,credit_balance=0,spend_only_credits=0)]);await s.flush()
        if context:
            s.add(f.LiveSession(id=session_id,photographer_id=seller,photos_included=1 if included else 0,session_photo_price=6));await s.flush()
            s.add(f.LiveSessionParticipant(photographer_id=seller,surfer_id=buyer,live_session_id=session_id,status='active',locked_price_high=1.239 if lock=='participant' else None))
        s.add(f.Gallery(id=gallery_id,photographer_id=seller,title='Fictional gallery',live_session_id=session_id if context else None));await s.flush()
        item=f.GalleryItem(id=item_id,photographer_id=seller,gallery_id=gallery_id,media_type='image',is_for_sale=True,original_url='https://fixture.invalid/original',preview_url='https://fixture.invalid/preview',price_web=9,price_standard=9,price_high=9)
        if lock in ('web','standard','high'):setattr(item,'locked_price_'+lock,0.004 if name=='high_subcent' else 2.675)
        elif lock=='zero':item.locked_price_web=item.locked_price_standard=item.locked_price_high=0
        s.add(item);await s.flush()
        if purchased:s.add(f.GalleryPurchase(gallery_item_id=item_id,buyer_id=buyer,photographer_id=seller,amount_paid=2.67,payment_method='credits',quality_tier='high'))
        await s.commit()
    async def snapshot():
        async with f.database.AsyncSessionLocal() as s:
            b=await s.get(f.Profile,buyer);seller_row=await s.get(f.Profile,seller);item_row=await s.get(f.GalleryItem,item_id)
            purchases=(await s.execute(f.select(f.GalleryPurchase).where(f.GalleryPurchase.gallery_item_id==item_id))).scalars().all();ledger=(await s.execute(f.select(f.CreditTransaction).where(f.CreditTransaction.user_id.in_([buyer,seller])))).scalars().all()
            return (b.credit_balance,b.spend_only_credits,seller_row.credit_balance,item_row.purchase_count,len(purchases),len(ledger))
    before=await snapshot();headers={'Authorization':'Bearer '+f.create_access_token({'sub':buyer,'role':f.RoleEnum.SURFER.value})}
    response=await client.get('/api/gallery/item/'+item_id+'/pricing?viewer_id='+buyer,headers=headers);assert response.status_code==200
    body=response.json();tier=next(t for t in body['pricing']['tiers'] if t['tier']==('web' if lock=='web' else 'standard' if lock=='standard' else 'high'))
    expected_locked=lock not in (None,'zero');source='free_from_buyin' if included else 'participant_locked' if lock=='participant' else 'item_locked' if expected_locked else 'general';price=0 if included or name=='high_subcent' else 1.24 if lock=='participant' else 2.67 if expected_locked else 9
    assert tier['price_source']==source and tier['price']==price and tier['is_purchased']==purchased
    assert await snapshot()==before,'Quote mutated wallet or purchase state'
    assert body['has_locked_pricing']==expected_locked,(name,body['has_locked_pricing'],source,price)
    return dict(locked=body['has_locked_pricing'],source=source,price=price,purchased=purchased)
async def main():
    await f.initialize();results=[]
    async with f.httpx.AsyncClient(transport=f.httpx.ASGITransport(app=f.app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
        for row in CASES:
            try:observed=await run(client,row);passed=True;error=None
            except Exception as e:observed=None;passed=False;error=type(e).__name__+': '+str(e)[:130]
            results.append(dict(case=row[0],passed=passed,error=error,observed=observed));print(('PASS ' if passed else 'FAIL ')+row[0]+(' '+error if error else ''),flush=True)
    await f.database.engine.dispose();summary=dict(passed=sum(r['passed'] for r in results),total=len(results),results=results,actual_asgi=True,actual_async_session=True,actual_jwt=True,quote_only=True,external_calls=False,normal_startup=False,database_disposed=True);print(json.dumps(summary,indent=2));return summary['passed']==summary['total']
if __name__=='__main__':
    try:ok=f.loop.run_until_complete(main())
    finally:f.loop.close()
    raise SystemExit(0 if ok else 1)
