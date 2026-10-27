"""Phase 0 containment: four controls the 2026-10-17 lead audit found missing on the shared backend.

- LA-SEC-01: password sign-in needs a stored password to check.
- LA-PAY-01: booking payment confirmation acts only for the booking's creator, only with that booking's
  checkout session, and only on a verified payment.
- LA-GAL-01: manual photo assignment acts as the token's subject and grants only the allowed access types.
- LA-GAL-02: a sold original's object name is not derivable from its public preview's, and a failed
  watermark refuses the upload instead of publishing the original as its own preview.

Real JWT + HTTP + an ephemeral SQLite ORM. Stripe and Storage are stubbed and never reached.
"""
import io
import json
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
import stripe
from fastapi import FastAPI
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import (
    Booking, BookingParticipant, Gallery, GalleryItem, GalleryPurchase, PaymentTransaction, Profile, RoleEnum,
    SurferGalleryItem,
)
from routes.auth_pkg import auth as auth_routes
from routes.bookings import stripe_checkout
from routes.gallery import collections as gallery_collections
from routes.gallery import distribution as gallery_distribution
from routes.gallery import distribution_tagging as gallery_tagging
from routes.gallery import items as gallery_items
from routes.sessions import payments as session_payments
from routes.uploads import core as upload_core
from routes.uploads import media_gallery
from routes.uploads.storage import unlinked_media_names


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


NO_AUTH = [
    {},
    {'Authorization': 'Bearer invalid'},
    {'Authorization': 'Bearer ' + create_access_token({'sub': 'owner'}, expires_delta=timedelta(minutes=-1))},
]
NO_AUTH_IDS = ['none', 'invalid', 'expired']


@pytest_asyncio.fixture
async def harness(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'phase0.sqlite'}")

    def create_all(sync_connection):
        for table in Base.metadata.sorted_tables:
            try:
                table.create(sync_connection, checkfirst=True)
            except Exception:  # tables this test never reads may use types sqlite cannot create
                pass

    async with engine.begin() as connection:
        await connection.run_sync(create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    when = datetime.now(timezone.utc) + timedelta(days=3)
    async with maker() as db:
        for pid, role in (('owner', RoleEnum.SURFER), ('other', RoleEnum.PHOTOGRAPHER),
                          ('pro', RoleEnum.PHOTOGRAPHER), ('surfer', RoleEnum.SURFER),
                          ('buyer', RoleEnum.SURFER)):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=role,
                           full_name=pid.title(), credit_balance=100.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0))
        db.add(Profile(id='nohash', user_id='nohash', email='nohash@example.invalid', username='nohash',
                       role=RoleEnum.SURFER, full_name='No Hash', password_hash=None))
        db.add(Profile(id='hashed', user_id='hashed', email='hashed@example.invalid', username='hashed',
                       role=RoleEnum.SURFER, full_name='Hashed',
                       password_hash=auth_routes.hash_password('fixture-correct-pw')))
        for bid, creator, status in (('bk', 'owner', 'Pending Payment'), ('bk2', 'owner', 'Pending Payment'),
                                     ('bk3', 'other', 'Pending Payment'), ('bkc', 'owner', 'Cancelled')):
            db.add(Booking(id=bid, photographer_id='pro', creator_id=creator, location='Fixture Beach',
                           session_date=when, duration=60, total_price=100.0, status=status))
        db.add(BookingParticipant(booking_id='bk', participant_id='owner', paid_amount=0.0,
                                  payment_status='Pending', status='pending'))
        db.add(PaymentTransaction(user_id='owner', session_id='cs_live_bk', amount=100.0, payment_status='Pending',
                                  status='Pending', transaction_metadata=json.dumps({'booking_id': 'bk'})))
        db.add(PaymentTransaction(user_id='owner', session_id='cs_test_bk', amount=100.0, payment_status='Pending',
                                  status='Pending', transaction_metadata=json.dumps({'booking_id': 'bk'})))
        for sid, user, bid in (('cs_live_bk2', 'owner', 'bk2'), ('cs_live_bk3', 'owner', 'bk3'),
                               ('cs_live_foreign', 'other', 'bk'), ('cs_live_bkc', 'owner', 'bkc')):
            db.add(PaymentTransaction(user_id=user, session_id=sid, amount=100.0, payment_status='Pending',
                                      status='Pending', transaction_metadata=json.dumps({'booking_id': bid})))
        db.add(Gallery(id='gal', photographer_id='pro', title='Fixture Gallery'))
        db.add(GalleryItem(id='item', gallery_id='gal', photographer_id='pro', media_type='image', price=5.0,
                           original_url='https://cdn.fixture.invalid/o.jpg',
                           preview_url='https://cdn.fixture.invalid/p.jpg'))
        db.add(GalleryPurchase(gallery_item_id='item', buyer_id='buyer', photographer_id='pro', amount_paid=5.0))
        await db.commit()

    monkeypatch.setattr(auth_routes, 'rate_limit_check', lambda *a, **k: None)
    # Production behaviour: the checkout emulator never stands in for Stripe here.
    monkeypatch.setattr(session_payments, 'checkout_emulation_allowed', lambda: False)

    def no_retrieve(session_id):
        raise AssertionError('Stripe must not be called before ownership is checked')

    monkeypatch.setattr(stripe.checkout.Session, 'retrieve', staticmethod(no_retrieve))

    app = FastAPI()
    for module in (auth_routes, stripe_checkout, gallery_items, gallery_collections, gallery_distribution,
                   gallery_tagging, upload_core, media_gallery):
        app.include_router(module.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield SimpleNamespace(client=client, maker=maker, tmp=tmp_path)
    await engine.dispose()


async def scalar(maker, statement):
    async with maker() as db:
        return (await db.execute(statement)).scalar_one_or_none()


# ---------------------------------------------------------------------------------------- LA-SEC-01

@pytest.mark.parametrize('password', ['', 'anything', 'fixture-correct-pw'])
async def test_sign_in_refuses_an_account_with_no_stored_password(harness, password):
    response = await harness.client.post('/api/auth/login', json={'email': 'nohash@example.invalid',
                                                                   'password': password})
    assert response.status_code == 401, response.text
    assert 'access_token' not in response.text
    assert 'Forgot password' in response.json()['detail']


async def test_sign_in_by_username_also_refuses_an_account_with_no_stored_password(harness):
    response = await harness.client.post('/api/auth/login', json={'email': 'nohash', 'password': 'x'})
    assert response.status_code == 401, response.text


async def test_sign_in_still_works_with_the_right_password(harness):
    response = await harness.client.post('/api/auth/login', json={'email': 'hashed@example.invalid',
                                                                   'password': 'fixture-correct-pw'})
    assert response.status_code == 200, response.text
    assert response.json()['access_token']


async def test_sign_in_refuses_a_wrong_password(harness):
    response = await harness.client.post('/api/auth/login', json={'email': 'hashed@example.invalid',
                                                                   'password': 'wrong'})
    assert response.status_code == 401, response.text


# ---------------------------------------------------------------------------------------- LA-PAY-01

SUCCESS = '/api/bookings/payment-success?session_id={sid}&booking_id={bid}'


async def booking_state(maker, bid='bk'):
    booking = await scalar(maker, select(Booking).where(Booking.id == bid))
    return booking.status, booking.escrow_status


def stripe_returns(monkeypatch, **fields):
    session = SimpleNamespace(**fields)
    monkeypatch.setattr(stripe.checkout.Session, 'retrieve', staticmethod(lambda session_id: session))


MATCHING = {'type': 'scheduled_booking', 'booking_id': 'bk', 'user_id': 'owner'}
UNCHANGED = ('Pending Payment', 'none')  # status, escrow_status before any confirmation


@pytest.mark.parametrize('headers', NO_AUTH, ids=NO_AUTH_IDS)
@pytest.mark.parametrize('sid', ['cs_test_bk', 'cs_live_bk'])
async def test_confirmation_needs_a_valid_token(harness, headers, sid):
    response = await harness.client.get(SUCCESS.format(sid=sid, bid='bk'), headers=headers)
    assert response.status_code == 401, response.text
    assert await booking_state(harness.maker) == UNCHANGED


@pytest.mark.parametrize('sid', ['cs_test_bk', 'cs_live_bk'])
async def test_another_user_cannot_confirm_the_booking(harness, sid):
    response = await harness.client.get(SUCCESS.format(sid=sid, bid='bk'), headers=bearer('other'))
    assert response.status_code == 403, response.text
    assert await booking_state(harness.maker) == UNCHANGED


async def test_a_session_recorded_for_another_booking_confirms_nothing(harness):
    response = await harness.client.get(SUCCESS.format(sid='cs_live_bk2', bid='bk'), headers=bearer('owner'))
    assert response.status_code == 400, response.text
    assert await booking_state(harness.maker) == UNCHANGED


async def test_an_unknown_session_confirms_nothing(harness):
    response = await harness.client.get(SUCCESS.format(sid='cs_test_unknown', bid='bk'), headers=bearer('owner'))
    assert response.status_code == 404, response.text
    assert await booking_state(harness.maker) == UNCHANGED


async def test_a_test_mode_id_is_verified_with_stripe_when_emulation_is_off(harness, monkeypatch):
    calls = []

    def unpaid(session_id):
        calls.append(session_id)
        return SimpleNamespace(payment_status='unpaid', metadata=MATCHING, amount_total=10000)

    monkeypatch.setattr(stripe.checkout.Session, 'retrieve', staticmethod(unpaid))
    response = await harness.client.get(SUCCESS.format(sid='cs_test_bk', bid='bk'), headers=bearer('owner'))
    assert calls == ['cs_test_bk']
    assert response.status_code == 400, response.text
    assert await booking_state(harness.maker) == UNCHANGED


@pytest.mark.parametrize('metadata,amount_total', [
    (dict(MATCHING, booking_id='bk2'), 10000),
    (dict(MATCHING, user_id='other'), 10000),
    (dict(MATCHING, type='on_demand_dispatch'), 10000),
    (MATCHING, 100),
    ({}, 10000),
], ids=['other_booking', 'other_payer', 'other_kind', 'other_amount', 'no_metadata'])
async def test_a_paid_session_for_something_else_confirms_nothing(harness, monkeypatch, metadata, amount_total):
    stripe_returns(monkeypatch, payment_status='paid', metadata=metadata, amount_total=amount_total)
    response = await harness.client.get(SUCCESS.format(sid='cs_live_bk', bid='bk'), headers=bearer('owner'))
    assert response.status_code == 400, response.text
    assert await booking_state(harness.maker) == UNCHANGED


async def test_the_creator_confirms_with_the_matching_paid_session(harness, monkeypatch):
    stripe_returns(monkeypatch, payment_status='paid', metadata=MATCHING, amount_total=10000)
    response = await harness.client.get(SUCCESS.format(sid='cs_live_bk', bid='bk'), headers=bearer('owner'))
    assert response.status_code == 200, response.text
    assert await booking_state(harness.maker) == ('Confirmed', 'held')
    tx = await scalar(harness.maker, select(PaymentTransaction).where(PaymentTransaction.session_id == 'cs_live_bk'))
    assert tx.payment_status == 'paid'


# ---------------------------------------------------------------------------------------- LA-GAL-01

ASSIGN = '/api/gallery/item/item/assign-surfer'
BULK = '/api/gallery/gal/assign-all-to-surfer'
BODY = {'photographer_id': 'pro', 'surfer_id': 'surfer', 'access_type': 'gifted'}


async def locker_rows(maker):
    async with maker() as db:
        return (await db.execute(select(SurferGalleryItem))).scalars().all()


@pytest.mark.parametrize('headers', NO_AUTH, ids=NO_AUTH_IDS)
@pytest.mark.parametrize('path', [ASSIGN, BULK], ids=['one', 'bulk'])
async def test_assignment_needs_a_valid_token(harness, headers, path):
    response = await harness.client.post(path, json=BODY, headers=headers)
    assert response.status_code == 401, response.text
    assert await locker_rows(harness.maker) == []


@pytest.mark.parametrize('path', [ASSIGN, BULK], ids=['one', 'bulk'])
async def test_another_user_naming_the_owner_in_the_body_is_refused(harness, path):
    response = await harness.client.post(path, json=BODY, headers=bearer('other'))
    assert response.status_code == 403, response.text
    assert await locker_rows(harness.maker) == []


@pytest.mark.parametrize('path', [ASSIGN, BULK], ids=['one', 'bulk'])
async def test_the_body_cannot_name_a_different_photographer(harness, path):
    response = await harness.client.post(path, json=dict(BODY, photographer_id='other'), headers=bearer('pro'))
    assert response.status_code == 403, response.text
    assert await locker_rows(harness.maker) == []


@pytest.mark.parametrize('path', [ASSIGN, BULK], ids=['one', 'bulk'])
async def test_only_the_allowed_access_types_are_accepted(harness, path):
    response = await harness.client.post(path, json=dict(BODY, access_type='free_forever'), headers=bearer('pro'))
    assert response.status_code == 422, response.text
    assert await locker_rows(harness.maker) == []


@pytest.mark.parametrize('path', [ASSIGN, BULK], ids=['one', 'bulk'])
async def test_the_owner_assigns_and_the_row_names_the_token_subject(harness, path):
    response = await harness.client.post(path, json=dict(BODY, access_type='pending_selection'),
                                         headers=bearer('pro'))
    assert response.status_code == 200, response.text
    rows = await locker_rows(harness.maker)
    assert [(r.surfer_id, r.photographer_id, r.access_type, r.is_paid) for r in rows] == [
        ('surfer', 'pro', 'pending_selection', False)]


# ---------------------------------------------------------------------------------------- LA-GAL-02

def _stems(name):
    stem = name.rsplit('.', 1)[0]
    return {part for part in re.split(r'[_\-]', stem) if len(part) >= 6}


@pytest.mark.parametrize('prefix', ['', 'session_20261017_120000_', 'exported_'])
def test_original_names_share_nothing_with_their_previews(prefix):
    seen = set()
    for _ in range(200):
        original, preview = unlinked_media_names('.jpg', prefix=prefix)
        assert original.startswith(prefix) and preview.startswith(prefix)
        token = original[len(prefix):-len('.jpg')]
        assert re.fullmatch(r'[0-9a-f]{48}', token)  # 192 random bits
        assert token not in preview
        assert preview.replace('_preview', '') != original
        assert not (_stems(original[len(prefix):]) & _stems(preview[len(prefix):]))
        seen.add(token)
    assert len(seen) == 200


def test_a_failed_watermark_raises_and_never_copies_the_original(tmp_path):
    source = tmp_path / 'paid.jpg'
    source.write_bytes(b'not an image at all')
    target = tmp_path / 'free_preview.jpg'
    with pytest.raises(upload_core.WatermarkError):
        upload_core.add_watermark(str(source), str(target))
    assert not target.exists()


def _png(width=400, height=300):
    buffer = io.BytesIO()
    Image.new('RGB', (width, height), (20, 120, 200)).save(buffer, 'PNG')
    return buffer.getvalue()


@pytest.fixture
def storage(monkeypatch, tmp_path):
    uploaded = []

    def record(local_path, bucket, key, content_type=None):
        uploaded.append((bucket, key))
        return f'https://cdn.fixture.invalid/{bucket}/{key}'

    monkeypatch.setattr(upload_core, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(media_gallery, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(upload_core, 'upload_to_supabase_storage', record)
    monkeypatch.setattr(media_gallery, 'upload_to_supabase_storage', record)
    return uploaded


def _assert_unlinked(original_url, preview_url):
    """The original's random part (the only secret in its name) appears nowhere in the preview's.
    A shared non-secret prefix such as `session_<timestamp>_` is allowed."""
    original = original_url.rsplit('/', 1)[-1]
    preview = preview_url.rsplit('/', 1)[-1]
    secret = re.findall(r'[0-9a-f]{48}', original)
    assert len(secret) == 1, original
    assert secret[0] not in preview_url, (original, preview)
    assert preview.replace('_preview', '') != original


async def test_gallery_upload_names_the_original_apart_from_its_preview(harness, storage):
    response = await harness.client.post('/api/upload/gallery', data={'user_id': 'pro'}, headers=bearer('pro'),
                                         files={'file': ('a.png', _png(), 'image/png')})
    assert response.status_code == 200, response.text
    body = response.json()
    _assert_unlinked(body['original_url'], body['preview_url'])
    assert len(storage) == 2


async def test_photographer_upload_names_the_original_apart_from_its_preview(harness, storage):
    response = await harness.client.post('/api/upload/photographer-gallery', data={'user_id': 'pro'}, headers=bearer('pro'),
                                         files={'file': ('a.png', _png(), 'image/png')})
    assert response.status_code == 200, response.text
    body = response.json()
    _assert_unlinked(body['original_url'], body['preview_url'])


@pytest.mark.parametrize('module,path', [
    (upload_core, '/api/upload/gallery'),
    (media_gallery, '/api/upload/photographer-gallery'),
], ids=['gallery', 'photographer_gallery'])
async def test_a_failed_watermark_refuses_the_upload_and_publishes_nothing(harness, storage, monkeypatch,
                                                                          module, path):
    def broken(*args, **kwargs):
        raise upload_core.WatermarkError('fixture')

    monkeypatch.setattr(module, 'add_watermark', broken)
    response = await harness.client.post(path, data={'user_id': 'pro'}, headers=bearer('pro'),
                                         files={'file': ('a.png', _png(), 'image/png')})
    assert response.status_code == 500, response.text
    assert storage == []
    gallery_dir = harness.tmp / 'uploads' / 'gallery' / 'pro'
    assert not [p for p in gallery_dir.glob('*') if p.is_file()]


async def test_session_photo_upload_names_the_original_apart_from_its_preview(harness, storage):
    response = await harness.client.post('/api/photos/upload', data={'photographer_id': 'pro'}, headers=bearer('pro'),
                                         files={'file': ('a.png', _png(), 'image/png')})
    assert response.status_code == 200, response.text
    body = response.json()
    _assert_unlinked(body['original_url'], body['preview_url'])


async def test_session_photo_with_a_failed_preview_is_refused_not_published(harness, storage):
    response = await harness.client.post('/api/photos/upload', data={'photographer_id': 'pro'}, headers=bearer('pro'),
                                         files={'file': ('a.jpg', b'not an image at all', 'image/jpeg')})
    assert response.status_code == 500, response.text
    assert await scalar(harness.maker, select(GalleryItem).where(GalleryItem.id != 'item')) is None
    gallery_dir = harness.tmp / 'uploads' / 'gallery' / 'pro'
    assert not [p for p in gallery_dir.glob('*') if p.is_file()]


# ---------------------------------------------------------------------------------------- LA-PAY-01, review follow-ups

async def test_each_ownership_check_holds_on_its_own(harness):
    # The transaction is the caller's, the booking is someone else's.
    response = await harness.client.get(SUCCESS.format(sid='cs_live_bk3', bid='bk3'), headers=bearer('owner'))
    assert response.status_code == 403, response.text
    # The booking is the caller's, the transaction (recorded for that booking) is someone else's.
    response = await harness.client.get(SUCCESS.format(sid='cs_live_foreign', bid='bk'), headers=bearer('owner'))
    assert response.status_code == 403, response.text
    assert await booking_state(harness.maker) == UNCHANGED
    assert await booking_state(harness.maker, 'bk3') == UNCHANGED


async def test_a_booking_not_awaiting_payment_is_not_confirmed(harness):
    response = await harness.client.get(SUCCESS.format(sid='cs_live_bkc', bid='bkc'), headers=bearer('owner'))
    assert response.status_code == 409, response.text
    assert await booking_state(harness.maker, 'bkc') == ('Cancelled', 'none')


async def test_replaying_a_confirmed_session_writes_nothing(harness, monkeypatch):
    stripe_returns(monkeypatch, payment_status='paid', metadata=MATCHING, amount_total=10000)
    first = await harness.client.get(SUCCESS.format(sid='cs_live_bk', bid='bk'), headers=bearer('owner'))
    assert first.status_code == 200, first.text
    async with harness.maker() as db:  # the booking is then cancelled and its escrow refunded
        booking = (await db.execute(select(Booking).where(Booking.id == 'bk'))).scalar_one()
        booking.status, booking.escrow_status = 'Cancelled', 'refunded'
        participant = (await db.execute(
            select(BookingParticipant).where(BookingParticipant.booking_id == 'bk'))).scalar_one()
        participant.payment_status, participant.paid_amount = 'Refunded', 0.0
        await db.commit()
    replay = await harness.client.get(SUCCESS.format(sid='cs_live_bk', bid='bk'), headers=bearer('owner'))
    assert replay.status_code == 200, replay.text
    assert replay.json()['status'] == 'Cancelled'
    assert await booking_state(harness.maker) == ('Cancelled', 'refunded')
    participant = await scalar(harness.maker, select(BookingParticipant).where(BookingParticipant.booking_id == 'bk'))
    assert (participant.payment_status, participant.paid_amount) == ('Refunded', 0.0)


async def test_the_local_emulator_confirms_without_stripe_where_it_is_allowed(harness, monkeypatch, tmp_path):
    import stripe_mcp_server
    monkeypatch.setattr(session_payments, 'checkout_emulation_allowed', lambda: True)
    monkeypatch.setattr(stripe_mcp_server, 'DB_PATH', str(tmp_path / 'emulator.sqlite'))
    response = await harness.client.get(SUCCESS.format(sid='cs_test_bk', bid='bk'), headers=bearer('owner'))
    assert response.status_code == 200, response.text  # the harness's Stripe stub fails if it is called
    assert await booking_state(harness.maker) == ('Confirmed', 'held')


# ---------------------------------------------------------------------------------------- LA-GAL-01, review follow-ups

@pytest.mark.parametrize('path', [ASSIGN, BULK], ids=['one', 'bulk'])
async def test_a_photographer_naming_themselves_cannot_assign_someone_elses_photo(harness, path):
    response = await harness.client.post(path, json=dict(BODY, photographer_id='other'), headers=bearer('other'))
    assert response.status_code == 403, response.text
    assert await locker_rows(harness.maker) == []


DISTRIBUTION = [
    ('post', '/api/gallery/gal/distribute?photographer_id=pro', None),
    ('get', '/api/gallery/gal/session-participants?photographer_id=pro', None),
    ('post', '/api/gallery/gal/link-session?photographer_id=pro', {'live_session_id': None}),
    ('post', '/api/gallery/gal/distribute-to-surfer?photographer_id=pro',
     {'surfer_id': 'surfer', 'access_type': 'gifted'}),
    ('post', '/api/gallery/gal/tag-item?photographer_id=pro', {'item_id': 'item', 'surfer_id': 'surfer'}),
    ('get', '/api/gallery/gal/surfer-items/surfer?photographer_id=pro', None),
    ('post', '/api/gallery/gal/untag-item?photographer_id=pro', {'item_id': 'item', 'surfer_id': 'surfer'}),
    ('get', '/api/gallery/gal/distribution-status?photographer_id=pro', None),
    ('post', '/api/gallery/gal/publish?photographer_id=pro', {'is_published': True}),
]
DISTRIBUTION_IDS = ['distribute', 'session_participants', 'link_session', 'distribute_to_surfer', 'tag_item',
                    'surfer_items', 'untag_item', 'distribution_status', 'publish']


async def call(client, method, path, body, headers):
    if method == 'get':
        return await client.get(path, headers=headers)
    return await client.post(path, json=body, headers=headers)


@pytest.mark.parametrize('method,path,body', DISTRIBUTION, ids=DISTRIBUTION_IDS)
async def test_distribution_routes_need_a_valid_token(harness, method, path, body):
    response = await call(harness.client, method, path, body, {})
    assert response.status_code == 401, response.text
    assert await locker_rows(harness.maker) == []


@pytest.mark.parametrize('method,path,body', DISTRIBUTION, ids=DISTRIBUTION_IDS)
async def test_distribution_routes_refuse_another_user_naming_the_owner(harness, method, path, body):
    response = await call(harness.client, method, path, body, bearer('other'))
    assert response.status_code == 403, response.text
    assert await locker_rows(harness.maker) == []


async def test_distribute_to_surfer_grants_only_the_allowed_access_types(harness):
    response = await harness.client.post('/api/gallery/gal/distribute-to-surfer?photographer_id=pro',
                                         json={'surfer_id': 'surfer', 'access_type': 'free_forever'},
                                         headers=bearer('pro'))
    assert response.status_code == 422, response.text
    assert await locker_rows(harness.maker) == []


async def test_the_owner_still_tags_and_reads_their_surfers_items(harness):
    tagged = await harness.client.post('/api/gallery/gal/tag-item?photographer_id=pro',
                                       json={'item_id': 'item', 'surfer_id': 'surfer'}, headers=bearer('pro'))
    assert tagged.status_code == 200, tagged.text
    listed = await harness.client.get('/api/gallery/gal/surfer-items/surfer?photographer_id=pro',
                                      headers=bearer('pro'))
    assert listed.status_code == 200, listed.text
    assert [i['gallery_item_id'] for i in listed.json()['tagged_items']] == ['item']


VIEWER_READS = ['/api/gallery/item/item?viewer_id=buyer', '/api/galleries/gal/items?viewer_id=buyer']


@pytest.mark.parametrize('path', VIEWER_READS, ids=['item', 'gallery_items'])
@pytest.mark.parametrize('who', [None, 'invalid', 'other'], ids=['none', 'invalid', 'other_user'])
async def test_a_viewer_id_claim_alone_does_not_unlock_a_purchased_original(harness, path, who):
    headers = {} if who is None else ({'Authorization': 'Bearer invalid'} if who == 'invalid' else bearer(who))
    response = await harness.client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    assert 'cdn.fixture.invalid/o.jpg' not in response.text


@pytest.mark.parametrize('path', VIEWER_READS, ids=['item', 'gallery_items'])
async def test_the_buyer_with_their_token_still_gets_their_original(harness, path):
    response = await harness.client.get(path, headers=bearer('buyer'))
    assert response.status_code == 200, response.text
    assert 'cdn.fixture.invalid/o.jpg' in response.text


# ---------------------------------------------------------------------------------------- LA-GAL-02, review follow-ups

@pytest.mark.parametrize('path,field', [
    ('/api/upload/gallery', 'user_id'),
    ('/api/upload/photographer-gallery', 'user_id'),
    ('/api/photos/upload', 'photographer_id'),
], ids=['gallery', 'photographer_gallery', 'session_photo'])
async def test_heic_without_a_decoder_is_refused_before_anything_is_written(harness, storage, monkeypatch,
                                                                          path, field):
    monkeypatch.setattr(upload_core, 'HEIF_SUPPORT', False)
    response = await harness.client.post(path, data={field: 'pro'}, headers=bearer('pro'),
                                         files={'file': ('a.heic', b'fixture-heic-bytes', 'image/heic')})
    assert response.status_code == 415, response.text
    assert storage == []
    gallery_dir = harness.tmp / 'uploads' / 'gallery' / 'pro'
    assert not (gallery_dir.exists() and [p for p in gallery_dir.glob('*') if p.is_file()])


async def test_the_watermark_benchmark_cleans_up_after_a_failure(harness, monkeypatch, tmp_path):
    import tempfile
    scratch = tmp_path / 'tmpdir'
    scratch.mkdir()
    monkeypatch.setattr(tempfile, 'tempdir', str(scratch))
    response = await harness.client.post('/api/uploads/test-watermark', headers=bearer('pro'),
                                         files={'file': ('a.jpg', b'not an image at all', 'image/jpeg')})
    assert response.status_code == 400, response.text
    assert list(scratch.iterdir()) == []
