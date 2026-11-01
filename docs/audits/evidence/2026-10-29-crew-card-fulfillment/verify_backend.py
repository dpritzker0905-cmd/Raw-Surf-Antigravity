"""Actual crew checkout/return routes with disposable data and provider doubles."""
import os, sys, uuid, asyncio, socket, types, json, logging
from urllib.parse import urlsplit
from pathlib import Path
loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
fixture_url = os.environ.get('CHECKOUT_FIXTURE_DATABASE_URL') if '--pg' in sys.argv else None
if fixture_url:
    parsed = urlsplit(fixture_url)
    assert parsed.hostname == '127.0.0.1' and parsed.scheme in ('postgresql+asyncpg', 'postgresql')
keep = {k: os.environ[k] for k in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH') if k in os.environ}
os.environ.clear(); os.environ.update(keep)
os.environ.update(TESTING='1', DATABASE_URL=fixture_url or 'sqlite+aiosqlite:///:memory:', PYTHON_DOTENV_DISABLED='1',
                  PYDANTIC_DISABLE_PLUGINS='__all__', SECRET_KEY=uuid.uuid4().hex, STRIPE_API_KEY='fictional_configured')
sys.dont_write_bytecode = True; logging.disable(logging.CRITICAL)
ROOT = Path(__file__).resolve().parents[4]; sys.path.insert(0, str(ROOT/'backend'))
def blocked(*a, **k): raise RuntimeError('External network disabled')
original_connect = socket.socket.connect
def fixture_connect(self, address):
    if fixture_url and address[0] == '127.0.0.1' and address[1] == parsed.port: return original_connect(self, address)
    return blocked()
socket.socket.connect = fixture_connect; socket.socket.connect_ex = socket.create_connection = blocked
import dotenv
dotenv.load_dotenv = lambda *a, **k: False
for name in ('routes', 'routes.dispatch'):
    module = types.ModuleType(name); module.__path__ = [str(ROOT/'backend'/name.replace('.', '/'))]; sys.modules[name] = module
async def noop(*a, **k): return None
alerts = types.ModuleType('utils.parental_alerts'); alerts.check_and_send_spending_alert = noop; sys.modules[alerts.__name__] = alerts
onesignal = types.ModuleType('services.onesignal_service'); onesignal.onesignal_service = types.SimpleNamespace(); sys.modules[onesignal.__name__] = onesignal
from fastapi import FastAPI
import httpx, database
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from models import Profile, RoleEnum, PaymentTransaction, DispatchRequest, DispatchRequestParticipant, DispatchRequestStatusEnum, CreditTransaction
from core.security import create_access_token
from routes.dispatch import crew as route
if '--baseline' in sys.argv:
    exec(compile((Path(__file__).parent/'baseline_crew.py').read_text(encoding='utf-8-sig'), 'baseline_crew.py', 'exec'), route.__dict__)
context = {'mode': 'normal', 'phase': 'seed', 'created': [], 'retrieved': [], 'expired': []}; provider = {}
class FaultSession(AsyncSession):
    async def commit(self):
        phase, mode = context.get('phase'), context.get('mode')
        if phase == 'checkout' and mode == 'checkout_fail': raise IntegrityError('Fictional constraint', {}, Exception())
        if phase == 'fulfill' and mode == 'fulfill_fail': raise RuntimeError('Fictional commit unavailable')
        if phase in ('checkout', 'fulfill') and mode == phase+'_ack' and not context.get('ack_raised'):
            await super().commit(); context['ack_raised'] = True; raise RuntimeError('Fictional lost acknowledgement')
        return await super().commit()
async def get_fault_db():
    async with FaultSession(bind=database.engine, expire_on_commit=False, autoflush=False) as session: yield session
app = FastAPI(); app.dependency_overrides[database.get_db] = get_fault_db; app.include_router(route.router, prefix='/api')
def create(**kwargs):
    key = 'fictional_crew_'+uuid.uuid4().hex
    provider[key] = types.SimpleNamespace(id=key, url='https://fixture.invalid/'+key, status='open', payment_status='unpaid',
        mode='payment', currency='usd', amount_total=kwargs['line_items'][0]['price_data']['unit_amount'], metadata=kwargs['metadata'],
        payment_intent='fictional_intent_'+uuid.uuid4().hex)
    context['created'].append(key); context['provider_quote'] = kwargs; return provider[key]
def retrieve(key):
    context['retrieved'].append(key)
    if context.get('mode') == 'provider_unavailable': raise RuntimeError('Fictional provider unavailable')
    return provider[key]
def expire(key):
    context['expired'].append(key); provider[key].status = 'expired'; return provider[key]
route.stripe.checkout.Session.create = create; route.stripe.checkout.Session.retrieve = retrieve; route.stripe.checkout.Session.expire = expire
async def initialize():
    async with database.engine.begin() as conn:
        models = [Profile, DispatchRequest, DispatchRequestParticipant, PaymentTransaction, CreditTransaction]
        if fixture_url:
            tables = {cls.__table__ for cls in models}
            while True:
                expanded = tables | {fk.column.table for table in tables for fk in table.foreign_keys}
                if expanded == tables: break
                tables = expanded
            await conn.run_sync(lambda sync: database.Base.metadata.create_all(sync, tables=list(tables)))
        else:
            for cls in models: await conn.run_sync(cls.__table__.create)
async def seed_case(name='normal', deposit=True):
    context.clear(); context.update(mode=name, phase='seed', created=[], retrieved=[], expired=[])
    buyer, captain, dispatch_id, participant_id = [str(uuid.uuid4()) for _ in range(4)]
    async with database.AsyncSessionLocal() as session:
        session.add_all([Profile(id=buyer, user_id=buyer, email=buyer+'@example.invalid', full_name='Fictional Crew', username='fictional_'+buyer[:8],
            role=RoleEnum.SURFER, credit_balance=20, spend_only_credits=8, withdrawable_credits=0),
            Profile(id=captain, user_id=captain, email=captain+'@example.invalid', full_name='Fictional Captain', role=RoleEnum.SURFER,
            credit_balance=40, spend_only_credits=5, withdrawable_credits=0)])
        await session.flush()
        session.add(DispatchRequest(id=dispatch_id, requester_id=captain, latitude=0, longitude=0, location_name='Fictional Beach',
            hourly_rate=100, estimated_duration_hours=1, estimated_total=100, deposit_amount=25, captain_share_amount=12.5,
            deposit_paid=deposit, is_shared=True, status=DispatchRequestStatusEnum.SEARCHING_FOR_PRO))
        await session.flush()
        session.add(DispatchRequestParticipant(id=participant_id, dispatch_request_id=dispatch_id, participant_id=buyer,
            share_amount=12.5, paid=False, status='invited')); await session.commit()
    headers = {'Authorization': 'Bearer '+create_access_token({'sub': buyer, 'role': RoleEnum.SURFER.value})}
    return dict(buyer=buyer, captain=captain, dispatch=dispatch_id, participant=participant_id, headers=headers)
async def checkout_case(client, case, selfie=False):
    context['phase'] = 'checkout'
    return await client.post('/api/dispatch/crew-invite/'+case['participant']+'/checkout?payer_id='+case['buyer'],
        headers=case['headers'], json=dict(origin_url='http://fixture.invalid', selfie_url='https://fixture.invalid/selfie.jpg' if selfie else None))
async def read_case(case):
    async with database.AsyncSessionLocal() as session:
        payer = await session.get(Profile, case['buyer']); captain = await session.get(Profile, case['captain'])
        participant = await session.get(DispatchRequestParticipant, case['participant']); dispatch = await session.get(DispatchRequest, case['dispatch'])
        payments = (await session.execute(select(PaymentTransaction).where(PaymentTransaction.user_id == case['buyer']))).scalars().all()
        ledger = (await session.execute(select(CreditTransaction).where(CreditTransaction.user_id == case['buyer']))).scalars().all()
        return dict(balance=payer.credit_balance, promo=payer.spend_only_credits, captain_balance=captain.credit_balance,
            paid=participant.paid, participant_status=participant.status, selfie=participant.selfie_url, intent=participant.stripe_payment_intent_id,
            payer_name=participant.payer_name, funded=dispatch.all_participants_paid,
            payments=[dict(id=tx.id, session=tx.session_id, status=tx.status, raw=tx.payment_status, metadata=tx.transaction_metadata) for tx in payments],
            ledger=[dict(amount=tx.amount, promo=tx.spend_only_amount, kind=tx.transaction_type, reference=tx.reference_id) for tx in ledger])
async def return_case(client, case, key):
    context['phase'] = 'fulfill'
    return await client.get('/api/dispatch/crew-payment/'+key, headers=case['headers'])
async def main():
    await initialize(); results = []
    modes = ['normal', 'selfie', 'pending', 'expired', 'replay', 'second_paid', 'credit_then_card', 'repriced', 'cancelled', 'declined',
             'amount_mismatch', 'currency_mismatch', 'mode_mismatch', 'metadata_mismatch', 'intent_missing', 'refund_terminal',
             'provider_unavailable', 'fulfill_fail', 'fulfill_ack', 'checkout_fail', 'checkout_ack', 'no_captain_deposit', 'replay_cancelled',
             'replay_orphan_ledger', 'raw_refund_partial', 'replay_dispatch_closed', 'decline_after_card', 'id_mismatch', 'credit_after_card', 'other_unpaid', 'profile_changed', 'refund_pending', 'refund_failed', 'refund_requested']
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url='http://fixture.invalid') as client:
        for mode in modes:
            errors = []
            try:
                case = await seed_case(mode, deposit=mode != 'no_captain_deposit')
                if mode == 'other_unpaid':
                    async with database.AsyncSessionLocal() as session:
                        session.add(DispatchRequestParticipant(id=str(uuid.uuid4()), dispatch_request_id=case['dispatch'], participant_id=case['captain'], share_amount=10, paid=False, status='invited')); await session.commit()
                response = await checkout_case(client, case, selfie=mode == 'selfie')
                if mode == 'checkout_fail':
                    assert response.status_code == 503 and response.headers.get('X-Checkout-Recovery') == 'closed'
                    state = await read_case(case); assert not state['payments'] and not state['paid'] and len(context['expired']) == 1
                else:
                    assert response.status_code == 200, 'checkout status '+str(response.status_code)
                    key = response.json()['session_id']; state = await read_case(case)
                    assert len(state['payments']) == 1 and not state['paid'] and not state['ledger'], 'No persisted pending crew receipt'
                    assert state['balance'] == 20 and state['promo'] == 8
                    assert '/dispatch/crew-payment/success?session_id=' in context['provider_quote']['success_url']
                    assert state['selfie'] is None, 'Selfie was committed before paid completion'
                    if mode not in ('pending', 'expired'): provider[key].status = 'complete'; provider[key].payment_status = 'paid'
                    if mode == 'expired': provider[key].status = 'expired'
                    if mode == 'amount_mismatch': provider[key].amount_total += 1
                    if mode == 'currency_mismatch': provider[key].currency = 'eur'
                    if mode == 'mode_mismatch': provider[key].mode = 'subscription'
                    if mode == 'metadata_mismatch': provider[key].metadata = dict(provider[key].metadata, participant_id='fictional_other')
                    if mode == 'intent_missing': provider[key].payment_intent = None
                    if mode == 'id_mismatch': provider[key].id = 'fictional_other_session'
                    if mode in ('repriced', 'cancelled', 'declined', 'refund_terminal', 'raw_refund_partial', 'refund_pending', 'refund_failed', 'refund_requested'):
                        async with database.AsyncSessionLocal() as session:
                            if mode == 'repriced': await session.execute(update(DispatchRequestParticipant).where(DispatchRequestParticipant.id == case['participant']).values(share_amount=15))
                            if mode == 'cancelled': await session.execute(update(DispatchRequest).where(DispatchRequest.id == case['dispatch']).values(status=DispatchRequestStatusEnum.CANCELLED))
                            if mode == 'declined': await session.execute(update(DispatchRequestParticipant).where(DispatchRequestParticipant.id == case['participant']).values(status='declined'))
                            if mode in ('refund_terminal', 'raw_refund_partial'):
                                await session.execute(update(PaymentTransaction).where(PaymentTransaction.session_id == key).values(payment_status='refunded' if mode == 'refund_terminal' else 'partially_refunded', status='refunded'))
                            if mode in ('refund_pending', 'refund_failed', 'refund_requested'):
                                await session.execute(update(PaymentTransaction).where(PaymentTransaction.session_id == key).values(payment_status='paid', status=mode))
                            await session.commit()
                        if mode in ('refund_pending', 'refund_failed', 'refund_requested'):
                            before_refund = await read_case(case)
                    if mode == 'profile_changed':
                        async with database.AsyncSessionLocal() as session:
                            await session.execute(update(Profile).where(Profile.id == case['buyer']).values(full_name='Changed after checkout')); await session.commit()
                    if mode == 'credit_then_card':
                        context['phase'] = 'credit'; paid = await client.post('/api/dispatch/crew-invite/'+case['participant']+'/pay?payer_id='+case['buyer'], headers=case['headers'], json={}); assert paid.status_code == 200
                    if mode == 'second_paid':
                        extra = await checkout_case(client, case); assert extra.status_code == 200
                        extra_key = extra.json()['session_id']; provider[extra_key].status = 'complete'; provider[extra_key].payment_status = 'paid'
                    returned = await return_case(client, case, key)
                    expected = 'pending' if mode == 'pending' else 'expired' if mode == 'expired' else 'partially_refunded' if mode == 'raw_refund_partial' else 'refunded' if mode == 'refund_terminal' else 'review_required' if mode in ('credit_then_card', 'repriced', 'cancelled', 'declined', 'amount_mismatch', 'currency_mismatch', 'mode_mismatch', 'metadata_mismatch', 'intent_missing', 'id_mismatch', 'refund_pending', 'refund_failed', 'refund_requested') else 'completed'
                    if mode in ('provider_unavailable', 'fulfill_fail', 'fulfill_ack'):
                        assert returned.status_code == 503, 'unconfirmed completion status'
                        if mode == 'fulfill_fail':
                            state = await read_case(case); assert not state['paid'] and not state['ledger']; assert state['payments'][0]['status'] == 'pending'
                        context['mode'] = 'normal'; returned = await return_case(client, case, key)
                    assert returned.status_code == 200 and returned.json()['status'] == expected, 'return '+str(returned.status_code)+' '+returned.text[:100]
                    reads = len(context['retrieved'])
                    if mode == 'second_paid':
                        returned = await return_case(client, case, extra_key); assert returned.json()['status'] == 'review_required'
                    if mode == 'replay':
                        replayed = await return_case(client, case, key); assert replayed.json()['status'] == 'completed' and len(context['retrieved']) == reads
                    if mode == 'credit_after_card':
                        context['phase'] = 'credit'; credit_again = await client.post('/api/dispatch/crew-invite/'+case['participant']+'/pay?payer_id='+case['buyer'], headers=case['headers'], json={}); assert credit_again.status_code == 400
                    if mode == 'decline_after_card':
                        declined = await client.post('/api/dispatch/crew-invite/'+case['participant']+'/decline', headers=case['headers']); assert declined.status_code == 400
                    if mode in ('replay_cancelled', 'replay_orphan_ledger', 'replay_dispatch_closed'):
                        async with database.AsyncSessionLocal() as session:
                            if mode == 'replay_cancelled': await session.execute(update(DispatchRequestParticipant).where(DispatchRequestParticipant.id == case['participant']).values(paid=False, status='cancelled'))
                            elif mode == 'replay_dispatch_closed': await session.execute(update(DispatchRequest).where(DispatchRequest.id == case['dispatch']).values(status=DispatchRequestStatusEnum.CANCELLED))
                            else:
                                from sqlalchemy import delete
                                await session.execute(delete(CreditTransaction).where(CreditTransaction.user_id == case['buyer']))
                            await session.commit()
                        replayed = await return_case(client, case, key); assert replayed.json()['status'] == 'review_required' and len(context['retrieved']) == reads
                    if mode in ('refund_terminal', 'raw_refund_partial', 'refund_pending', 'refund_failed', 'refund_requested'): assert not context['retrieved'], 'Refund consulted provider'
                    if mode in ('refund_pending', 'refund_failed', 'refund_requested'):
                        after_refund = await read_case(case)
                        assert after_refund['payments'] == before_refund['payments'], 'Unconfirmed refund receipt or raw status rewritten'
                        assert after_refund['ledger'] == before_refund['ledger'] and not after_refund['paid'], 'Unconfirmed refund granted participation'
                    state = await read_case(case)
                    if mode == 'credit_then_card': assert state['balance'] == 7.5 and state['promo'] == 0 and len(state['ledger']) == 1 and state['ledger'][0]['amount'] == -12.5
                    else: assert state['balance'] == 20 and state['promo'] == 8
                    assert state['captain_balance'] == 40
                    if expected == 'completed' and mode not in ('replay_cancelled', 'replay_orphan_ledger', 'replay_dispatch_closed'):
                        assert state['paid'] and state['participant_status'] == 'paid' and state['intent'] == provider[key].payment_intent
                        assert len(state['ledger']) == 1 and state['ledger'][0]['amount'] == state['ledger'][0]['promo'] == 0
                        assert state['funded'] == (mode not in ('no_captain_deposit', 'other_unpaid'))
                        if mode == 'profile_changed': assert state['payer_name'] == 'Fictional Crew'
                        if mode == 'selfie': assert state['selfie'] == 'https://fixture.invalid/selfie.jpg' and state['payer_name'] == 'Fictional Crew'
                    elif mode != 'credit_then_card': assert not state['paid'] or mode in ('replay_orphan_ledger', 'replay_dispatch_closed')
                ok = True
            except Exception as error:
                errors.append(type(error).__name__+': '+str(error)[:160]); ok = False
            results.append(dict(mode=mode, passed=ok, errors=errors)); print(('PASS ' if ok else 'FAIL ')+mode+(' '+str(errors) if errors else ''), flush=True)
    await database.engine.dispose()
    summary = dict(passed=sum(row['passed'] for row in results), total=len(results), results=results, actual_jwt=True, actual_asgi=True,
                   database='disposable-loopback-PostgreSQL' if fixture_url else 'in-memory-async-SQLite', normal_startup=False,
                   external_calls=False, provider='in-memory Checkout double', database_disposed=True)
    print(json.dumps(summary, indent=2)); return summary['passed'] == summary['total']
if __name__ == '__main__':
    try: ok = loop.run_until_complete(main())
    finally: loop.close()
    raise SystemExit(0 if ok else 1)
