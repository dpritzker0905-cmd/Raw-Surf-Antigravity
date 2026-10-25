"""Guardian links, PR 1 (audit 2026-10-18 F-01; policy docs/runbooks/GUARDIAN-LEVELS.md).

The audit's proof: a Shop account that set `is_grom_parent` on its own profile could `link-grom` ANY unlinked child
and then read the child's activity and spending. This file replays that attack against the real routers (real JWTs,
real SQLite file, nothing leaves the process) and pins the fix: a link needs the CHILD's account to take part.

Cast
  shop        a SHOP account that self-flagged `is_grom_parent` (the attacker)        mum   an honest adult (SURFER)
  teen        13-15, unlinked                                                          kid   under 13, unlinked
  teen2       13-15, unlinked (a second child, to prove a code is bound to one child)  claimed  parent_id='shop' but NOT approved
  legacy      linked and approved to `old_mum` before two-sided proof existed         minor_adult  a GROM account
"""
import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from core.security import create_access_token
from database import Base, get_db
from models import Profile, RoleEnum
from routes.auth_pkg.auth import hash_password
from routes.grom_hq import router as grom_hq_router
from routes.profiles import router as profiles_router
from services import guardian_links
from services.guardian_exposure import compute_exposure
from services.guardian_levels import (
    L0, L1, L2, ADULT, TEEN_13_15, TEEN_16_17, UNDER_13, UNKNOWN, age_band, effective_band, guardian_level,
)

TODAY = date(2026, 10, 25)
PASSWORD = 'correct-horse-battery'


def auth(user):
    return {'Authorization': f'Bearer {create_access_token({"sub": user})}'}


def years_ago(n):
    return date(TODAY.year - n, 1, 1)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.delenv('RENDER', raising=False)
    path = tmp_path / 'guardian.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    with sessionmaker(sync_engine)() as db:
        def add(pid, role, **extra):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=role,
                           full_name=pid.title(), credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0, password_hash=hash_password(PASSWORD), **extra))

        add('shop', RoleEnum.SHOP, is_grom_parent=True)              # self-flagged, never linked to anyone
        add('mum', RoleEnum.SURFER)
        add('dad', RoleEnum.SURFER)
        add('old_mum', RoleEnum.GROM_PARENT)
        add('admin', RoleEnum.SURFER, is_admin=True)
        add('teen', RoleEnum.GROM, birthdate=years_ago(14))
        add('teen2', RoleEnum.GROM, birthdate=years_ago(15))
        add('kid', RoleEnum.GROM, birthdate=years_ago(9))
        add('claimed', RoleEnum.GROM, birthdate=years_ago(14), parent_id='shop', parent_link_approved=False)
        add('legacy', RoleEnum.GROM, birthdate=years_ago(11), parent_id='old_mum', parent_link_approved=True)
        add('minor_adult', RoleEnum.GROM, birthdate=years_ago(16))
        db.commit()
    sync_engine.dispose()

    engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            yield session

    app = FastAPI()
    for router in (grom_hq_router, profiles_router):
        app.include_router(router, prefix='/api')
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        client.db_path = str(path)
        client.maker = maker
        yield client


def sql(client, statement, *params):
    with sqlite3.connect(client.db_path) as conn:
        rows = conn.execute(statement, params).fetchall()
    return rows


def link_state(client, grom):
    return sql(client, 'select parent_id, parent_link_approved from profiles where id=?', grom)[0]


def read_activity(client, actor, grom):
    return client.get(f'/api/grom-hq/activity/{grom}', params={'parent_id': actor}, headers=auth(actor))


def get_code(client, child):
    r = client.post('/api/grom-hq/guardian-code', headers=auth(child))
    assert r.status_code == 200, r.text
    return r.json()['code']


def redeem(client, adult, code):
    return client.post('/api/grom-hq/link-by-code', params={'parent_id': adult, 'guardian_code': code},
                       headers=auth(adult))


# ------------------------------------------------------------------------- F-01: the audit's attack, replayed

def test_a_self_flagged_adult_cannot_link_an_unlinked_child(env):
    r = env.post('/api/grom-hq/link-grom', params={'parent_id': 'shop', 'grom_id': 'teen'}, headers=auth('shop'))
    assert r.status_code == 200, r.text
    assert r.json()['status'] == 'pending_child_confirmation'
    assert link_state(env, 'teen')[0] is None   # NOTHING was linked


def test_the_unlinked_adult_cannot_read_or_control_the_child(env):
    env.post('/api/grom-hq/link-grom', params={'parent_id': 'shop', 'grom_id': 'teen'}, headers=auth('shop'))
    assert read_activity(env, 'shop', 'teen').status_code == 403
    spend = env.get('/api/grom-hq/spending-summary/teen', params={'parent_id': 'shop'}, headers=auth('shop'))
    assert spend.status_code == 403
    ctl = env.post('/api/grom-hq/update-parental-controls/teen', params={'parent_id': 'shop'},
                   headers=auth('shop'), json={'view_only': False})
    assert ctl.status_code == 403
    limits = env.post('/api/grom-hq/spending-controls/teen', params={'parent_id': 'shop'},
                      headers=auth('shop'), json={'monthly_limit': 10000})
    assert limits.status_code == 403
    assert env.get('/api/grom-hq/grom-status/teen', headers=auth('shop')).status_code == 403
    assert env.get('/api/grom-hq/linked-groms/shop', headers=auth('shop')).json()['linked_groms'] == []


def test_a_bare_parent_id_claim_carries_no_authority(env):
    """`claimed` names shop as parent_id but nothing confirmed it (the old signup / link-grom left rows like this)."""
    assert read_activity(env, 'shop', 'claimed').status_code == 403
    assert env.get('/api/grom-hq/linked-groms/shop', headers=auth('shop')).json()['linked_groms'] == []
    approve = env.post('/api/grom-hq/approve-grom-link/claimed', params={'parent_id': 'shop'}, headers=auth('shop'))
    assert approve.status_code == 403            # a guardian cannot approve their own link
    assert link_state(env, 'claimed')[1] in (0, None)


def test_the_flag_cannot_be_set_through_the_profile_route(env):
    r = env.patch('/api/profiles/mum', headers=auth('mum'), json={'is_grom_parent': True})
    assert r.status_code == 403, r.text
    assert sql(env, 'select is_grom_parent from profiles where id=?', 'mum')[0][0] in (0, None)
    ok = env.patch('/api/profiles/mum', headers=auth('mum'), json={'bio': 'surfs'})
    assert ok.status_code != 403


def test_a_self_flagged_account_cannot_redeem_without_the_childs_code(env):
    assert redeem(env, 'shop', 'ABCD-EFGH').status_code == 400
    assert link_state(env, 'teen')[0] is None


# ------------------------------------------------------------------------- the child's code

def test_a_child_code_links_that_child_and_the_guardian_can_then_read(env):
    code = get_code(env, 'teen')
    r = redeem(env, 'mum', code)
    assert r.status_code == 200, r.text
    assert r.json()['grom']['id'] == 'teen'
    assert link_state(env, 'teen') == ('mum', 1)
    assert read_activity(env, 'mum', 'teen').status_code == 200
    # the derived flag follows the confirmed link
    assert sql(env, 'select is_grom_parent from profiles where id=?', 'mum')[0][0] == 1
    # and the verified relationship record exists
    assert sql(env, 'select count(*) from grom_guardians where grom_id=? and guardian_id=? and verified_at is not null',
               'teen', 'mum')[0][0] == 1


def test_a_code_is_single_use(env):
    code = get_code(env, 'teen')
    assert redeem(env, 'mum', code).status_code == 200
    again = redeem(env, 'dad', code)
    assert again.status_code == 400
    assert link_state(env, 'teen')[0] == 'mum'


def test_the_single_use_gate_is_atomic_when_two_redemptions_race(env):
    """Both callers read the code as open; only one UPDATE can flip consumed_at, so only one can link."""
    import asyncio
    from fastapi import HTTPException
    from sqlalchemy import select
    from models import GuardianLinkCode

    code = get_code(env, 'teen')

    async def run():
        async with env.maker() as a, env.maker() as b:
            stale_row = (await b.execute(select(GuardianLinkCode))).scalars().one()
            stale_child = (await b.execute(select(Profile).where(Profile.id == 'teen'))).scalar_one()
            dad_b = (await b.execute(select(Profile).where(Profile.id == 'dad'))).scalar_one()
            mum_a = (await a.execute(select(Profile).where(Profile.id == 'mum'))).scalar_one()
            await guardian_links.redeem_child_code(a, mum_a, code)
            with pytest.raises(HTTPException) as lost:
                await guardian_links._link(b, stale_child, dad_b, stale_row)
            return lost.value.status_code
    assert asyncio.run(run()) == 400
    assert link_state(env, 'teen') == ('mum', 1)


def test_a_code_is_bound_to_the_child_that_made_it(env):
    code = get_code(env, 'teen')
    redeem(env, 'mum', code)
    assert link_state(env, 'teen2')[0] is None and link_state(env, 'kid')[0] is None


def test_a_code_expires_after_48_hours(env):
    code = get_code(env, 'teen')
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S.%f')
    sql_conn = sqlite3.connect(env.db_path)
    sql_conn.execute('update guardian_link_codes set expires_at=?', (past,))
    sql_conn.commit()
    sql_conn.close()
    assert redeem(env, 'mum', code).status_code == 400
    assert link_state(env, 'teen')[0] is None


def test_the_code_lives_exactly_48_hours(env):
    r = env.post('/api/grom-hq/guardian-code', headers=auth('teen')).json()
    assert r['valid_hours'] == 48
    assert guardian_links.CODE_TTL == timedelta(hours=48)


def test_asking_again_revokes_the_earlier_code(env):
    first = get_code(env, 'teen')
    second = get_code(env, 'teen')
    assert redeem(env, 'mum', first).status_code == 400
    assert redeem(env, 'mum', second).status_code == 200


def test_the_database_never_holds_a_usable_code(env):
    code = get_code(env, 'teen')
    stored = sql(env, 'select code_hash from guardian_link_codes')[0][0]
    assert code.replace('-', '') not in stored and len(stored) == 64


def test_a_child_account_cannot_be_the_guardian(env):
    # no birthdate on the account: only the Grom role says it is a child (the stated-age rule cannot catch it)
    conn = sqlite3.connect(env.db_path)
    conn.execute("update profiles set birthdate=NULL where id='minor_adult'")
    conn.commit()
    conn.close()
    code = get_code(env, 'teen')
    assert redeem(env, 'minor_adult', code).status_code == 403
    assert link_state(env, 'teen')[0] is None


def test_only_a_child_account_can_ask_for_a_code(env):
    assert env.post('/api/grom-hq/guardian-code', headers=auth('mum')).status_code == 403


def test_a_stated_minor_cannot_be_a_guardian(env):
    sql_conn = sqlite3.connect(env.db_path)
    sql_conn.execute("update profiles set birthdate=? where id='dad'", (years_ago(16).isoformat(),))
    sql_conn.commit()
    sql_conn.close()
    assert redeem(env, 'dad', get_code(env, 'teen')).status_code == 403


def test_a_linked_child_cannot_be_linked_again(env):
    assert redeem(env, 'mum', get_code(env, 'teen')).status_code == 200
    assert env.post('/api/grom-hq/guardian-code', headers=auth('teen')).status_code == 409
    invite = env.post('/api/grom-hq/link-grom', params={'parent_id': 'dad', 'grom_id': 'teen'}, headers=auth('dad'))
    assert invite.status_code == 409


def test_guessing_codes_never_links(env):
    # (the limiter trusts local addresses, so this proves the failure path only; the 429 is core.rate_limiter's)
    assert {redeem(env, 'shop', f'BCDF-GH{i:02d}'.replace('0', 'K').replace('1', 'M')).status_code
            for i in range(10)} <= {400, 429}
    assert link_state(env, 'teen')[0] is None


# ------------------------------------------------------------------------- the parent's invite

def invite(env, adult, grom):
    return env.post('/api/grom-hq/link-grom', params={'parent_id': adult, 'grom_id': grom}, headers=auth(adult))


def test_an_invite_links_only_when_the_child_confirms(env):
    inv = invite(env, 'mum', 'teen').json()
    assert link_state(env, 'teen')[0] is None
    listed = env.get('/api/grom-hq/guardian-invites', headers=auth('teen')).json()
    assert [i['invite_id'] for i in listed['incoming']] == [inv['invite_id']]
    sent = env.get('/api/grom-hq/guardian-invites', headers=auth('mum')).json()
    assert [i['invite_id'] for i in sent['outgoing']] == [inv['invite_id']]
    ok = env.post(f"/api/grom-hq/guardian-invites/{inv['invite_id']}/confirm", headers=auth('teen'))
    assert ok.status_code == 200, ok.text
    assert link_state(env, 'teen') == ('mum', 1)
    assert read_activity(env, 'mum', 'teen').status_code == 200


def test_only_the_invited_child_can_confirm(env):
    inv = invite(env, 'mum', 'teen').json()['invite_id']
    assert env.post(f'/api/grom-hq/guardian-invites/{inv}/confirm', headers=auth('teen2')).status_code == 404
    assert env.post(f'/api/grom-hq/guardian-invites/{inv}/confirm', headers=auth('mum')).status_code == 403
    assert env.post(f'/api/grom-hq/guardian-invites/{inv}/confirm', headers=auth('shop')).status_code == 403
    assert link_state(env, 'teen')[0] is None


def test_an_invite_is_single_use_and_can_be_declined(env):
    inv = invite(env, 'mum', 'teen').json()['invite_id']
    assert env.post(f'/api/grom-hq/guardian-invites/{inv}/confirm', headers=auth('teen')).status_code == 200
    assert env.post(f'/api/grom-hq/guardian-invites/{inv}/confirm', headers=auth('teen')).status_code == 404
    inv2 = invite(env, 'dad', 'teen2').json()['invite_id']
    assert env.post(f'/api/grom-hq/guardian-invites/{inv2}/decline', headers=auth('teen2')).status_code == 200
    assert env.post(f'/api/grom-hq/guardian-invites/{inv2}/confirm', headers=auth('teen2')).status_code == 404
    assert link_state(env, 'teen2')[0] is None


def test_an_invite_expires_after_48_hours(env):
    inv = invite(env, 'mum', 'teen').json()['invite_id']
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S.%f')
    conn = sqlite3.connect(env.db_path)
    conn.execute('update guardian_link_codes set expires_at=?', (past,))
    conn.commit()
    conn.close()
    assert env.post(f'/api/grom-hq/guardian-invites/{inv}/confirm', headers=auth('teen')).status_code == 404
    assert link_state(env, 'teen')[0] is None


def test_an_adult_cannot_flood_children_with_invites(env):
    conn = sqlite3.connect(env.db_path)
    for i in range(5):
        conn.execute("insert into profiles (id,user_id,email,username,role,full_name,credit_balance,withdrawable_credits,"
                     "gear_only_credits,total_credits_given,is_grom_parent,password_hash) values (?,?,?,?,'GROM','x',0,0,0,0,0,'x')",
                     (f'c{i}', f'c{i}', f'c{i}@e.invalid', f'c{i}'))
    conn.commit()
    conn.close()
    assert [invite(env, 'shop', f'c{i}').status_code for i in range(5)] == [200] * 5
    assert invite(env, 'shop', 'teen').status_code == 429      # the cap is five open invites


def test_an_invite_to_a_non_child_is_refused(env):
    assert invite(env, 'mum', 'dad').status_code == 404


def test_a_child_cannot_invite(env):
    r = env.post('/api/grom-hq/link-grom', params={'parent_id': 'teen', 'grom_id': 'teen2'}, headers=auth('teen'))
    assert r.status_code == 403


# ------------------------------------------------------------------------- unlink recomputes the flag

def test_unlinking_the_last_child_clears_the_derived_flag(env):
    redeem(env, 'mum', get_code(env, 'teen'))
    assert sql(env, 'select is_grom_parent from profiles where id=?', 'mum')[0][0] == 1
    r = env.post('/api/grom-hq/unlink-grom/teen', params={'parent_id': 'mum'}, headers=auth('mum'),
                 json={'password': PASSWORD})
    assert r.status_code == 200, r.text
    assert link_state(env, 'teen')[0] is None
    assert sql(env, 'select is_grom_parent from profiles where id=?', 'mum')[0][0] == 0
    assert sql(env, 'select count(*) from grom_guardians where revoked_at is null')[0][0] == 0
    assert read_activity(env, 'mum', 'teen').status_code == 403


def test_an_unconfirmed_adult_cannot_unlink(env):
    r = env.post('/api/grom-hq/unlink-grom/claimed', params={'parent_id': 'shop'}, headers=auth('shop'),
                 json={'password': PASSWORD})
    assert r.status_code == 403


# ------------------------------------------------------------------------- legacy rows

def test_a_legacy_confirmed_link_keeps_working_and_is_reported_as_unproven(env):
    assert read_activity(env, 'old_mum', 'legacy').status_code == 200
    import asyncio

    async def run():
        async with env.maker() as db:
            return await compute_exposure(db, today=TODAY)
    report = asyncio.run(run())
    assert report['by_age_band']['under_13']['confirmed_legacy'] == '<5'
    assert report['by_age_band']['13_15']['pending_claim'] == '<5'


def test_the_status_route_no_longer_hands_out_a_permanent_code(env):
    body = env.get('/api/grom-hq/grom-status/teen', headers=auth('teen')).json()
    assert body['guardian_code'] is None and body['guardian_level'] == L0 and body['age_band'] == TEEN_13_15
    assert body['is_linked'] is False and body['is_approved'] is False


# ------------------------------------------------------------------------- demo verification is unreachable in production

def _demo(env, user='old_mum'):
    return env.post(f'/api/grom-hq/demo-verify-age/{user}', headers=auth(user))


def _verified(env, user='old_mum'):
    return sql(env, 'select parent_age_verified from profiles where id=?', user)[0][0]


def test_demo_verify_is_unreachable_on_a_deployment_even_with_the_env_var(env, monkeypatch):
    monkeypatch.setenv('ALLOW_GROM_DEMO_VERIFY', 'true')
    monkeypatch.setenv('RENDER', 'true')
    assert _demo(env).status_code == 404
    assert not _verified(env)


def test_demo_verify_is_unreachable_when_production_is_declared(env, monkeypatch):
    monkeypatch.setenv('ALLOW_GROM_DEMO_VERIFY', 'true')
    monkeypatch.setenv('ENV', 'production')
    assert _demo(env).status_code == 404
    assert not _verified(env)


def test_demo_verify_is_unreachable_when_the_environment_says_nothing(env, monkeypatch):
    monkeypatch.setenv('ALLOW_GROM_DEMO_VERIFY', 'true')
    for var in ('TESTING', 'ENV', 'ENVIRONMENT', 'NODE_ENV', 'ALLOW_DEV_MOCK_AUTH', 'IS_PROD'):
        monkeypatch.delenv(var, raising=False)
    assert _demo(env).status_code == 404       # absence of a signal is not a signal
    assert not _verified(env)


def test_demo_verify_is_off_locally_unless_asked_for(env, monkeypatch):
    monkeypatch.delenv('ALLOW_GROM_DEMO_VERIFY', raising=False)
    assert _demo(env).status_code == 404


def test_demo_verify_works_only_on_a_local_process_that_opts_in(env, monkeypatch):
    monkeypatch.setenv('ALLOW_GROM_DEMO_VERIFY', 'true')
    monkeypatch.setenv('TESTING', '1')
    assert _demo(env).status_code == 200
    assert _verified(env)


# ------------------------------------------------------------------------- guardian_level: the single source for gates

def _profile(**kw):
    base = dict(id='c', role=RoleEnum.GROM, birthdate=None, parent_id=None, parent_link_approved=False)
    base.update(kw)
    return Profile(**base)


@pytest.mark.parametrize('years, band', [(5, UNDER_13), (12, UNDER_13), (13, TEEN_13_15), (15, TEEN_13_15),
                                         (16, TEEN_16_17), (17, TEEN_16_17), (18, ADULT), (40, ADULT)])
def test_age_bands_at_the_boundaries(years, band):
    assert age_band(years_ago(years), TODAY) == band


def test_a_birthday_not_yet_reached_counts_the_younger_band():
    assert age_band(date(2013, 12, 1), TODAY) == UNDER_13        # turns 13 in December
    assert age_band(date(2013, 10, 25), TODAY) == TEEN_13_15      # turned 13 today


def test_no_birthdate_is_unknown_and_gates_as_under_13():
    assert age_band(None, TODAY) == UNKNOWN
    assert effective_band(UNKNOWN) == UNDER_13


def _level(env, make_child, guardian_verified=None):
    import asyncio

    async def run():
        async with env.maker() as db:
            return await guardian_level(db, make_child, TODAY)
    return asyncio.run(run())


def test_levels_l0_l1_l2(env):
    # L0: no confirmed link, and a bare claim is still L0
    assert _level(env, _profile(parent_id='mum', parent_link_approved=False)).level == L0
    assert _level(env, _profile()).level == L0
    # L1: confirmed, guardian not verified
    s = _level(env, _profile(parent_id='mum', parent_link_approved=True, birthdate=years_ago(14)))
    assert (s.level, s.band, s.guardian_id) == (L1, TEEN_13_15, 'mum') and s.at_least(L1) and not s.at_least(L2)
    # L2: confirmed + guardian is age-verified
    conn = sqlite3.connect(env.db_path)
    conn.execute("update profiles set parent_age_verified=1 where id='mum'")
    conn.commit()
    conn.close()
    s2 = _level(env, _profile(parent_id='mum', parent_link_approved=True, birthdate=years_ago(16)))
    assert (s2.level, s2.band) == (L2, TEEN_16_17) and s2.at_least(L2)


def test_a_dangling_or_minor_guardian_is_not_a_guardian(env):
    assert _level(env, _profile(parent_id='ghost', parent_link_approved=True)).level == L0
    assert _level(env, _profile(parent_id='teen2', parent_link_approved=True)).level == L0


def test_a_non_child_has_no_level(env):
    s = _level(env, _profile(role=RoleEnum.SURFER, birthdate=years_ago(30)))
    assert s.level is None and s.band == ADULT and not s.at_least(L0)


# ------------------------------------------------------------------------- the exposure report

def test_the_exposure_route_is_admin_only_and_returns_counts_not_people(env):
    assert env.get('/api/grom-hq/admin/guardian-exposure', headers=auth('mum')).status_code in (401, 403)
    assert env.get('/api/grom-hq/admin/guardian-exposure').status_code in (401, 403)
    r = env.get('/api/grom-hq/admin/guardian-exposure', headers=auth('admin'))
    assert r.status_code == 200, r.text
    text = r.text
    for private in ('"teen"', '"kid"', '"shop"', 'example.invalid', 'old_mum', 'Teen', 'Kid'):
        assert private not in text, private
    assert set(r.json()) == {'generated_at', 'small_cell_rule', 'total_groms', 'by_age_band', 'signals', 'legend'}


def test_small_cells_are_masked_and_large_ones_are_exact(env):
    import asyncio
    conn = sqlite3.connect(env.db_path)
    for i in range(7):
        conn.execute("insert into profiles (id,user_id,email,username,role,full_name,credit_balance,withdrawable_credits,"
                     "gear_only_credits,total_credits_given,is_grom_parent,password_hash,birthdate) values (?,?,?,?,'GROM','x',0,0,0,0,0,'x',?)",
                     (f'bulk{i}', f'bulk{i}', f'b{i}@e.invalid', f'bulk{i}', years_ago(10).isoformat()))
    conn.commit()
    conn.close()

    async def run():
        async with env.maker() as db:
            return await compute_exposure(db, today=TODAY)
    report = asyncio.run(run())
    assert report['by_age_band']['under_13']['no_guardian'] == 8        # kid + 7 bulk: exact above the floor
    assert report['by_age_band']['under_13']['confirmed_legacy'] == '<5'
    assert report['signals']['adults_with_self_set_parent_flag_and_no_confirmed_child'] == '<5'
