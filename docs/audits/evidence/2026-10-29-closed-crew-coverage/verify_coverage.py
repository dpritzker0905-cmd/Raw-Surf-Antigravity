"""Closed dispatch coverage regression: actual routes and disposable async storage."""
from pathlib import Path
import importlib.util,sys,json
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('coverage_fixture',ROOT/'docs/audits/evidence/2026-10-29-crew-card-fulfillment/verify_backend.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
from routes.dispatch import progress
if '--baseline' in sys.argv:
    exec(compile((Path(__file__).parent/'baseline_progress.py').read_text(encoding='utf-8-sig'),'baseline_progress.py','exec'),progress.__dict__)
f.app.include_router(progress.router,prefix='/api')
async def snapshot(case):
    async with f.database.AsyncSessionLocal() as session:
        captain=await session.get(f.Profile,case['captain']);payer=await session.get(f.Profile,case['buyer'])
        dispatch=await session.get(f.DispatchRequest,case['dispatch'])
        crew=(await session.execute(f.select(f.DispatchRequestParticipant).where(f.DispatchRequestParticipant.dispatch_request_id==case['dispatch']).order_by(f.DispatchRequestParticipant.id))).scalars().all()
        ledger=(await session.execute(f.select(f.CreditTransaction).where(f.CreditTransaction.user_id.in_([case['captain'],case['buyer']])).order_by(f.CreditTransaction.id))).scalars().all()
        return dict(captain=(captain.credit_balance,captain.spend_only_credits,captain.withdrawable_credits),payer=(payer.credit_balance,payer.spend_only_credits),
                    dispatch=(dispatch.status,dispatch.deposit_paid,dispatch.all_participants_paid,dispatch.all_participants_paid_at),
                    crew=[(p.id,p.paid,p.status,p.paid_at,p.payer_name,p.share_amount) for p in crew],
                    ledger=[(t.id,t.user_id,t.amount,t.spend_only_amount,t.balance_before,t.balance_after,t.reference_type,t.reference_id) for t in ledger])
async def run(client,kind,deposit=True):
    case=await f.seed_case('normal',deposit=deposit)
    async with f.database.AsyncSessionLocal() as session:
        dispatch=await session.get(f.DispatchRequest,case['dispatch'])
        if kind.startswith('closed_'):
            dispatch.status=getattr(f.DispatchRequestStatusEnum,kind[len('closed_'):]);dispatch.all_participants_paid=True
        elif kind=='already_paid':
            part=await session.get(f.DispatchRequestParticipant,case['participant']);part.paid=True;part.status='paid'
        elif kind=='insufficient':
            captain=await session.get(f.Profile,case['captain']);captain.credit_balance=1;captain.spend_only_credits=0
        elif kind=='multiple':
            import uuid
            session.add(f.DispatchRequestParticipant(id=str(uuid.uuid4()),dispatch_request_id=case['dispatch'],participant_id=case['buyer'],share_amount=7.25,paid=False,status='invited'))
        await session.commit()
    before=await snapshot(case)
    if kind=='commit_failure':f.context.update(mode='fulfill_fail',phase='fulfill')
    headers={'Authorization':'Bearer '+f.create_access_token({'sub':case['captain'],'role':f.RoleEnum.SURFER.value})}
    url='/api/dispatch/'+case['dispatch']+'/cover-remaining';response=await client.post(url,headers=headers,json={'captain_id':case['captain']})
    after=await snapshot(case);expected=409 if kind.startswith('closed_') else 400 if kind=='insufficient' else 500 if kind=='commit_failure' else 200
    assert response.status_code==expected,(response.status_code,expected,dict(captain_before=before['captain'][0],captain_after=after['captain'][0],new_ledger_rows=len(after['ledger'])-len(before['ledger'])))
    if kind.startswith('closed_') or kind in ('insufficient','commit_failure','already_paid'):
        assert before==after,'Refused or no-op coverage changed stored state'
        if kind.startswith('closed_'):assert 'no new crew payment' in response.json()['detail'].lower()
    else:
        charge=19.75 if kind=='multiple' else 12.5
        assert after['captain']==(40-charge,0,0) and after['payer']==(20,8)
        assert all(p[1] and p[2]=='paid' for p in after['crew'])
        assert len(after['ledger'])==1 and after['ledger'][0][1:4]==(case['captain'],-charge,-5)
        assert after['dispatch'][0:2]==before['dispatch'][0:2]
        replay=await client.post(url,headers=headers,json={'captain_id':case['captain']});assert replay.status_code==200 and replay.json()['amount_covered']==0
        assert await snapshot(case)==after,'Replay repeated coverage debit'
    return response.status_code
async def main():
    await f.initialize();results=[]
    cases=[('closed_'+s,d) for s in ('CANCELLED','REFUNDED','NO_PRO_FOUND') for d in (False,True)]+[('active',True),('active',False),('already_paid',True),('insufficient',True),('commit_failure',True),('multiple',True)]
    async with f.httpx.AsyncClient(transport=f.httpx.ASGITransport(app=f.app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
        for kind,deposit in cases:
            try:status=await run(client,kind,deposit);passed=True;error=None
            except Exception as e:status=None;passed=False;error=type(e).__name__+': '+str(e)[:100]
            results.append(dict(case=kind,captain_deposit_paid=deposit,passed=passed,http_status=status,error=error));print(('PASS ' if passed else 'FAIL ')+kind+'/'+str(deposit)+(' '+error if error else ''),flush=True)
    await f.database.engine.dispose();summary=dict(passed=sum(r['passed'] for r in results),total=len(results),results=results,actual_asgi=True,actual_jwt=True,actual_async_session=True,database='owned loopback PostgreSQL' if f.fixture_url else 'in-memory SQLite',external_calls=False,normal_startup=False,database_disposed=True)
    print(json.dumps(summary,indent=2));return summary['passed']==summary['total']
if __name__=='__main__':
    try:ok=f.loop.run_until_complete(main())
    finally:f.loop.close()
    raise SystemExit(0 if ok else 1)
