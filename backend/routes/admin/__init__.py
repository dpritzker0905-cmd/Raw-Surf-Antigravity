"""
Admin routes package — consolidates 12 admin route modules.
Re-exports all routers for backward-compatible registration in routes/__init__.py.
"""
from .core import router as admin_router
from .analytics import router as admin_analytics_router
from .analytics_enhanced import router as admin_analytics_enhanced_router
from .communications import router as admin_communications_router
from .content_mgmt import router as admin_content_mgmt_router
from .content_mod import router as admin_content_mod_router
from .finance import router as admin_finance_router
from .moderation import router as admin_moderation_router
from .p1 import router as admin_p1_router
from .p2 import router as admin_p2_router
from .support import router as admin_support_router
from .system import router as admin_system_router
from .ab_analytics import router as admin_ab_analytics_router
from .admin_test_accounts import router as admin_test_accounts_router
from .admin_user_journey import router as admin_user_journey_router

