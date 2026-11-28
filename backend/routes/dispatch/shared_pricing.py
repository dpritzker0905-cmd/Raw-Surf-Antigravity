"""Personal subscription benefits for a targeted, shared on-demand request."""
import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import select

from models import Profile
from routes.subscriptions_billing.photo_sub_helpers import select_access_subscription


def number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise HTTPException(422, f"Invalid {label}.")
    value = Decimal(str(value))
    if not value.is_finite() or value < 0:
        raise HTTPException(422, f"Invalid {label}.")
    return value


def cents(amount):
    return int((amount * 100).to_integral_value(rounding=ROUND_HALF_UP))


def crew_amounts(terms, gross):
    friends = terms.friend_ids
    base, remainder = divmod(gross, len(friends) + 1)
    # Give at most one extra cent per seat, captain first, then guests in stable ID order.
    amounts = {friend: base + int(rank < remainder) for rank, friend in enumerate(sorted(friends), start=1)}
    captain_seat = base + int(remainder > 0)
    seen = set()
    for row in terms.crew_shares or []:
        friend = row.get("user_id") or row.get("id")
        if not isinstance(friend, str) or friend not in amounts or friend in seen:
            raise HTTPException(422, "Review the crew split.")
        seen.add(friend)
        if row.get("covered_by_captain") is True:
            amounts[friend] = 0
        elif "share_percent" in row:
            pct = number(row["share_percent"], "crew percentage")
            if pct > 100:
                raise HTTPException(422, "Review the crew percentage.")
            amounts[friend] = int(gross * pct / 100)
        elif "share_amount" in row:
            amounts[friend] = cents(number(row["share_amount"], "crew share"))
    if sum(amounts.values()) > gross:
        raise HTTPException(422, "Crew shares exceed the session price.")
    return amounts, captain_seat


async def shared_quote(db, buyer_id, pro, terms, *, lock=False):
    friends = terms.friend_ids or []
    if not friends or len(set(friends)) != len(friends) or buyer_id in friends:
        raise HTTPException(422, "Select each crew member once, excluding yourself.")
    ids = (await db.scalars(select(Profile.id).where(Profile.id.in_(friends)))).all()
    if len(ids) != len(friends):
        raise HTTPException(422, "Choose a Raw Surf account for each crew member.")
    duration = number(terms.estimated_duration_hours, "duration")
    if duration == 0:
        raise HTTPException(422, "Choose a positive session duration.")
    rate = number(pro.on_demand_hourly_rate if pro.on_demand_hourly_rate is not None else 75, "rate")
    extra = number(pro.price_per_additional_surfer if pro.price_per_additional_surfer is not None else 15, "crew fee")
    gross = cents(rate * duration + extra * len(friends))
    crew, captain_seat = crew_amounts(terms, gross)
    captain = gross - sum(crew.values())
    # Taking on friends' bills cannot increase the personal benefit.
    own_seat = min(captain, captain_seat)
    sub = await select_access_subscription(db, buyer_id, pro.id, for_update=lock)
    units = (sub.sessions_remaining or 0) if sub else 0
    covered = own_seat > 0 and units > 0
    pct = min(number(sub.on_demand_discount_pct or 0, "plan discount"), Decimal(50)) if sub else Decimal(0)
    benefit = own_seat if covered else int((own_seat * pct / 100).to_integral_value(rounding=ROUND_HALF_UP))
    quote = {
        "extra_surfer_fees_cents": cents(extra * len(friends)),
        "gross_cents": gross, "total_cents": gross - benefit, "captain_cents": captain - benefit,
        "benefit_cents": benefit, "subscription_covered": covered, "crew_cents": crew,
        "discount_percent": 0 if covered else float(pct),
    }
    identity = [buyer_id, pro.id, str(duration), quote, [sub.id, units] if covered else None]
    quote["quote_id"] = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return quote, sub
