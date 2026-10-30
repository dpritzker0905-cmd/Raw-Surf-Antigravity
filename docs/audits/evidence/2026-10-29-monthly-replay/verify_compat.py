"""Retain the prior 17-case matrix; adapt only the newly required schema/reset."""
import importlib.util,sys,json
from pathlib import Path
R=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('prior_monthly_matrix',R/'docs/audits/evidence/2026-10-29-monthly-leaderboard-trophies/verify_monthly.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
from models import MonthlyLeaderboardArchive
from sqlalchemy import delete
old_initialize,old_reset=base.initialize,base.reset
async def initialize():
 await old_initialize()
 async with base.database.engine.begin() as conn:await conn.run_sync(lambda sync:MonthlyLeaderboardArchive.__table__.create(sync))
async def reset():
 async with base.database.AsyncSessionLocal() as db:await db.execute(delete(MonthlyLeaderboardArchive));await db.commit()
 await old_reset()
base.initialize,base.reset=initialize,reset
if __name__=='__main__':sys.exit(base.loop.run_until_complete(base.main()))
