"""Real route SQL and PostgreSQL enum binding; synthetic results and no network."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from sqlalchemy.dialects import postgresql
from models import DispatchRequest, DispatchRequestStatusEnum
from routes.explore_discover.search import global_search
from routes.profiles.profiles import get_trust_signals
from routes.crew import crew_chat
from routes.content import notes


class Result:
    def __init__(self, rows=(), scalar=0): self.rows = rows; self.value = scalar
    def scalars(self): return self
    def all(self): return self.rows
    def scalar(self): return self.value
    def scalar_one_or_none(self): return self.rows[0] if self.rows else None


class DB:
    def __init__(self, profile=None): self.statements = []; self.profile = profile; self.commits = 0
    async def execute(self, statement):
        self.statements.append(statement)
        if self.profile is not None and len(self.statements) == 1: return Result([self.profile])
        return Result()
    async def commit(self): self.commits += 1


@pytest.mark.parametrize('query,count', [('#wave', 2), ('@user', 1), ('wave', 4), ('##', 0)])
def test_global_search_modes_return_all_result_categories(query, count):
    db = DB()
    result = asyncio.run(global_search(query, 5, db))
    assert result == dict(users=[], spots=[], posts=[], hashtags=[])
    assert len(db.statements) == count


def test_trust_signals_binds_the_declared_postgres_enum_member():
    db = DB(SimpleNamespace(is_verified=False, is_approved_pro=False))
    result = asyncio.run(get_trust_signals('photographer', db))
    assert result['total_sessions'] == 0
    statement = db.statements[2]
    bound = statement.compile(dialect=postgresql.dialect()).params['status_1']
    assert bound is DispatchRequestStatusEnum.COMPLETED
    encoded = DispatchRequest.status.type.bind_processor(postgresql.dialect())(bound)
    assert encoded == 'COMPLETED' and encoded in DispatchRequest.status.type.enums


def test_actual_crew_history_constructs_sql_boolean_and_keeps_access_guard(monkeypatch):
    booking = SimpleNamespace(participants=[], creator_id='captain', photographer_id='photographer', status='Confirmed')
    monkeypatch.setattr(crew_chat, 'verify_chat_access', AsyncMock(return_value=(booking, 'crew')))
    db = DB()
    result = asyncio.run(crew_chat.get_crew_chat_messages('booking', 'owner', 50, None, db, 'owner'))
    assert result['messages'] == [] and 'is_deleted IS false' in str(db.statements[0])
    with pytest.raises(__import__('fastapi').HTTPException):
        asyncio.run(crew_chat.get_crew_chat_messages('booking', 'owner', 50, None, DB(), 'foreign'))


def test_note_mark_read_constructs_unread_predicate_instead_of_constant_false():
    db = DB()
    result = asyncio.run(notes.mark_note_notifications_read('owner', None, db))
    assert result['success'] is True and db.commits == 1
    assert 'is_read IS false' in str(db.statements[0])
