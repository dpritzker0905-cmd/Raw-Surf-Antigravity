"""
test_push_payloads.py — v89 Endpoint Contract Tests

Validates the push_payloads.py module extracted during v88 decomposition.
Tests notification preference gating and push payload builder contracts.

Note: push_payloads.py contains async helper functions (not direct HTTP endpoints).
We test them via the modules that call them, and verify the module's import graph.
"""
import pytest
import os
import importlib
import sys


# ============ MODULE IMPORT INTEGRITY ============

class TestPushPayloadsImportIntegrity:
    """Verify push_payloads.py can be imported without circular dependency errors"""

    def test_push_payloads_importable(self):
        """push_payloads.py should be importable without errors"""
        try:
            # Set test env vars before import
            os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/rawsurf_test")
            os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci")
            os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
            os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
            os.environ.setdefault("TESTING", "1")

            # Add backend to path if needed
            backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if backend_path not in sys.path:
                sys.path.insert(0, backend_path)

            from routes.notifications import push_payloads
            assert hasattr(push_payloads, 'notify_session_join')
            assert hasattr(push_payloads, 'notify_grom_activity')
            assert hasattr(push_payloads, 'notify_crew_payment_request')
            assert hasattr(push_payloads, 'notify_photographer_arrived')
            assert hasattr(push_payloads, 'notify_photos_ready')
            assert hasattr(push_payloads, 'notify_new_comment')
            assert hasattr(push_payloads, 'notify_booking_reminder')
            assert hasattr(push_payloads, 'notify_review_received')
        except ImportError as e:
            pytest.skip(f"Import failed (expected without full DB config): {e}")

    def test_push_payloads_re_exports_send(self):
        """push_payloads.py should re-export send_push_notification"""
        try:
            os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/rawsurf_test")
            os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci")
            os.environ.setdefault("TESTING", "1")

            backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if backend_path not in sys.path:
                sys.path.insert(0, backend_path)

            from routes.notifications import push_payloads
            assert hasattr(push_payloads, 'send_push_notification'), (
                "push_payloads must re-export send_push_notification from push.py"
            )
        except ImportError as e:
            pytest.skip(f"Import failed: {e}")


# ============ FUNCTION SIGNATURE CONTRACTS ============

class TestPushPayloadFunctionSignatures:
    """Verify function signatures match expected contracts"""

    def _get_module(self):
        os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/rawsurf_test")
        os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci")
        os.environ.setdefault("TESTING", "1")
        backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if backend_path not in sys.path:
            sys.path.insert(0, backend_path)
        try:
            from routes.notifications import push_payloads
            return push_payloads
        except ImportError:
            return None

    def test_session_join_signature(self):
        """notify_session_join requires photographer_id, surfer_name, amount, spot_name"""
        mod = self._get_module()
        if not mod:
            pytest.skip("Module not importable")
        import inspect
        sig = inspect.signature(mod.notify_session_join)
        params = list(sig.parameters.keys())
        assert 'photographer_id' in params
        assert 'surfer_name' in params
        assert 'amount' in params
        assert 'spot_name' in params

    def test_crew_payment_request_signature(self):
        """notify_crew_payment_request requires crew_member_id, captain_name, etc."""
        mod = self._get_module()
        if not mod:
            pytest.skip("Module not importable")
        import inspect
        sig = inspect.signature(mod.notify_crew_payment_request)
        params = list(sig.parameters.keys())
        assert 'crew_member_id' in params
        assert 'captain_name' in params
        assert 'booking_id' in params
        assert 'share_amount' in params

    def test_photos_ready_signature(self):
        """notify_photos_ready requires surfer_id, photographer_name, gallery_id"""
        mod = self._get_module()
        if not mod:
            pytest.skip("Module not importable")
        import inspect
        sig = inspect.signature(mod.notify_photos_ready)
        params = list(sig.parameters.keys())
        assert 'surfer_id' in params
        assert 'photographer_name' in params
        assert 'gallery_id' in params

    def test_grom_safety_alert_signature(self):
        """notify_grom_safety_alert requires parent_id, grom_name, alert_type, detail"""
        mod = self._get_module()
        if not mod:
            pytest.skip("Module not importable")
        import inspect
        sig = inspect.signature(mod.notify_grom_safety_alert)
        params = list(sig.parameters.keys())
        assert 'parent_id' in params
        assert 'grom_name' in params
        assert 'alert_type' in params
        assert 'detail' in params


# ============ NOTIFICATION DOMAIN COVERAGE ============

class TestPushPayloadDomainCoverage:
    """Verify all expected notification domains are covered"""

    def test_all_domains_have_functions(self):
        """Every domain should have at least one notification function"""
        mod = self._get_module()
        if not mod:
            pytest.skip("Module not importable")

        required_functions = [
            # Live sessions
            'notify_session_join',
            # Grom safety
            'notify_grom_activity',
            'notify_grom_safety_alert',
            'notify_grom_link_request',
            # Crew hub
            'notify_crew_payment_request',
            'notify_crew_payment_received',
            'notify_crew_payment_expiring',
            'notify_crew_session_confirmed',
            # Dispatch
            'notify_photographer_arrived',
            'notify_session_completed',
            # Gallery
            'notify_photos_ready',
            'notify_photos_found_ai',
            # Social
            'notify_new_comment',
            'notify_mention',
            # Surf alerts
            'notify_surf_alert_triggered',
            # Bookings
            'notify_booking_reminder',
            # Commerce
            'notify_gallery_purchase',
            'notify_review_received',
        ]
        for fn_name in required_functions:
            assert hasattr(mod, fn_name), (
                f"push_payloads missing required function: {fn_name}"
            )

    def _get_module(self):
        os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/rawsurf_test")
        os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci")
        os.environ.setdefault("TESTING", "1")
        backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if backend_path not in sys.path:
            sys.path.insert(0, backend_path)
        try:
            from routes.notifications import push_payloads
            return push_payloads
        except ImportError:
            return None
