"""From backend, run python -m scripts.reconcile_paid_seat_tickets to count missing support cases."""
import argparse
import asyncio

from database import async_session_maker
from services.support_tickets import reconcile_paid_seat_tickets


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create missing tickets and queue opted-in receipts.")
    args = parser.parse_args()
    print(asyncio.run(reconcile_paid_seat_tickets(async_session_maker, apply=args.apply)))
