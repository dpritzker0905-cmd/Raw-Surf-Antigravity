"""Positive preconfirmed-family checks: selected actual handlers, local SQLite, no app/env/network startup."""
import ast
import asyncio
import enum
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

import sqlalchemy as sa
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(os.environ['RAW_GUARDIAN_READBACK_OUTPUT'])
OUT.mkdir(parents=True, exist_ok=True)
scope = {'enum': enum}


def load(path, names):
    tree = ast.parse((ROOT / path).read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / path), 'exec'), scope)


load('backend/models/enums.py', ['RoleEnum'])
RoleEnum = scope['RoleEnum']
Base = declarative_base()


class Profile(Base):
    __tablename__ = 'profiles'
    id = sa.Column(sa.String, primary_key=True)
    full_name = sa.Column(sa.String)
    avatar_url = sa.Column(sa.String)
    role = sa.Column(sa.Enum(RoleEnum))
    parent_id = sa.Column(sa.String)
    parent_link_approved = sa.Column(sa.Boolean)
    elite_tier = sa.Column(sa.String)
    badges = sa.Column(sa.Text)
    credit_balance = sa.Column(sa.Float)
    total_xp = sa.Column(sa.Integer)
    created_at = sa.Column(sa.DateTime(timezone=True))


async def standing(db, grom):
    return SimpleNamespace(level='L1', band='TEEN_13_15')


async def pending(db, parent):
    return {'outgoing': []}


scope.update(Profile=Profile, Optional=Optional, Depends=Depends, HTTPException=HTTPException, AsyncSession=AsyncSession,
             select=sa.select, BaseModel=BaseModel, get_db=lambda: None, get_user_id_from_jwt_or_query=lambda: None,
             guardian_level=standing, unlocked=lambda value: {'fixture': True},
             guardian_links=SimpleNamespace(pending_for_user=pending))
load('backend/services/guardian_levels.py', ['is_confirmed_guardian'])
load('backend/routes/grom_hq/schemas.py', ['ToggleCompetitionRequest'])
load('backend/routes/grom_hq/parental.py', ['_profile', 'get_linked_groms', 'toggle_grom_competition'])
cases = []


def check(name, condition):
    cases.append({'name': name, 'passed': bool(condition)})


async def main():
    engine = create_async_engine('sqlite+aiosqlite:///' + str(OUT / 'fictional-competition.db'))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        db.add_all([Profile(id=pid, full_name='Fixture Parent', role=RoleEnum.GROM_PARENT) for pid in ['parent', 'new-parent']])
        for index, tier in enumerate([None, 'grom_rising', 'other_tier']):
            db.add(Profile(id=f'child-{index}', full_name=f'Fixture Child {index}', role=RoleEnum.GROM,
                           parent_id='parent', parent_link_approved=True, elite_tier=tier, badges='["one", "two"]',
                           credit_balance=12.5, total_xp=7, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)))
        await db.commit()

    async def read(parent='parent'):
        async with factory() as db:
            return await scope['get_linked_groms'](parent_id=parent, user_id=parent, db=db)

    original = await read()
    children = {row['id']: row for row in original['linked_groms']}
    for index, tier in enumerate([None, 'grom_rising', 'other_tier']):
        row = children[f'child-{index}']
        check(f'stored tier {tier!r} survives refresh', 'elite_tier' in row and row['elite_tier'] == tier)
    check('existing metadata and aggregate figures preserved', len(children) == 3 and
          all(r['credits_balance'] == 12.5 and r['achievements_count'] == 2 and r['total_xp'] == 7 and
              r['guardian_level'] == 'L1' and r['age_band'] == 'TEEN_13_15' for r in children.values()) and
          original['pending_requests'] == [] and original['stats'] ==
          {'totalEarnings': 37.5, 'totalSessions': 0, 'totalScreenTime': 0, 'achievementsUnlocked': 6})
    for enabled in [True, False]:
        async with factory() as db:
            response = await scope['toggle_grom_competition'](
                grom_id='child-0', parent_id='parent', user_id='parent',
                data=scope['ToggleCompetitionRequest'](competes=enabled), db=db)
        row = next(r for r in (await read())['linked_groms'] if r['id'] == 'child-0')
        expected = 'grom_rising' if enabled else None
        check(f'toggle {enabled} persists through fresh session and next inverse intent',
              response['elite_tier'] == expected and 'elite_tier' in row and row['elite_tier'] == expected and
              (row.get('elite_tier') != 'grom_rising') == (not enabled))
    final = {row['id']: row for row in (await read())['linked_groms']}
    check('other linked children and stats stay unchanged', final['child-1'] == children['child-1'] and
          final['child-2'] == children['child-2'] and (await read())['stats'] == original['stats'])
    check('normal new guardian keeps empty response', await read('new-parent') ==
          {'linked_groms': [], 'pending_requests': [],
           'stats': {'totalEarnings': 0, 'totalSessions': 0, 'totalScreenTime': 0, 'achievementsUnlocked': 0}})
    await engine.dispose()
    result = {'passed': sum(c['passed'] for c in cases), 'total': len(cases), 'cases': cases,
              'selected_actual_handlers': True, 'database': 'disposable local async SQLite',
              'profile_mapping_and_standing_pending_metadata': 'explicit fixture seams',
              'normal_preconfirmed_family_only': True, 'security_scenarios': 0, 'live_requests': 0}
    (OUT / 'readback-results.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return result['passed'] == result['total']


if __name__ == '__main__':
    raise SystemExit(0 if asyncio.run(main()) else 1)
