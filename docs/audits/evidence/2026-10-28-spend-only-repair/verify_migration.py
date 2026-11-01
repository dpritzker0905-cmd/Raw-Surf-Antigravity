"""Offline SQLite migration shape/default/rollback checks. No shared database."""
import importlib.util
from pathlib import Path
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.config import Config
from alembic.script import ScriptDirectory

root=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('bonus_migration',root/'backend/alembic/versions/bonus_spend_only_001.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
engine=sa.create_engine('sqlite:///:memory:')
with engine.begin() as conn:
    for sql in (
        'CREATE TABLE profiles (id TEXT PRIMARY KEY, credit_balance FLOAT)',
        'CREATE TABLE credit_transactions (id TEXT PRIMARY KEY, amount FLOAT)',
        'CREATE TABLE global_pricing_config (id TEXT PRIMARY KEY, pricing_data JSON)',
        'CREATE TABLE live_session_participants (id TEXT PRIMARY KEY)',
        "INSERT INTO profiles VALUES ('legacy',100)",
        "INSERT INTO credit_transactions VALUES ('legacy-tx',100)"):
        conn.execute(sa.text(sql))
    with Operations.context(MigrationContext.configure(conn)):
        m.upgrade()
        row=conn.execute(sa.text('SELECT credit_balance,spend_only_credits FROM profiles')).one()
        assert tuple(row)==(100,0)
        assert conn.execute(sa.text('SELECT spend_only_amount FROM credit_transactions')).scalar()==0
        assert 'credit_package_bonuses' in {c['name'] for c in sa.inspect(conn).get_columns('global_pricing_config')}
        assert 'payment_credit_transaction_id' in {c['name'] for c in sa.inspect(conn).get_columns('live_session_participants')}
        print('PASS upgrade preserves legacy total and adds zero classification/default fields')
        m.downgrade()
        assert 'spend_only_credits' not in {c['name'] for c in sa.inspect(conn).get_columns('profiles')}
        assert conn.execute(sa.text('SELECT credit_balance FROM profiles')).scalar()==100
        print('PASS pristine downgrade preserves legacy total')
        m.upgrade()
        conn.execute(sa.text('UPDATE profiles SET spend_only_credits=15'))
        try:m.downgrade()
        except RuntimeError:pass
        else:raise AssertionError('Downgrade removed live promo classification')
        conn.execute(sa.text('UPDATE profiles SET spend_only_credits=0'))
        conn.execute(sa.text('UPDATE credit_transactions SET spend_only_amount=15'))
        try:m.downgrade()
        except RuntimeError:pass
        else:raise AssertionError('Downgrade removed promo ledger history')
        print('PASS downgrade refuses remaining promotional balance/history')
        conn.execute(sa.text('UPDATE credit_transactions SET spend_only_amount=0'))
        conn.execute(sa.text("INSERT INTO global_pricing_config (id,pricing_data,credit_package_bonuses) VALUES ('offer','{}',:bonus)"),{'bonus':'{"50":0}'})
        try:m.downgrade()
        except RuntimeError:pass
        else:raise AssertionError('Downgrade removed frozen offer history')
        print('PASS downgrade refuses removal of saved offer history')
engine.dispose()
cfg=Config(str(root/'backend/alembic.ini'));cfg.set_main_option('script_location',str(root/'backend/alembic'))
heads=set(ScriptDirectory.from_config(cfg).get_heads())
assert heads=={'bonus_spend_only_001','avatar_url_text_001','6b8bb9b66da7'},heads
print('PASS migration graph extends main lineage without adding or merging pre-existing parallel heads')
print('5/5 migration checks passed; PostgreSQL/shared migration NOT tested or applied')
