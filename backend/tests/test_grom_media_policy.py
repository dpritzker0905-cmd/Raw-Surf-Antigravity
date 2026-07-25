"""Regression coverage for Grom guardian privacy policy primitives."""
from types import SimpleNamespace

from services.grom_media_policy import (
    apply_guardian_visibility_cap,
    approval_status_for_grom_media,
    audience_is_within_cap,
    effective_visibility_cap,
    enforce_sitewide_visibility_cap,
    normalize_controls,
)


def test_default_controls_fail_closed():
    controls = normalize_controls(SimpleNamespace(parental_controls=None))
    assert controls['can_post'] is False
    assert controls['sitewide_media_max_visibility'] == 'guardian_only'
    assert controls['require_media_approval'] is True


def test_legacy_visibility_control_normalizes_to_sitewide_ceiling():
    controls = normalize_controls(SimpleNamespace(parental_controls={'media_max_visibility': 'followers'}))
    assert controls['sitewide_media_max_visibility'] == 'followers'
    assert controls['media_max_visibility'] == 'followers'


def test_effective_cap_is_the_stricter_of_sitewide_and_item_caps():
    controls = {'sitewide_media_max_visibility': 'public'}
    assert effective_visibility_cap(controls, 'followers') == 'followers'
    assert effective_visibility_cap(controls, None) == 'public'
    assert effective_visibility_cap({'sitewide_media_max_visibility': 'followers'}, 'public') == 'followers'


def test_grom_can_always_make_media_private():
    visibility, status = approval_status_for_grom_media(
        requested_visibility='guardian_only',
        controls={'can_post': False, 'sitewide_media_max_visibility': 'guardian_only', 'require_media_approval': True},
    )
    assert (visibility, status) == ('guardian_only', 'self_private')


def test_broader_grom_audience_requires_eligible_guardian_policy():
    controls = {'can_post': True, 'sitewide_media_max_visibility': 'public', 'require_media_approval': True}
    assert approval_status_for_grom_media(requested_visibility='public', controls=controls) == (
        'guardian_only', 'pending_parent_approval'
    )


def test_per_item_guardian_cap_blocks_broader_publish_request():
    controls = {'can_post': True, 'sitewide_media_max_visibility': 'public', 'require_media_approval': False}
    assert approval_status_for_grom_media(
        requested_visibility='public', controls=controls, per_item_cap='followers'
    ) == ('guardian_only', 'blocked_by_parent_policy')


def test_guardian_cap_immediately_restricts_existing_public_media():
    media = SimpleNamespace(visibility='public', guardian_approval_status='approved', guardian_visibility_cap=None)
    controls = {'sitewide_media_max_visibility': 'public'}
    effective = apply_guardian_visibility_cap(media, guardian_id='guardian', controls=controls, cap='followers')
    assert effective == 'followers'
    assert media.visibility == 'followers'
    assert media.guardian_approval_status == 'restricted_by_guardian'


def test_sitewide_cap_immediately_restricts_existing_public_media():
    media = SimpleNamespace(visibility='public', guardian_approval_status='approved', guardian_visibility_cap=None)
    assert enforce_sitewide_visibility_cap(media, controls={'sitewide_media_max_visibility': 'guardian_only'})
    assert media.visibility == 'guardian_only'
    assert media.guardian_approval_status == 'restricted_by_guardian'


def test_audience_cap_never_broadens_access():
    assert audience_is_within_cap('guardian_only', 'public')
    assert audience_is_within_cap('followers', 'followers')
    assert not audience_is_within_cap('public', 'followers')
