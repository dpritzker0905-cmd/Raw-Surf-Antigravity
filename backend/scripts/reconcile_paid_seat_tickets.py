"""From backend, run python -m scripts.reconcile_paid_seat_tickets to count missing support cases."""
import argparse
import asyncio
import json

from sqlalchemy import select

from database import async_session_maker
from models import PaymentTransaction, SupportTicket
from services.support_delivery import support_request_id
from services.support_tickets import is_paid_seat_review, paid_seat_ticket


async def reconcile_paid_seat_tickets(maker, apply=False):
    """Visit existing paid reviews in small pages. Recheck each payment under its checkout lock."""
    missing = created = unreadable = 0
    cursor = ""
    while True:
        async with maker() as db:
            ids = (await db.scalars(select(PaymentTransaction.id).where(
                PaymentTransaction.id > cursor, PaymentTransaction.status == "review_required",
                PaymentTransaction.payment_status.in_(("Paid", "paid")),
            ).order_by(PaymentTransaction.id).limit(100))).all()
        if not ids:
            return {"missing": missing, "created": created, "unreadable": unreadable}
        for tx_id in ids:
            async with maker() as db:
                query = select(PaymentTransaction).where(PaymentTransaction.id == tx_id)
                tx = await db.scalar(query.with_for_update() if apply else query)
                if tx is None:
                    continue
                try:
                    metadata = json.loads(tx.transaction_metadata or "{}")
                except ValueError:
                    unreadable += 1
                    continue
                if not is_paid_seat_review(tx, metadata):
                    continue
                ticket_id = support_request_id("paid-seat", tx.user_id, tx.id)
                if await db.get(SupportTicket, ticket_id) is None:
                    missing += 1
                    if apply:
                        await paid_seat_ticket(db, tx)
                        await db.commit()
                        created += 1
        cursor = ids[-1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create missing tickets and queue opted-in receipts.")
    args = parser.parse_args()
    print(asyncio.run(reconcile_paid_seat_tickets(async_session_maker, apply=args.apply)))
