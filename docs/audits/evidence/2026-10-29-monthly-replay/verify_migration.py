"""Run only this migration's functions against disposable fixture storage."""
import importlib.util,sys,json,asyncio
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('monthly_storage_fixture',ROOT/'docs/audits/evidence/2026-10-29-monthly-leaderboard-trophies/verify_monthly.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from sqlalchemy import inspect,text
from alembic.migration import MigrationContext
from alembic.operations import Operations
spec=importlib.util.spec_from_file_location('monthly_replay_migration',ROOT/'backend/alembic/versions/monthly_archive_replay_001.py');migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
checks={}
async def main():
 try:
  await base.initialize()
  async with base.database.engine.begin() as conn:
   def run(sync):
    ctx=MigrationContext.configure(sync)
    with Operations.context(ctx):
     checks['table_initially_absent']=not inspect(sync).has_table('monthly_leaderboard_archives')
     migration.upgrade()
     inspector=inspect(sync);columns={c['name']:c for c in inspector.get_columns('monthly_leaderboard_archives')};pk=inspector.get_pk_constraint('monthly_leaderboard_archives')
     checks['composite_primary_key']=pk['constrained_columns']==['year','month']
     checks['all_columns_nonnullable']=set(columns)=={'year','month','archived_count','completed_at'} and all(not c['nullable'] for c in columns.values())
     if base.fixture_url:checks['native_completion_timestamptz']=sync.execute(text("SELECT data_type FROM information_schema.columns WHERE table_name='monthly_leaderboard_archives' AND column_name='completed_at'")).scalar_one()=='timestamp with time zone'
     sync.execute(text("INSERT INTO monthly_leaderboard_archives(year,month,archived_count,completed_at) VALUES(2025,12,0,CURRENT_TIMESTAMP)"))
     try:migration.downgrade()
     except RuntimeError:checks['downgrade_refuses_even_empty_period_marker']=True
     else:checks['downgrade_refuses_even_empty_period_marker']=False
     checks['marker_preserved_after_refusal']=sync.execute(text('SELECT archived_count FROM monthly_leaderboard_archives')).scalar_one()==0
     if base.fixture_url:checks['downgrade_exclusive_lock_held']=sync.execute(text("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND relation='monthly_leaderboard_archives'::regclass AND mode='AccessExclusiveLock' AND granted)")).scalar_one()
     sync.execute(text('DELETE FROM monthly_leaderboard_archives'));migration.downgrade();checks['empty_table_downgrade']=not inspect(sync).has_table('monthly_leaderboard_archives')
     checks['existing_snapshot_table_untouched']=inspect(sync).has_table('leaderboard_snapshots')
     migration.upgrade();checks['upgrade_after_safe_downgrade']=inspect(sync).has_table('monthly_leaderboard_archives')
   await conn.run_sync(run)
  people,month,year=await base.seed('[]')
  first=await base.finalize();second=await base.finalize()
  await base.awards(people,month,year,'[]')
  checks['migrated_schema_supports_first_and_replay']=first==second==dict(archived=12,month=month,year=year)
 finally:await base.database.engine.dispose()
 print(json.dumps(dict(passed=sum(checks.values()),total=len(checks),timezone_adapter=False,checks=checks,normal_startup=False,only_disposable_migration=True),indent=2));return 0 if all(checks.values()) else 1
if __name__=='__main__':sys.exit(base.loop.run_until_complete(main()))
