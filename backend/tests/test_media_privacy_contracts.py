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
    ):
        assert 'get_current_user_id' in _source(path)


def test_post_feed_uses_followers_and_hides_unapproved_grom_media():
    source = _source('routes/posts/feed.py')
    assert 'get_optional_user_id' in source
    assert 'Follow.following_id' in source
    assert "p.guardian_approval_status != 'approved'" in source
    assert "ref.bucket != 'grom_media'" in source
