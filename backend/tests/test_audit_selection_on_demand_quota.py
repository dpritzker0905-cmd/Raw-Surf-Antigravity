"""On-demand (dispatch) selection quotas carry only a gallery id and must stay redeemable.

The #243 guard "exactly one of booking_id / live_session_id" answered 400 for every quota that
dispatch creates (gallery_sync.create_surfer_selection_quota, called with session_type='on_demand'),
while the selection queue kept listing them. Redemption is scoped by the quota's gallery instead, and
the ambiguous (both ids) and unscoped (no ids) shapes stay refused. Real JWT + ephemeral ORM.
"""
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import Gallery, GalleryItem, Profile, RoleEnum, SurferGalleryItem, SurferSelectionQuota
from routes.surfer_gallery import selection

SURFER = 'surfer'
PRO = 'pro'


def bearer(subject=SURFER):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


@pytest_asyncio.fixture
async def harness(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'selection.sqlite'}")

    def create_all(sync_connection):
        for table in Base.metadata.sorted_tables:
            try:
                table.create(sync_connection, checkfirst=True)
            except Exception:  # tables this test never reads may use types sqlite cannot create
                pass

    async with engine.begin() as connection:
        await connection.run_sync(create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add_all([
            Profile(id=SURFER, user_id=SURFER, email='surfer@example.invalid', role=RoleEnum.SURFER),
            Profile(id=PRO, user_id=PRO, email='pro@example.invalid', role=RoleEnum.PHOTOGRAPHER),
        ])
        await db.flush()
        db.add_all([Gallery(id='g1', photographer_id=PRO, title='First on-demand session'),
                    Gallery(id='g2', photographer_id=PRO, title='Second on-demand session')])
        await db.flush()
        for name, gallery in (('a', 'g1'), ('b', 'g1'), ('c', 'g1'), ('x', 'g2')):
            db.add(GalleryItem(id='gi-' + name, gallery_id=gallery, photographer_id=PRO, media_type='image',
                               price=10.0, preview_url='https://fixture.invalid/p',
                               original_url='https://fixture.invalid/o'))
        await db.flush()
        for name in ('a', 'b', 'c', 'x'):
            # session-less rows, exactly as gallery_distribution creates them for on_demand galleries
            db.add(SurferGalleryItem(id='si-' + name, surfer_id=SURFER, gallery_item_id='gi-' + name,
                                     photographer_id=PRO, booking_id=None, live_session_id=None,
                                     access_type='pending_selection', selection_eligible=True,
                                     is_paid=False))
        await db.commit()
    app = FastAPI()
    app.include_router(selection.router, prefix='/api/surfer-gallery')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield client, maker
    await engine.dispose()


async def add_quota(maker, quota_id='q', allowed=2, **scope):
    async with maker() as db:
        db.add(SurferSelectionQuota(id=quota_id, surfer_id=SURFER, photographer_id=PRO, photos_allowed=allowed,
                                    photos_selected=0, videos_allowed=0, videos_selected=0,
                                    status='pending_selection', **scope))
        await db.commit()


async def access_types(maker):
    async with maker() as db:
        rows = (await db.execute(select(SurferGalleryItem.id, SurferGalleryItem.access_type))).all()
    return dict(rows)


def select_url(quota_id='q'):
    return f'/api/surfer-gallery/selection-queue/{quota_id}/select'


async def test_on_demand_quota_is_redeemable_and_scoped_to_its_gallery(harness):
    client, maker = harness
    await add_quota(maker, gallery_id='g1', allowed=2)
    # si-x belongs to ANOTHER on-demand gallery of the same surfer and photographer
    response = await client.post(select_url(), headers=bearer(),
                                 json={'item_ids': ['si-a', 'si-x', 'si-b']})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['photos_selected'] == 2 and body['selection_complete'] is True
    types = await access_types(maker)
    assert types['si-a'] == 'included' and types['si-b'] == 'included'
    assert types['si-x'] == 'pending_selection'  # neither redeemed nor swept into 'pending'
    assert types['si-c'] == 'pending'  # same gallery, left over: now purchasable


async def test_on_demand_quota_without_a_matching_gallery_item_selects_nothing(harness):
    client, maker = harness
    await add_quota(maker, gallery_id='g1', allowed=2)
    response = await client.post(select_url(), headers=bearer(), json={'item_ids': ['si-x']})
    assert response.status_code == 200, response.text
    assert response.json()['photos_selected'] == 0
    assert (await access_types(maker))['si-x'] == 'pending_selection'


async def test_unscoped_quota_is_still_refused(harness):
    client, maker = harness
    await add_quota(maker)  # no booking, live session or gallery: would match every eligible photo
    response = await client.post(select_url(), headers=bearer(), json={'item_ids': ['si-a']})
    assert response.status_code == 400
    assert set((await access_types(maker)).values()) == {'pending_selection'}


async def test_quota_naming_booking_and_live_session_is_still_refused(harness):
    client, maker = harness
    # sqlite does not enforce the foreign keys here; the guard only reads the three ids on the row
    await add_quota(maker, booking_id='b1', live_session_id='l1', gallery_id='g1')
    response = await client.post(select_url(), headers=bearer(), json={'item_ids': ['si-a']})
    assert response.status_code == 400
    assert set((await access_types(maker)).values()) == {'pending_selection'}


async def test_items_listing_for_on_demand_quota_shows_only_its_gallery(harness):
    client, maker = harness
    await add_quota(maker, gallery_id='g1')
    response = await client.get('/api/surfer-gallery/selection-queue/q/items', headers=bearer())
    assert response.status_code == 200, response.text
    listed = {item['id'] for item in response.json()['unselected_items']}
    assert listed == {'si-a', 'si-b', 'si-c'}


async def test_queue_keeps_each_on_demand_gallery_separate(harness):
    client, maker = harness
    await add_quota(maker, quota_id='q1', gallery_id='g1')
    await add_quota(maker, quota_id='q2', gallery_id='g2')
    response = await client.get('/api/surfer-gallery/selection-queue/surfer', headers=bearer())
    assert response.status_code == 200, response.text
    quotas = {quota['id']: quota for quota in response.json()['quotas']}
    assert {item['id'] for item in quotas['q1']['eligible_items']} == {'si-a', 'si-b', 'si-c'}
    assert {item['id'] for item in quotas['q2']['eligible_items']} == {'si-x'}
    assert quotas['q1']['total_eligible'] == 3 and quotas['q2']['total_eligible'] == 1
    assert quotas['q1']['session_type'] == 'on_demand' and quotas['q1']['session_id'] == 'g1'


@pytest.mark.parametrize('scope', [{}, {'booking_id': 'missing-booking', 'live_session_id': 'missing-live'}])
async def test_queue_does_not_advertise_unredeemable_scope(harness, scope):
    client, maker = harness
    await add_quota(maker, **scope)
    response = await client.get('/api/surfer-gallery/selection-queue/surfer', headers=bearer())
    assert response.status_code == 200, response.text
    assert response.json()['quotas'] == [] and response.json()['pending_count'] == 0


@pytest.mark.parametrize('surface', ['queue', 'items', 'redeem'])
async def test_wrong_photographer_assignment_never_matches_quota(harness, surface):
    client, maker = harness
    await add_quota(maker, gallery_id='g1')
    async with maker() as db:
        item = (await db.execute(select(SurferGalleryItem).where(SurferGalleryItem.id == 'si-a'))).scalar_one()
        item.photographer_id = 'another-pro'
        await db.commit()
    if surface == 'redeem':
        response = await client.post(select_url(), headers=bearer(), json={'item_ids': ['si-a']})
        assert response.status_code == 200, response.text
        assert response.json()['photos_selected'] == 0
    else:
        url = '/api/surfer-gallery/selection-queue/surfer' if surface == 'queue' else '/api/surfer-gallery/selection-queue/q/items'
        response = await client.get(url, headers=bearer())
        assert response.status_code == 200, response.text
        body = response.json()
        items = body['quotas'][0]['eligible_items'] if surface == 'queue' else body['unselected_items']
        assert {item['id'] for item in items} == {'si-b', 'si-c'}
    assert (await access_types(maker))['si-a'] == 'pending_selection'


@pytest.mark.parametrize('scope', [{}, {'booking_id': 'missing-booking', 'live_session_id': 'missing-live'}])
async def test_items_refuse_unredeemable_scope_without_exposing_photos(harness, scope):
    client, maker = harness
    await add_quota(maker, **scope)
    response = await client.get('/api/surfer-gallery/selection-queue/q/items', headers=bearer())
    assert response.status_code == 400, response.text
    assert set((await access_types(maker)).values()) == {'pending_selection'}


@pytest.mark.parametrize('scope_key', ['booking_id', 'live_session_id'])
async def test_session_selection_still_lists_redeems_and_sweeps_only_its_scope(harness, scope_key):
    client, maker = harness
    await add_quota(maker, allowed=1, **{scope_key: 'matching-session'})
    async with maker() as db:
        items = (await db.execute(select(SurferGalleryItem).where(
            SurferGalleryItem.id.in_(['si-a', 'si-b'])))).scalars().all()
        for item in items:
            setattr(item, scope_key, 'matching-session')
        await db.commit()
    queue = await client.get('/api/surfer-gallery/selection-queue/surfer', headers=bearer())
    assert queue.status_code == 200, queue.text
    assert {item['id'] for item in queue.json()['quotas'][0]['eligible_items']} == {'si-a', 'si-b'}
    listing = await client.get('/api/surfer-gallery/selection-queue/q/items', headers=bearer())
    assert listing.status_code == 200, listing.text
    assert {item['id'] for item in listing.json()['unselected_items']} == {'si-a', 'si-b'}
    response = await client.post(select_url(), headers=bearer(), json={'item_ids': ['si-a', 'si-x']})
    assert response.status_code == 200, response.text
    assert response.json()['photos_selected'] == 1 and response.json()['selection_complete'] is True
    assert await access_types(maker) == {
        'si-a': 'included', 'si-b': 'pending', 'si-c': 'pending_selection', 'si-x': 'pending_selection'}
