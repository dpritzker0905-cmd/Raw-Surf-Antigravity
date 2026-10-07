"""Offline runtime controls for the gallery scheduler's once-only grace period."""
import importlib.util
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'backend/scheduler/gallery.py').is_file())
spec = importlib.util.spec_from_file_location('gallery_deadline_under_test', ROOT / 'backend/scheduler/gallery.py')
gallery_scheduler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery_scheduler)
NOW = datetime(2026, 10, 7, 4, 0, tzinfo=timezone.utc)


class _Column:
    def __le__(self, other):
        return ('le', other)

    def __eq__(self, other):
        return ('eq', other)


class _Query:
    def where(self, condition):
        return self


class _Session:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *args):
        return False


class GalleryDeadlineGraceTests(unittest.IsolatedAsyncioTestCase):
    async def run_scheduler(self, choice=None, reminded=False):
        quota = SimpleNamespace(id='quota', surfer_id='surfer', gallery_id='gallery',
                                auto_select_on_expiry=choice, expiry_reminder_sent=reminded,
                                selection_deadline=NOW - timedelta(days=1), status='pending_selection',
                                photos_allowed=7, photos_selected=2)
        db = SimpleNamespace(execute=AsyncMock(side_effect=[
            SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [quota])),
            SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(id='surfer')),
            SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(id='gallery', title='Test gallery')),
        ]), add=Mock(), commit=AsyncMock())
        models = SimpleNamespace(
            SurferSelectionQuota=SimpleNamespace(selection_deadline=_Column(), status=_Column()),
            Gallery=SimpleNamespace(id=_Column()), Profile=SimpleNamespace(id=_Column()),
            GalleryItem=SimpleNamespace(), SurferGalleryItem=SimpleNamespace,
            Notification=SimpleNamespace,
        )
        dependencies = {'database': SimpleNamespace(async_session_maker=lambda: _Session(db)),
                        'sqlalchemy': SimpleNamespace(select=lambda model: _Query()), 'models': models}
        clock = SimpleNamespace(now=lambda zone: NOW)
        with patch.dict(sys.modules, dependencies), patch.object(gallery_scheduler, 'datetime', clock), \
                patch.object(gallery_scheduler.logger, 'error') as errors:
            await gallery_scheduler.process_selection_deadline_expiry_task()
        return quota, db, errors

    async def test_first_undecided_expiry_gets_full_grace_and_warning(self):
        quota, db, errors = await self.run_scheduler()
        self.assertEqual(quota.selection_deadline, NOW + timedelta(days=3))
        self.assertTrue(quota.expiry_reminder_sent)
        self.assertIsNone(quota.auto_select_on_expiry)
        self.assertEqual(quota.status, 'pending_selection')
        db.add.assert_called_once()
        notification = db.add.call_args.args[0]
        self.assertEqual(notification.type, 'selection_expiry_warning')
        self.assertEqual(notification.user_id, 'surfer')
        self.assertEqual(notification.data, {'gallery_id': 'gallery', 'remaining_picks': 5, 'action_required': True})
        db.commit.assert_awaited_once()
        errors.assert_not_called()

    async def test_already_reminded_quota_does_not_receive_another_extension(self):
        quota, db, errors = await self.run_scheduler(reminded=True)
        self.assertEqual(quota.selection_deadline, NOW - timedelta(days=1))
        self.assertTrue(quota.auto_select_on_expiry)
        self.assertEqual(quota.status, 'pending_selection')
        db.add.assert_not_called()
        db.commit.assert_awaited_once()
        errors.assert_not_called()

    async def test_explicit_forfeit_is_preserved(self):
        quota, db, errors = await self.run_scheduler(choice=False)
        self.assertEqual(quota.status, 'forfeited')
        self.assertEqual(quota.selection_deadline, NOW - timedelta(days=1))
        self.assertFalse(quota.expiry_reminder_sent)
        db.add.assert_called_once()
        self.assertEqual(db.add.call_args.args[0].type, 'selection_forfeited')
        db.commit.assert_awaited_once()
        errors.assert_not_called()


if __name__ == '__main__':
    unittest.main()
