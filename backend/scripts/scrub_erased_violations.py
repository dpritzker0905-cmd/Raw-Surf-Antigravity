"""One-off: scrub the violation rows of accounts that were erased BEFORE the scrub shipped.

NOT RUN by this change. It needs David's word and a dry-run count first.

    python scripts/scrub_erased_violations.py            # dry run (default): prints counts, writes nothing
    python scripts/scrub_erased_violations.py --apply    # scrubs, in one transaction per account

An "erased" account is one whose profile carries the erasure marker (`suspended_reason` set by
routes/compliance_pkg/gdpr.erase_account) or whose `account_deletions` row is `purged`. Only rows that still hold a
location, an unscrubbed evidence blob or original free text are counted and changed. Idempotent. Needs the database
URL from the environment (name only: DATABASE_URL); no value belongs in this file.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ERASED_REASON = "account deleted at the user's request"


async def run(apply: bool) -> int:
    from sqlalchemy import select

    from database import async_session_maker
    from models import AccountDeletion, Profile, TosViolation
    from services.violation_retention import REMOVED_TEXT, scrub_violations

    def dirty(v) -> bool:
        located = any(getattr(v, c) is not None for c in
                      ("claimed_latitude", "claimed_longitude", "actual_latitude", "actual_longitude"))
        return located or not (v.evidence or {}).get("scrubbed") or v.description != REMOVED_TEXT \
            or v.appeal_text is not None

    async with async_session_maker() as db:
        erased = set((await db.execute(select(Profile.id).where(Profile.suspended_reason == ERASED_REASON)))
                     .scalars().all())
        erased |= set((await db.execute(select(AccountDeletion.profile_id)
                                        .where(AccountDeletion.status == "purged"))).scalars().all())
        todo = {}
        for pid in sorted(erased):
            rows = (await db.execute(select(TosViolation).where(TosViolation.user_id == pid))).scalars().all()
            n = sum(1 for v in rows if dirty(v))
            if n:
                todo[pid] = n
        print(f"erased accounts: {len(erased)}; with unscrubbed violation rows: {len(todo)}; "
              f"rows to scrub: {sum(todo.values())}")
        if not apply:
            print("dry run: nothing written. Re-run with --apply once David has approved the count above.")
            return 0
        for pid in todo:
            await scrub_violations(db, pid)
            await db.commit()
        print(f"scrubbed {sum(todo.values())} rows in {len(todo)} accounts")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    sys.exit(asyncio.run(run(parser.parse_args().apply)))
