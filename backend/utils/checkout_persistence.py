"""Do not expose a provider checkout URL unless its local intent is durable."""
import logging

import stripe
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool


logger = logging.getLogger(__name__)


async def commit_checkout(db, session, api_key):
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        try:
            await run_in_threadpool(stripe.checkout.Session.expire, session.id, api_key=api_key)
        except Exception:
            # Session IDs are provider references, not credentials. Preserve the
            # actionable reference without exception payloads or checkout URLs.
            logger.error('Checkout persistence failed; reconcile provider session %s', session.id)
        raise HTTPException(status_code=500, detail='Checkout could not be saved; please retry') from exc
