"""Regression coverage for Grom guardian privacy policy primitives."""
from types import SimpleNamespace

from services.grom_media_policy import (
    approval_status_for_grom_post,
    audience_is_within_cap,
    normalize_controls,
)


def test_default_controls_fail_closed():
    controls = normalize_controls(SimpleNamespace(parental_controls=None))
    assert controls == {
        'can_post': False,
        'media_max_visibility': 'guardian_only',
        'require_media_approval': True,
    }


def test_audience_cap_never_broadens_access():
    assert audience_is_within_cap('guardian_only', 'public')
    assert audience_is_within_cap('followers', 'followers')
    assert not audience_is_within_cap('public', 'followers')


def test_grom_can_always_make_media_private():
    visibility, status = approval_status_for_grom_post(
        requested_visibility='guardian_only',
        controls={'can_post': False, 'media_max_visibility': 'guardian_only', 'require_media_approval': True},
    )
    assert (visibility, status) == ('guardian_only', 'self_private')


def test_broader_grom_audience_requires_eligible_guardian_policy():
    controls = {'can_post': True, 'media_max_visibility': 'public', 'require_media_approval': True}
    assert approval_status_for_grom_post(requested_visibility='public', controls=controls) == (
        'guardian_only', 'pending_parent_approval'
    )


def test_grom_audience_above_guardian_cap_is_blocked():
    controls = {'can_post': True, 'media_max_visibility': 'followers', 'require_media_approval': False}
    assert approval_status_for_grom_post(requested_visibility='public', controls=controls) == (
        'guardian_only', 'blocked_by_parent_policy'
    )
