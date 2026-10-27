"""Operator-only status/one-time initialization. No credentials or auto-reset.

Run from backend: python scripts/openai_budget.py
Initialize only after verifying prior charges, including outstanding requests:
python scripts/openai_budget.py --initialize --prior-spend-upper-bound-usd <amount>
"""
import argparse
import asyncio
from decimal import Decimal, InvalidOperation, ROUND_CEILING
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import select, update
from database import AsyncSessionLocal, engine
from services.openai_budget import budget, BUDGET_ID, CAP_MICRODOLLARS


def prior_microdollars(value):
    try:
        amount = Decimal(value)
        if not amount.is_finite() or not 0 <= amount <= 10:
            raise ValueError()
        return int((amount * 1_000_000).to_integral_value(rounding=ROUND_CEILING))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Prior-spend upper bound must be a finite amount between 0 and 10 USD") from None


async def initialize(factory, prior):
    async with factory() as session:
        result = await session.execute(update(budget).where(
            budget.c.id == BUDGET_ID, budget.c.initialized.is_(False),
            budget.c.reserved_microdollars == CAP_MICRODOLLARS,
        ).values(initialized=True, reserved_microdollars=prior).returning(budget.c.id))
        if result.scalar_one_or_none() is None:
            raise ValueError("Missing or already initialized ledger; refusing to reset spending")
        await session.commit()


async def main(args):
    try:
        if args.initialize:
            await initialize(AsyncSessionLocal, prior_microdollars(args.prior_spend_upper_bound_usd))
        async with AsyncSessionLocal() as session:
            row = (await session.execute(select(budget).where(budget.c.id == BUDGET_ID))).mappings().one()
            print(json.dumps({"initialized": row["initialized"], "limit_usd": 10,
                              "reserved_usd": str(Decimal(row["reserved_microdollars"]) / 1_000_000)}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--prior-spend-upper-bound-usd")
    args = parser.parse_args()
    if args.initialize != (args.prior_spend_upper_bound_usd is not None):
        parser.error("Initialization requires both --initialize and --prior-spend-upper-bound-usd")
    try:
        asyncio.run(main(args))
    except Exception:
        print("Budget operation refused or unavailable; no automatic reset. Check database and ledger state.", file=sys.stderr)
        raise SystemExit(1)
