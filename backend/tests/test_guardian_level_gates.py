"""Guardian program PR 2: the level model is enforced where the policy names it.

  * under-13s cannot self-register (clear answer, NOTHING stored); a Grom account needs a birthdate;
  * L0 (no confirmed guardian) is browse-only for every band;
  * L1 unlocks messaging and commenting; public profile, photo/likeness and money need L2 for 13-15 (and under 13);
  * 16-17 at L1 get most features, and the guardian is notified.

Real JWTs, real routers, real SQLite file; nothing leaves the process.

Cast (age on TODAY = 2026-10-25; guardians: g1 = unverified adult, g2 = age-verified adult)
  t14_l0  14, no guardian        t14_l1  14, linked to g1      t14_l2  14, linked to g2
  t17_l0  17, no guardian        t17_l1  17, linked to g1      t17_l2  17, linked to g2
  k10_l1  10, linked to g1       k10_l2  10, linked to g2      nobd    no birthdate, linked to g1
  adult18 a Grom aged 19 with no guardian (no gate)            owner   a surfer with a post
"""
import sqlite3
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from core.security import create_access_token
from database import Base, get_db
from models import Post, Profile, RoleEnum
from routes.auth_pkg import router as auth_router
from routes.content import router as content_router
from routes.grom_hq import router as grom_hq_router
from routes.grom_hq import protected_media
from routes.posts import router as posts_router
from routes.profiles import router as profiles_router
from routes.social import router as social_router
from services import guardian_policy as policy
from services.guardian_levels import ADULT, L0, L1, L2, TEEN_13_15, TEEN_16_17, UNDER_13, UNKNOWN, GuardianStanding
from services.parental_controls import refusal_for

TODAY = date.today()


def years_ago(n, days=0):
    """The date n whole years before today (plus ``days``): exactly n years old today when days == 0."""
    try:
        d = TODAY.replace(year=TODAY.year - n)
    except ValueError:          # Feb 29
        d = TODAY.replace(year=TODAY.year - n, day=28)
    return d + timedelta(days=days)


def auth(user):
    return {'Authorization': f'Bearer {create_access_token({"sub": user})}'}


CAST = {   # id: (age in years or None, guardian)
    't14_l0': (14, None), 't14_l1': (14, 'g1'), 't14_l2': (14, 'g2'),
    't17_l0': (17, None), 't17_l1': (17, 'g1'), 't17_l2': (17, 'g2'),
    'k10_l1': (10, 'g1'), 'k10_l2': (10, 'g2'), 'nobd': (None, 'g1'),
    'adult18': (19, None),
}


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.delenv('RENDER', raising=False)
    path = tmp_path / 'levels.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:
            pass
    with sessionmaker(sync_engine)() as db:
        def add(pid, role, **extra):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=role,
                           full_name=pid.title(), credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0, **extra))

        add('owner', RoleEnum.SURFER)
        add('g1', RoleEnum.SURFER)
        add('g2', RoleEnum.SURFER, parent_age_verified=True)
        for pid, (age, guardian) in CAST.items():
            add(pid, RoleEnum.GROM, birthdate=years_ago(age) if age is not None else None, is_private=True,
                parent_id=guardian, parent_link_approved=bool(guardian))
        db.flush()
        db.add(Post(id='post-open', author_id='owner', media_url='https://example.invalid/a.jpg'))
        db.commit()
    sync_engine.dispose()

    engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            yield session

    async def fake_upload(**kwargs):
        return f"supabase://grom_media/{kwargs['object_key']}"

    monkeypatch.setattr(protected_media, 'upload_private_media_stream', fake_upload)
    app = FastAPI()
    for router in (auth_router, grom_hq_router, posts_router, profiles_router, social_router, content_router):
        app.include_router(router, prefix='/api')
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        client.db_path = str(path)
        client.maker = maker
        yield client


def count(client, table):
    with sqlite3.connect(client.db_path) as conn:
        return conn.execute(f'select count(*) from {table}').fetchone()[0]


# ------------------------------------------------------------------------------------------- signup

def signup(client, **over):
    body = {'email': 'kid@example.com', 'password': 'a-long-enough-password', 'full_name': 'Kid Person',
            'role': 'Grom', 'parent_email': 'g1@example.invalid', 'birthdate': years_ago(14).isoformat(), **over}
    return client.post('/api/auth/signup', json=body)


@pytest.mark.parametrize('age', [5, 9, 12])
def test_an_under_13_cannot_self_register_and_nothing_is_stored(env, age):
    before = (count(env, 'profiles'), count(env, 'notifications'), count(env, 'guardian_link_codes'))
    r = signup(env, birthdate=years_ago(age).isoformat())
    assert r.status_code == 403, r.text
    assert 'under 13' in r.json()['detail'] and 'parent' in r.json()['detail'].lower()
    assert (count(env, 'profiles'), count(env, 'notifications'), count(env, 'guardian_link_codes')) == before


def test_one_day_short_of_13_is_still_refused_and_the_13th_birthday_is_allowed(env):
    assert signup(env, birthdate=years_ago(13, days=1).isoformat()).status_code == 403   # turns 13 tomorrow
    ok = signup(env, birthdate=years_ago(13).isoformat())
    assert ok.status_code == 200, ok.text


def test_any_role_with_an_under_13_birthdate_is_refused(env):
    assert signup(env, role='Surfer', birthdate=years_ago(8).isoformat()).status_code == 403


def test_a_grom_account_needs_a_birthdate(env):
    before = count(env, 'profiles')
    r = signup(env, birthdate=None)
    assert r.status_code == 400 and 'birthdate' in r.json()['detail'].lower()
    assert count(env, 'profiles') == before


def test_a_13_year_old_signs_up_private_unlinked_with_a_code_not_a_parent_id(env):
    r = signup(env)
    assert r.status_code == 200, r.text
    with sqlite3.connect(env.db_path) as conn:
        row = conn.execute("select parent_id, parent_link_approved, is_private, guardian_code from profiles "
                           "where email='kid@example.com'").fetchone()
    assert row[0] is None and not row[1] and row[2] == 1 and row[3] is None
    assert count(env, 'guardian_link_codes') == 1


def test_the_parent_first_hook_is_off_by_default_and_changes_no_refusal(env, monkeypatch):
    monkeypatch.delenv(policy.PARENT_FIRST_FLAG, raising=False)
    assert policy.parent_first_creation_enabled() is False
    monkeypatch.setenv(policy.PARENT_FIRST_FLAG, 'true')
    assert policy.parent_first_creation_enabled() is True
    assert signup(env, birthdate=years_ago(9).isoformat()).status_code == 403   # still refused: P3 owns the creation


# ------------------------------------------------------------------------------------------- L0: browse only

def comment(client, user):
    return client.post('/api/posts/post-open/comments', headers=auth(user), json={'content': 'hello'})


@pytest.mark.parametrize('user', ['t14_l0', 't17_l0'])
def test_l0_is_browse_only_in_every_band(env, user):
    r = comment(env, user)
    assert r.status_code == 403 and 'links your account' in r.json()['detail']
    assert env.post('/api/posts/post-open/like', headers=auth(user)).status_code == 403


@pytest.mark.parametrize('user', ['t14_l1', 't14_l2', 't17_l1', 'k10_l1'])
def test_l1_unlocks_commenting(env, user):
    assert comment(env, user).status_code == 200


def test_a_grom_over_18_has_no_guardian_gate(env):
    assert comment(env, 'adult18').status_code == 200


def test_no_birthdate_and_no_guardian_is_locked(env):
    assert refusal_for(Profile(role=RoleEnum.GROM, birthdate=None, parent_id=None, parent_link_approved=False),
                       'comment') is not None


# ------------------------------------------------------------------------------------------- the table itself

def standing(level, band):
    return GuardianStanding(level=level, band=band, age=None, guardian_id='g1' if level != L0 else None)


@pytest.mark.parametrize('band, feature, need', [
    (UNDER_13, 'browse', L0), (UNDER_13, 'comment', L1), (UNDER_13, 'message', L1),
    (UNDER_13, 'public_profile', L2), (UNDER_13, 'photo', L2), (UNDER_13, 'money', L2),
    (TEEN_13_15, 'browse', L0), (TEEN_13_15, 'comment', L1), (TEEN_13_15, 'message', L1),
    (TEEN_13_15, 'public_profile', L2), (TEEN_13_15, 'photo', L2), (TEEN_13_15, 'money', L2),
    (TEEN_16_17, 'browse', L0), (TEEN_16_17, 'comment', L1), (TEEN_16_17, 'message', L1),
    (TEEN_16_17, 'public_profile', L1), (TEEN_16_17, 'photo', L1), (TEEN_16_17, 'money', L1),
    (UNKNOWN, 'photo', L2), (UNKNOWN, 'comment', L1), (ADULT, 'money', None)])
def test_the_policy_table(band, feature, need):
    assert policy.required_level(band, feature) == need


def test_is_allowed_follows_the_floor():
    assert policy.is_allowed(standing(L1, TEEN_13_15), 'comment')
    assert not policy.is_allowed(standing(L1, TEEN_13_15), 'photo')
    assert policy.is_allowed(standing(L2, TEEN_13_15), 'photo')
    assert policy.is_allowed(standing(L1, TEEN_16_17), 'photo')
    assert not policy.is_allowed(standing(L0, TEEN_16_17), 'comment')
    assert policy.is_allowed(GuardianStanding(None, ADULT, 30, None), 'money')       # not a Grom


# ------------------------------------------------------------------------------------------- photo / likeness

def upload(client, user):
    return client.post(f'/api/grom-hq/groms/{user}/media', headers=auth(user),
                       files={'file': ('a.jpg', b'x', 'image/jpeg')})


@pytest.mark.parametrize('user', ['t14_l0', 't14_l1', 'k10_l1', 't17_l0', 'nobd'])
def test_media_upload_is_refused_below_the_photo_level(env, user):
    r = upload(env, user)
    assert r.status_code == 403, r.text


def test_the_refusal_says_whether_a_link_or_a_verified_guardian_is_missing(env):
    assert 'verified' in upload(env, 't14_l1').json()['detail']          # linked but not verified: needs L2
    assert 'links your account' in upload(env, 't14_l0').json()['detail']  # unlinked: needs L1


@pytest.mark.parametrize('user', ['t14_l2', 'k10_l2', 't17_l1', 't17_l2'])
def test_media_upload_passes_at_the_photo_level(env, user):
    r = upload(env, user)
    assert r.status_code == 200, r.text


def post_body():
    return {'media_url': 'https://example.invalid/x.jpg'}


@pytest.mark.parametrize('user, refused', [('t14_l1', True), ('k10_l1', True), ('t14_l2', False), ('t17_l1', False)])
def test_posting_follows_the_photo_level(env, user, refused):
    r = env.post('/api/posts', params={'author_id': user}, headers=auth(user), json=post_body())
    if refused:
        assert r.status_code == 403, r.text
    else:
        assert r.status_code != 403, r.text     # past the level gate (the protected-media rule answers next)


def story(client, user):
    return client.post('/api/stories', params={'author_id': user}, headers=auth(user),
                       json={'media_url': 'https://example.invalid/x.jpg', 'media_type': 'image'})


def test_a_story_follows_the_photo_level(env):
    refused = story(env, 't14_l1')
    assert refused.status_code == 403 and 'verified' in refused.json()['detail']
    assert story(env, 't14_l0').status_code == 403
    # at the level the gate passes and the protected-media rule answers next (409), not the level
    assert story(env, 't14_l2').status_code == 409


# ------------------------------------------------------------------------------------------- public profile (+ notice)

def go_public(client, user):
    return client.patch(f'/api/profiles/{user}', headers=auth(user), json={'is_private': False})


@pytest.mark.parametrize('user', ['t14_l0', 't14_l1', 'k10_l1', 't17_l0'])
def test_a_public_profile_is_refused_below_the_level(env, user):
    assert go_public(env, user).status_code == 403


@pytest.mark.parametrize('user', ['t14_l2', 'k10_l2', 't17_l1', 't17_l2'])
def test_a_public_profile_is_allowed_at_the_level(env, user):
    assert go_public(env, user).status_code == 200


def test_the_privacy_settings_route_obeys_the_same_level(env):
    refused = env.put('/api/friends/privacy/t14_l1', headers=auth('t14_l1'), json={'is_private': False})
    assert refused.status_code == 403
    ok = env.put('/api/friends/privacy/t14_l2', headers=auth('t14_l2'), json={'is_private': False})
    assert ok.status_code == 200
    assert env.put('/api/friends/privacy/t14_l1', headers=auth('t14_l1'), json={'is_private': True}).status_code == 200


def notices(client, guardian):
    with sqlite3.connect(client.db_path) as conn:
        return conn.execute("select count(*) from notifications where user_id=? and type='grom_activity_notice'",
                            (guardian,)).fetchone()[0]


def test_a_16_17_at_l1_going_public_notifies_the_guardian(env):
    assert go_public(env, 't17_l1').status_code == 200
    assert notices(env, 'g1') == 1


def test_a_13_15_going_public_at_l2_sends_no_teen_notice(env):
    assert go_public(env, 't14_l2').status_code == 200
    assert notices(env, 'g2') == 0


def test_staying_private_is_always_allowed(env):
    assert env.patch('/api/profiles/t14_l0', headers=auth('t14_l0'), json={'is_private': True}).status_code == 200


def test_other_accounts_are_untouched(env):
    assert env.patch('/api/profiles/owner', headers=auth('owner'), json={'is_private': False}).status_code == 200


# ------------------------------------------------------------------------------------------- money

def buy(client, user):
    return client.post(f'/api/grom-hq/purchase-request/{user}', headers=auth(user),
                       json={'item_type': 'gear_item', 'item_name': 'Leash', 'amount': 10.0})


@pytest.mark.parametrize('user', ['t14_l1', 'k10_l1', 't14_l0'])
def test_money_is_refused_below_the_level_for_under_16(env, user):
    assert buy(env, user).status_code in (400, 403)
    assert count(env, 'notifications') == 0       # nothing reached a guardian


def test_money_for_a_13_15_needs_the_verified_guardian_and_still_goes_to_approval(env):
    r = buy(env, 't14_l2')
    assert r.status_code == 200, r.text
    assert r.json()['already_pending'] is False       # a request for the guardian to approve, never a charge


def test_money_for_a_16_17_at_l1_is_a_request_for_approval(env):
    r = buy(env, 't17_l1')
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------------------------------- what the screen is told

def test_grom_status_tells_the_screen_what_is_unlocked(env):
    body = env.get('/api/grom-hq/grom-status/t14_l1', headers=auth('t14_l1')).json()
    assert body['guardian_level'] == L1 and body['age_band'] == TEEN_13_15
    assert body['unlocked']['comment'] == {'allowed': True, 'needs': L1}
    assert body['unlocked']['photo'] == {'allowed': False, 'needs': L2}
    assert env.get('/api/grom-hq/grom-status/t17_l1', headers=auth('t17_l1')).json()['unlocked']['photo']['allowed'] is True
    assert env.get('/api/grom-hq/grom-status/t14_l0', headers=auth('t14_l0')).json()['unlocked']['comment']['allowed'] is False


def test_linked_groms_carries_each_childs_level(env):
    body = env.get('/api/grom-hq/linked-groms/g2', headers=auth('g2')).json()
    levels = {g['id']: g['guardian_level'] for g in body['linked_groms']}
    assert levels == {'t14_l2': L2, 't17_l2': L2, 'k10_l2': L2}
    assert env.get('/api/grom-hq/linked-groms/g2', headers=auth('g2')).json()['linked_groms'][0]['unlocked']
