"""Keep shared Quick Book cancellation and its collected funds under one dispatch lock."""
import json
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from models import (Booking, BookingParticipant, DispatchRequest, DispatchRequestParticipant,
                    DispatchRequestStatusEnum as Status, Notification)

PENDING_SETTLEMENT = 'pending_settlement'
ACTIVE_STAGES = (Status.ACCEPTED, Status.EN_ROUTE, Status.ARRIVED)
HOLD_MESSAGE = 'Session cancelled. Payments and any included session are held for settlement.'


async def create_dispatch_booking(db, dispatch, crew_participants, now, *, status, escrow_status):
    held = dispatch.deposit_amount or 0
    if dispatch.is_shared and dispatch.target_photographer_id:
        # A personal allowance has no cash value in escrow. Include only settled shares.
        held = round((held if dispatch.deposit_paid else 0) + sum(
            cp.share_amount for cp in crew_participants if cp.paid and cp.share_amount
        ), 2)

    booking = Booking(
        photographer_id=dispatch.photographer_id,
        creator_id=dispatch.requester_id,
        surf_spot_id=dispatch.spot_id,
        latitude=dispatch.latitude,
        longitude=dispatch.longitude,
        location=dispatch.location_name or "On-Demand Meeting Point",
        session_date=now,
        booking_type='on_demand',
        duration=int((dispatch.estimated_duration_hours or 1) * 60),
        status=status,
        total_price=dispatch.estimated_total or 0,
        escrow_amount=held,
        escrow_status=escrow_status
    )

    db.add(booking)
    await db.flush()

    # Add requester as participant
    participant = BookingParticipant(
        booking_id=booking.id,
        participant_id=dispatch.requester_id,
        is_captain=True,
        payment_status='Paid' if dispatch.deposit_paid else 'Pending',
        paid_amount=(dispatch.deposit_amount or 0) if dispatch.deposit_paid else 0,
        share_amount=dispatch.deposit_amount or 0,
        status='confirmed'
    )
    db.add(participant)

    dispatch.booking_id = booking.id

    return booking


def requires_settlement(dispatch):
    return dispatch.refund_type == PENDING_SETTLEMENT or (
        dispatch.is_shared and dispatch.target_photographer_id and dispatch.status in ACTIVE_STAGES
    )


async def linked_quick_book(db, booking):
    if booking.booking_type != 'on_demand':
        return None
    return await db.scalar(select(DispatchRequest).where(
        DispatchRequest.booking_id == booking.id,
        DispatchRequest.is_shared.is_(True),
        (DispatchRequest.target_photographer_id.is_not(None) | (DispatchRequest.refund_type == PENDING_SETTLEMENT)),
    ).with_for_update().execution_options(populate_existing=True))


async def hold_interrupted_booking(db, dispatch, actor_id, reason):
    """Caller authorizes the actor, locks the dispatch first, and commits the entire transition."""
    if dispatch.refund_type != PENDING_SETTLEMENT:
        now = datetime.now(timezone.utc)
        crew = (await db.scalars(select(DispatchRequestParticipant).where(
            DispatchRequestParticipant.dispatch_request_id == dispatch.id))).all()
        if dispatch.booking_id:
            booking = await db.get(Booking, dispatch.booking_id, with_for_update=True, populate_existing=True)
            if booking is None or booking.escrow_status != 'held' or booking.escrow_released_at:
                raise HTTPException(409, 'Existing booking funds need reconciliation before cancellation.')
        else:
            booking = await create_dispatch_booking(db, dispatch, crew, now,
                                                    status='Cancelled', escrow_status=PENDING_SETTLEMENT)
        booking.status = 'Cancelled'
        booking.cancelled_at = now
        booking.cancellation_reason = reason
        booking.escrow_status = PENDING_SETTLEMENT
        dispatch.status = Status.CANCELLED
        dispatch.status_changed_at = dispatch.cancelled_at = now
        dispatch.cancellation_reason = reason
        dispatch.cancelled_by = actor_id
        dispatch.refund_type = PENDING_SETTLEMENT
        dispatch.refund_amount = 0
        recipients = {seat.participant_id for seat in crew}
        recipients.update((dispatch.requester_id, dispatch.photographer_id))
        for recipient in recipients - {None}:
            db.add(Notification(
                user_id=recipient, type='dispatch_cancelled', title='Session cancelled',
                body=HOLD_MESSAGE, data=json.dumps({'dispatch_id': dispatch.id, 'booking_id': booking.id,
                                                   'settlement_status': PENDING_SETTLEMENT}),
            ))
    return {'id': dispatch.id, 'dispatch_id': dispatch.id, 'booking_id': dispatch.booking_id,
            'status': 'cancelled', 'settlement_status': PENDING_SETTLEMENT,
            'refund_type': PENDING_SETTLEMENT, 'refund_amount': 0, 'fee_amount': 0,
            'message': HOLD_MESSAGE}


async def commit_interruption(db, dispatch, actor_id, reason):
    from services.interrupted_crew_checkouts import close_after_hold

    result = await hold_interrupted_booking(db, dispatch, actor_id, reason)
    await db.commit()
    await close_after_hold(async_sessionmaker(db.bind, expire_on_commit=False), result['dispatch_id'])
    return result
