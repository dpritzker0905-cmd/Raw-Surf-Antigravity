"""Source-level regressions for sensitive media routes until the legacy suite is JWT-migrated."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding='utf-8')


def test_sensitive_media_routes_use_strict_jwt_identity():
    for path in (
        'routes/profiles/user_media.py',
        'routes/gallery/grom.py',
        'routes/gallery/gallery_purchases.py',
        'routes/content/stories.py',
    ):
        assert 'get_current_user_id' in _source(path)


def test_grom_media_has_sitewide_and_per_item_guardian_ceilings():
    source = _source('routes/grom_hq/media_privacy.py')
    assert 'sitewide_media_max_visibility' in source
    assert 'privacy-cap' in source
    assert 'enforce_sitewide_visibility_cap' in source
    assert 'Story' in source


def test_post_feed_uses_followers_and_hides_unapproved_grom_media():
    source = _source('routes/posts/feed.py')
    assert 'get_optional_user_id' in source
    assert 'Follow.following_id' in source
    assert "p.guardian_approval_status != 'approved'" in source
    assert "ref.bucket != 'grom_media'" in source


def test_story_routes_require_protected_grom_media_and_apply_view_gate():
    source = _source('routes/content/stories.py')
    assert "private_ref.bucket != 'grom_media'" in source
    assert 'can_view_story' in source
    assert "story.guardian_approval_status == 'approved'" in source
