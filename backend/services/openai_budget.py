"""Durable fail-closed reservation budget shared by every paid OpenAI caller.

Reservations are deliberately never refunded: a timeout/crash may still be billed.
No process-local counters, resets, lazy initialization, or public mutation endpoints.
"""
import logging
import os
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, MetaData, String, Table, update

from database import AsyncSessionLocal

logger = logging.getLogger(__name__)
CAP_MICRODOLLARS = 10_000_000
RESERVATION_MICRODOLLARS = 350_000
BUDGET_ID = "openai-testing-v1"
PRICE_VALID_UNTIL = date(2026, 11, 15)
# Full context priced as input PLUS the bounded output (overestimates both).
# 5.4-mini: 400k * $0.75/M + 2000 * $4.50/M = $0.309.
# 4o: 128k * $2.50/M + 100 * $10/M = $0.321. Both <= $0.35.
MODEL_OUTPUT_LIMITS = {
    "gpt-5.4-mini": 2000, "gpt-5.4-mini-2026-03-17": 2000,
    "gpt-4o": 100, "gpt-4o-2024-08-06": 100,
}
MODEL_SNAPSHOTS = {"gpt-5.4-mini": "gpt-5.4-mini-2026-03-17", "gpt-4o": "gpt-4o-2024-08-06"}
metadata = MetaData(schema="ai_budget_private")
budget = Table(
    "openai_budget", metadata,
    Column("id", String(40), primary_key=True),
    Column("reserved_microdollars", BigInteger, nullable=False),
    Column("initialized", Boolean, nullable=False),
    CheckConstraint("reserved_microdollars >= 0 AND reserved_microdollars <= 10000000"),
)


class BudgetUnavailable(HTTPException):
    def __init__(self):
        super().__init__(503, "AI is paused: the testing budget is unavailable or exhausted")


def utc_today():
    return datetime.now(timezone.utc).date()


async def reserve_openai_request(model: str, max_output_tokens: int) -> str:
    """Commit an atomic maximum-cost debit BEFORE the single provider attempt."""
    mode = os.environ.get("OPENAI_TEST_BUDGET_ENABLED", "true").strip().lower()
    if mode == "false":
        return MODEL_SNAPSHOTS.get(model, model)  # Explicit opt-out; retain counter for re-enable.
    if (mode != "true" or utc_today() >= PRICE_VALID_UNTIL or
            model not in MODEL_OUTPUT_LIMITS or type(max_output_tokens) is not int or
            not 0 < max_output_tokens <= MODEL_OUTPUT_LIMITS[model]):
        raise BudgetUnavailable()
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                update(budget).where(
                    budget.c.id == BUDGET_ID,
                    budget.c.initialized.is_(True),
                    budget.c.reserved_microdollars <= CAP_MICRODOLLARS - RESERVATION_MICRODOLLARS,
                ).values(reserved_microdollars=budget.c.reserved_microdollars + RESERVATION_MICRODOLLARS)
                .returning(budget.c.reserved_microdollars)
            )
            if result.scalar_one_or_none() is None:
                raise BudgetUnavailable()
            await session.commit()
        return MODEL_SNAPSHOTS.get(model, model)
    except BudgetUnavailable:
        raise
    except Exception:
        # Includes missing migration/row, DB outage and ambiguous commit outcome.
        # Do not retry or contact OpenAI; do not expose DB credentials in errors.
        logger.warning("OpenAI budget reservation unavailable")
        raise BudgetUnavailable() from None
