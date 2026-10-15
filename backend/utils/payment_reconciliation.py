"""Record verified-but-unfulfillable receipts after rolling back entitlement work."""
from fastapi import HTTPException
from sqlalchemy import select

from models import PaymentReconciliationCase, PaymentTransaction


class PaymentNeedsReconciliation(HTTPException):
    def __init__(self, transaction_id, reason, session):
        super().__init__(status_code=409, detail='Payment requires reconciliation')
        self.transaction_id, self.reason, self.session = transaction_id, reason, session


def receipt_identity(transaction, session):
    # Lazy import avoids a cycle with the scheduled fulfillment exception.
    from utils.scheduled_booking_payment import cents, field, is_scheduled_booking, metadata_of
    metadata, evidence = metadata_of(transaction), field(session, 'metadata', {})
    if is_scheduled_booking(transaction):
        expected = {k: metadata.get(k) for k in ('booking_id', 'photographer_id')}
        expected.update(type='scheduled_booking', user_id=transaction.user_id)
        binding = cents(evidence.get('credits_applied')) == cents(metadata.get('credits_applied')) if isinstance(evidence, dict) else False
    elif metadata.get('type') == 'live_session_join':
        expected = {k: metadata.get(k) for k in ('type', 'surfer_id', 'photographer_id', 'live_session_id')}
        binding = (metadata.get('surfer_id') == transaction.user_id and isinstance(evidence, dict)
                   and cents(evidence.get('amount')) == cents(transaction.amount) == cents(metadata.get('amount')))
    else:
        raise HTTPException(status_code=400, detail='Unsupported payment recovery type')
    if not (binding and isinstance(evidence, dict) and all(v and evidence.get(k) == v for k, v in expected.items())
            and field(session, 'id') == transaction.session_id and field(session, 'payment_status') == 'paid'
            and field(session, 'status') == 'complete' and field(session, 'currency') == transaction.currency == 'usd'
            and type(field(session, 'amount_total')) is int and field(session, 'amount_total') == cents(transaction.amount)
            and cents(transaction.amount) > 0):
        raise HTTPException(status_code=400, detail='Payment evidence does not match local intent')
    intent = field(session, 'payment_intent')
    return intent if isinstance(intent, str) else field(intent, 'id')


async def record_case(db, problem):
    await db.rollback()
    tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.id == problem.transaction_id)
                          .with_for_update().execution_options(populate_existing=True))).one()
    intent = receipt_identity(tx, problem.session)
    case = (await db.scalars(select(PaymentReconciliationCase).where(
        PaymentReconciliationCase.transaction_id == tx.id).with_for_update())).one_or_none()
    if case is None and (tx.payment_status.lower() in ('paid', 'completed', 'refunded') or tx.status.lower() == 'completed'):
        await db.commit()
        return {'reconciliation_required': False, 'case_id': None, 'state': 'already_processed'}
    if case is None:
        from utils.scheduled_booking_payment import cents
        case = PaymentReconciliationCase(transaction_id=tx.id, session_id=tx.session_id,
            payment_intent_id=intent, amount_cents=cents(tx.amount), currency=tx.currency, reason=problem.reason)
        db.add(case)
    # Receipt arrival does not move money or assert that a refund succeeded.
    await db.commit()
    return {'reconciliation_required': True, 'case_id': case.id, 'state': case.state}
