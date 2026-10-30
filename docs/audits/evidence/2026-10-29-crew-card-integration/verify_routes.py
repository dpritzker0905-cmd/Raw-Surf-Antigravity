"""Actual crew generic-status/webhook routing; disposable DB and positive event doubles."""
from pathlib import Path
import importlib.util,sys,json,asyncio,types
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('crew_fixture',ROOT/'docs/audits/evidence/2026-10-29-crew-card-fulfillment/verify_backend.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
package=types.ModuleType('routes.subscriptions_billing');package.__path__=[str(ROOT/'backend/routes/subscriptions_billing')];sys.modules[package.__name__]=package
from routes.subscriptions_billing import payments
from routes.dispatch import progress
from utils.payment_fulfillment import wallet_credit_amount,fulfill_wallet_payment
f.app.include_router(payments.router,prefix='/api');f.app.include_router(progress.router,prefix='/api')
async def positive_event(self,body,signature):
    return payments.WebhookResponse('checkout.session.completed',f.context['webhook_session'],'paid',{'data':{'object':{'id':f.context['webhook_session']}}})
payments.StripeCheckout.handle_webhook=positive_event
async def request(client,case,key,kind):
    f.context['phase']='fulfill'
    if kind=='webhook':
        f.context['webhook_session']=key
        return await client.post('/api/webhook/stripe',content='{}',headers={'content-type':'application/json','stripe-signature':'fictional_positive_event'})
    return await client.get('/api/payments/checkout/status/'+key,headers=case['headers'])
async def create_paid(client,case):
    response=await f.checkout_case(client,case);assert response.status_code==200,(response.status_code,response.text)
    key=response.json()['session_id'];f.provider[key].status='complete';f.provider[key].payment_status='paid';return key
async def run_case(client,kind,mode):
    case=await f.seed_case(mode);key=await create_paid(client,case)
    if mode in ('repriced','closed','refund'):
        async with f.database.AsyncSessionLocal() as session:
            if mode=='repriced':await session.execute(f.update(f.DispatchRequestParticipant).where(f.DispatchRequestParticipant.id==case['participant']).values(share_amount=15))
            elif mode=='closed':await session.execute(f.update(f.DispatchRequest).where(f.DispatchRequest.id==case['dispatch']).values(status=f.DispatchRequestStatusEnum.CANCELLED))
            else:await session.execute(f.update(f.PaymentTransaction).where(f.PaymentTransaction.session_id==key).values(payment_status='partially_refunded',status='refunded'))
            await session.commit()
    if mode=='wallet_skip':
        async with f.database.AsyncSessionLocal() as session:
            tx=(await session.execute(f.select(f.PaymentTransaction).where(f.PaymentTransaction.session_id==key))).scalar_one()
            assert wallet_credit_amount(tx) is None
            result=await fulfill_wallet_payment(session,tx);assert result==(0.0,None);await session.commit()
        state=await f.read_case(case);assert not state['paid'] and not state['ledger'] and state['balance']==20 and state['promo']==8
    response=await request(client,case,key,kind)
    if mode in ('fulfill_fail','fulfill_ack','provider_unavailable'):
        assert response.status_code==503,(kind,mode,response.status_code,response.text)
        state=await f.read_case(case)
        if mode!='fulfill_ack':assert not state['paid'] and not state['ledger'] and state['payments'][0]['status']=='pending'
        else:assert state['paid'] and len(state['ledger'])==1
        f.context['mode']='normal';response=await request(client,case,key,kind)
    assert response.status_code==200,(kind,mode,response.status_code,response.text)
    state=await f.read_case(case)
    expected='review_required' if mode in ('repriced','closed') else 'partially_refunded' if mode=='refund' else 'completed'
    if kind=='status':assert response.json()['status']==expected,response.text
    else:assert response.json()['status']=='received'
    if expected=='completed':
        assert state['paid'] and state['participant_status']=='paid' and state['funded']
        assert state['payments'][0]['status']=='completed' and state['payments'][0]['raw']=='paid'
        assert len(state['ledger'])==1 and state['ledger'][0]['amount']==state['ledger'][0]['promo']==0
        reads=len(f.context['retrieved']);again=await request(client,case,key,kind);assert again.status_code==200
        assert len(f.context['retrieved'])==reads and len((await f.read_case(case))['ledger'])==1
    else:
        assert not state['paid'] and not state['ledger']
        if expected=='partially_refunded':assert state['payments'][0]['raw']=='partially_refunded' and not f.context['retrieved']
        else:assert state['payments'][0]['raw']=='paid' and state['payments'][0]['status']=='review_required'
    assert state['balance']==20 and state['promo']==8 and state['captain_balance']==40
    assert len(f.context['created'])==1 and not f.context['expired']
async def concurrency_case(client,mode):
    case=await f.seed_case();key=await create_paid(client,case)
    async def card(which=key):return await request(client,case,which,'status')
    if mode=='same_receipt':
        responses=await asyncio.gather(card(),card());assert [x.status_code for x in responses]==[200,200]
        assert all(x.json()['status']=='completed' for x in responses)
    elif mode=='distinct_receipts':
        extra=await create_paid(client,case);responses=await asyncio.gather(card(),card(extra))
        assert all(x.status_code==200 for x in responses);assert sorted(x.json()['status'] for x in responses)==['completed','review_required']
    elif mode=='card_credit':
        f.context['phase']='fulfill'
        responses=await asyncio.gather(card(),client.post('/api/dispatch/crew-invite/'+case['participant']+'/pay?payer_id='+case['buyer'],headers=case['headers'],json={}))
        assert responses[0].status_code==200 and responses[1].status_code in (200,400),(responses[0].text,responses[1].text)
        state=await f.read_case(case)
        if responses[0].json()['status']=='completed':assert responses[1].status_code==400 and state['balance']==20
        else:assert responses[0].json()['status']=='review_required' and responses[1].status_code==200 and state['balance']==7.5
    elif mode=='card_cover':
        headers={'Authorization':'Bearer '+f.create_access_token({'sub':case['captain'],'role':f.RoleEnum.SURFER.value})}
        responses=await asyncio.gather(card(),client.post('/api/dispatch/'+case['dispatch']+'/cover-remaining',headers=headers,json={'captain_id':case['captain']}))
        assert all(x.status_code==200 for x in responses),(responses[0].text,responses[1].text)
        state=await f.read_case(case)
        if responses[0].json()['status']=='completed':assert responses[1].json()['amount_covered']==0 and state['captain_balance']==40
        else:assert responses[0].json()['status']=='review_required' and responses[1].json()['amount_covered']==12.5 and state['captain_balance']==27.5
    state=await f.read_case(case);assert state['paid'] and state['participant_status']=='paid'
    assert len(state['ledger'])<=1 and state['promo'] in (8,0)
    assert sum(row['status']=='completed' for row in state['payments'])<=1
async def main():
    await f.initialize();results=[]
    async with f.httpx.AsyncClient(transport=f.httpx.ASGITransport(app=f.app,raise_app_exceptions=False),base_url='http://fixture.invalid') as client:
        for kind in ('status','webhook'):
            for mode in ('normal','wallet_skip','repriced','closed','refund','fulfill_fail','fulfill_ack','provider_unavailable'):
                try:await run_case(client,kind,mode);ok=True;error=None
                except Exception as exc:ok=False;error=type(exc).__name__+': '+str(exc)[:180]
                results.append(dict(kind=kind,mode=mode,passed=ok,error=error));print(('PASS ' if ok else 'FAIL ')+kind+'/'+mode+(' '+error if error else ''),flush=True)
        if f.fixture_url:
            for mode in ('same_receipt','distinct_receipts','card_credit','card_cover'):
                try:await asyncio.wait_for(concurrency_case(client,mode),30);ok=True;error=None
                except Exception as exc:ok=False;error=type(exc).__name__+': '+str(exc)[:180]
                results.append(dict(kind='postgresql_concurrency',mode=mode,passed=ok,error=error));print(('PASS ' if ok else 'FAIL ')+mode+(' '+error if error else ''),flush=True)
    await f.database.engine.dispose();summary=dict(passed=sum(x['passed'] for x in results),total=len(results),results=results,actual_asgi=True,positive_webhook_double=True,signature_testing=False,actual_async_session=True,database='owned loopback PostgreSQL' if f.fixture_url else 'in-memory SQLite',external_calls=False,normal_startup=False,database_disposed=True)
    print(json.dumps(summary,indent=2));return summary['passed']==summary['total']
if __name__=='__main__':
    try:ok=f.loop.run_until_complete(main())
    finally:f.loop.close()
    raise SystemExit(0 if ok else 1)
