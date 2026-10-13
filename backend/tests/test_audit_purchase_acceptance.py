"""Actual purchase route, subscription helper and credit ledger on ephemeral SQLite.

Badge awards and websocket transport are stubbed; money/quota/entitlement mutations
execute the real code. This does not qualify PostgreSQL concurrency or Stripe.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from models import (Profile, RoleEnum, Gallery, GalleryItem, GalleryPurchase,
    Notification, XPTransaction, CreditTransaction, SurferPhotoSubscription)
from routes.gallery import gallery_purchases as P
from routes.gallery.schemas import PurchaseRequest


class Facade:
    def __init__(self, session): self.session = session
    async def execute(self, statement): return self.session.execute(statement)
    def add(self, row): self.session.add(row)
    async def commit(self): self.session.commit()


@pytest.mark.parametrize('media,covered,balance', [
    ('image', False, 100), ('video', False, 100),
    ('image', True, 0), ('video', True, 0), ('image', False, 0)])
def test_purchase_records_consistent_credit_or_subscription_entitlement(monkeypatch, media, covered, balance):
    monkeypatch.setattr(P, 'check_badge_milestones', AsyncMock())
    monkeypatch.setattr(P, 'broadcast_earnings_update', AsyncMock())
    engine = create_engine('sqlite://')
    for model in [Profile, Gallery, GalleryItem, GalleryPurchase, Notification,
                  XPTransaction, CreditTransaction, SurferPhotoSubscription]:
        model.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as session:
        buyer = Profile(id='buyer', user_id='buyer', email='buyer@example.invalid', role=RoleEnum.SURFER,
            credit_balance=balance, full_name='Fixture Buyer')
        photographer = Profile(id='photographer', user_id='photographer', email='photo@example.invalid',
            role=RoleEnum.SURFER, credit_balance=0, full_name='Fixture Photographer')
        item = GalleryItem(id='item', photographer_id='photographer', media_type=media, is_for_sale=True,
            price_standard=10, price_1080p=15, purchase_count=0,
            preview_url='https://media.example.invalid/preview', original_url='https://media.example.invalid/original')
        session.add_all([buyer, photographer, item])
        if covered:
            session.add(SurferPhotoSubscription(id='subscription', surfer_id='buyer', photographer_id='photographer',
                status='active', amount_paid=20, payment_method='credits',
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                photos_remaining=1, videos_remaining=1))
        session.commit()
        request = PurchaseRequest(quality_tier='1080p' if media == 'video' else 'standard')
        call = P.purchase_gallery_item('item', 'buyer', request, 'buyer', Facade(session))
        if balance == 0 and not covered:
            with pytest.raises(HTTPException) as denied: asyncio.run(call)
            assert denied.value.status_code == 400
            assert not list(session.scalars(select(GalleryPurchase)))
            assert not list(session.scalars(select(CreditTransaction)))
            assert item.purchase_count == 0 and buyer.credit_balance == 0
        else:
            result = asyncio.run(call)
            price = 0 if covered else (15 if media == 'video' else 10)
            assert result['success'] and result['amount_paid'] == price
            assert buyer.credit_balance == balance - price and photographer.credit_balance == price * .8
            purchases = list(session.scalars(select(GalleryPurchase)))
            assert len(purchases) == 1 and purchases[0].amount_paid == price
            assert purchases[0].buyer_id == 'buyer' and purchases[0].gallery_item_id == 'item'
            assert item.purchase_count == 1 and len(list(session.scalars(select(Notification)))) == 1
            entries = list(session.scalars(select(CreditTransaction)))
            assert sorted(e.amount for e in entries) == ([] if covered else [-price, price * .8])
            if covered:
                sub = session.get(SurferPhotoSubscription, 'subscription')
                assert (sub.photos_remaining, sub.videos_remaining) == ((1, 0) if media == 'video' else (0, 1))
            with pytest.raises(HTTPException) as duplicate:
                asyncio.run(P.purchase_gallery_item('item', 'buyer', request, 'buyer', Facade(session)))
            assert duplicate.value.status_code == 400 and item.purchase_count == 1
    engine.dispose()


@pytest.mark.parametrize('method', ['card', 'stripe', 'invented'])
def test_unsupported_payment_refuses_before_database_or_helper_import(method):
    class NoDB:
        async def execute(self, _): raise AssertionError('Unsupported method reached database')
    with pytest.raises(HTTPException) as denied:
        asyncio.run(P.purchase_gallery_item('item', 'buyer', PurchaseRequest(payment_method=method), 'buyer', NoDB()))
    assert denied.value.status_code == 400
