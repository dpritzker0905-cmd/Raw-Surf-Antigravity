"""One receipt-bound live entitlement path for callback, status and buyer return."""
import json

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from models import LiveSession, LiveSessionParticipant, Notification, PaymentReconciliationCase, PaymentTransaction, Profile
from services import live_session_escrow
from utils.payment_reconciliation import PaymentNeedsReconciliation, receipt_identity
from utils.scheduled_booking_payment import metadata_of


def is_live_session_payment(transaction):
    return metadata_of(transaction).get('type') == 'live_session_join'


async def complete_live_session_payment(db, transaction, receipt):
    identifier = transaction.id
    result = await fulfill_live_session_payment(db, transaction, receipt)
    try:
        await db.commit()
    except Exception as exc:
        raise PaymentNeedsReconciliation(identifier, 'live_fulfillment_failed', receipt) from exc
    return result


async def fulfill_live_session_payment(db, transaction, receipt):
    tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.id == transaction.id)
        .with_for_update().execution_options(populate_existing=True))).one()
    if not is_live_session_payment(tx):
        raise HTTPException(status_code=400, detail='Invalid session type')
    receipt_identity(tx, receipt)  # No entitlement or refund from incomplete/unbound evidence.
    metadata = metadata_of(tx)
    transaction_id = tx.id  # Nested rollback can expire ORM attributes, including the PK.
    case = await db.scalar(select(PaymentReconciliationCase).where(
        PaymentReconciliationCase.transaction_id == tx.id).with_for_update())
    surfer_id, photographer_id = metadata['surfer_id'], metadata['photographer_id']
    if tx.payment_status == 'Completed':
        if case and case.state == 'open':
            case.state = 'fulfilled'
        return {'success': True, 'message': 'Session already activated'}
    if tx.payment_status.lower() != 'pending' or tx.status.lower() != 'pending':
        raise HTTPException(status_code=409, detail='Payment requires reconciliation')
    try:
        photographer = await db.scalar(select(Profile).where(Profile.id == photographer_id)
            .options(selectinload(Profile.current_spot)).with_for_update()
            .execution_options(populate_existing=True))
        live = await db.scalar(select(LiveSession).where(LiveSession.id == metadata['live_session_id'],
            LiveSession.photographer_id == photographer_id, LiveSession.status == 'active')
            .with_for_update().execution_options(populate_existing=True))
        if not photographer or not photographer.is_shooting or not live:
            raise PaymentNeedsReconciliation(tx.id, 'live_session_unavailable', receipt)
        existing = await db.scalar(select(LiveSessionParticipant).where(
            LiveSessionParticipant.surfer_id == surfer_id,
            LiveSessionParticipant.photographer_id == photographer_id,
            LiveSessionParticipant.status == 'active'))
        if existing:
            raise PaymentNeedsReconciliation(tx.id, 'duplicate_live_participation', receipt)
        surfer = await db.get(Profile, surfer_id)
        if not surfer:
            raise PaymentNeedsReconciliation(tx.id, 'live_fulfillment_failed', receipt)
        amount = tx.amount
        tx.payment_status = tx.status = 'Completed'
        participant = LiveSessionParticipant(surfer_id=surfer_id, photographer_id=photographer_id,
            spot_id=photographer.current_spot_id, live_session_id=live.id,
            selfie_url=metadata.get('selfie_url'), participant_role='participant', status='active',
            amount_paid=amount, payment_method='card', resolution_preference='standard',
            photos_credit_remaining=live.photos_included or photographer.live_session_photos_included or 3,
            locked_price_web=live.session_price_web or photographer.photo_price_web or photographer.live_photo_price_web or 3.0,
            locked_price_standard=live.session_price_standard or photographer.photo_price_standard or photographer.live_photo_price_standard or 5.0,
            locked_price_high=live.session_price_high or photographer.photo_price_high or photographer.live_photo_price_high or 10.0)
        live_session_escrow.hold(participant, amount)
        db.add(participant)
        db.add(Notification(user_id=photographer_id, type='session_join',
            title=f'{surfer.full_name} joined your session!',
            body=f"${amount:.2f} (card) · {photographer.current_spot.name if photographer.current_spot else 'Current location'}",
            data=json.dumps(dict(surfer_id=surfer_id, surfer_name=surfer.full_name,
                                 selfie_url=metadata.get('selfie_url'), amount_paid=amount))))
        if case and case.state == 'open':
            case.state = 'fulfilled'
        await db.flush()
        return dict(success=True, message='Successfully joined session', session_id=str(participant.id),
                    photographer_name=photographer.full_name)
    except PaymentNeedsReconciliation:
        raise
    except Exception as exc:
        raise PaymentNeedsReconciliation(transaction_id, 'live_fulfillment_failed', receipt) from exc
