"""Report and all personal-log routes use real JWT identity before any SQL."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from core.security import create_access_token
from database import get_db
from routes.surf_data import surf_reports, surf_log


class DB:
    def __init__(self): self.queries = []; self.rows = []; self.commits = 0
    async def execute(self, statement):
        self.queries.append(statement)
        if 'FROM surf_log_entries' in str(statement):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []), scalar_one_or_none=lambda: None)
        return SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(id='fixture', name='Fixture Beach'))
    def add(self, row): self.rows.append(row)
    async def commit(self): self.commits += 1
    async def refresh(self, row): row.id = 'fixture'; row.created_at = datetime.now(timezone.utc)


def call(method, path, actor, body=None):
    db = DB()
    app = FastAPI(); app.include_router(surf_reports.router); app.include_router(surf_log.router)
    async def database(): yield db
    app.dependency_overrides[get_db] = database
    async def perform():
        headers = {} if actor is None else {'Authorization': 'Bearer ' + create_access_token({'sub': actor})}
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://offline.invalid') as c:
            return await c.request(method, path, json=body, headers=headers)
    return asyncio.run(perform()), db


CASES = [('POST', '/surf-reports?user_id=owner', {'spot_id': 'spot', 'rating': 5}),
    ('POST', '/surf-log/owner', {'session_date': '2026-10-04'}),
    ('GET', '/surf-log/owner', None), ('GET', '/surf-log/owner/entry', None),
    ('PATCH', '/surf-log/owner/entry', {}), ('DELETE', '/surf-log/owner/entry', None),
    ('GET', '/surf-log/owner/stats', None)]


@pytest.mark.parametrize('method,path,body', CASES)
@pytest.mark.parametrize('actor', [None, 'foreign'])
def test_observer_authority_refuses_before_read_or_write(method, path, body, actor):
    response, db = call(method, path, actor, body)
    assert response.status_code == (401 if actor is None else 403)
    assert not db.queries and not db.rows and db.commits == 0


@pytest.mark.parametrize('rating', [0, 6, -1, 100])
def test_rating_schema_refuses_out_of_range_observation(rating):
    response, db = call('POST', '/surf-reports?user_id=owner', 'owner', {'spot_id': 'spot', 'rating': rating})
    assert response.status_code == 422 and not db.rows and db.commits == 0


@pytest.mark.parametrize('rating', [1, 5, None])
def test_authenticated_report_persists_verified_observer(rating):
    response, db = call('POST', '/surf-reports?user_id=owner', 'owner', {'spot_id': 'spot', 'rating': rating})
    assert response.status_code == 200 and db.commits == 1
    assert len(db.rows) == 1 and db.rows[0].user_id == 'owner' and db.rows[0].rating == rating


def test_owned_stats_route_is_not_shadowed_by_entry_id():
    response, db = call('GET', '/surf-log/owner/stats', 'owner')
    assert response.status_code == 200 and response.json()['total_sessions'] == 0
    assert len(db.queries) == 1
    assert 'id_1' not in db.queries[0].compile().params
