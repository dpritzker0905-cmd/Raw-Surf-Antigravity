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
    assert 'data.thumbnail_url' in source


def test_story_routes_require_protected_grom_media_and_apply_view_gate():
    source = _source('routes/content/stories.py')
    assert "private_ref.bucket != 'grom_media'" in source
    assert 'can_view_story' in source
    assert "story.guardian_approval_status == 'approved'" in source


def test_protected_grom_media_has_jwt_bound_upload_and_authorized_delivery():
    source = _source('routes/grom_hq/protected_media.py')
    assert 'get_current_user_id' in source
    assert "bucket='grom_media'" in source
    assert 'upload_private_media_stream' in source
    assert 'signed_private_media_url' in source

    # ── THE SIGNING INVARIANT, pinned by SHAPE rather than by one spelling of it ────────────────
    # This used to read `assert 'parse_private_media_ref(media.media_url)' in source`, and
    # `77c83d77` — the very NEXT commit after the assertion was written — lifted that call into a
    # shared helper taking `value`. The test then reported a security REGRESSION for 157 commits
    # while the contract had actually got STRICTER: the helper applies the same parse and
    # bucket-check to the thumbnail and to every carousel item, not just to `media.media_url`.
    #
    # What actually matters is that a signed URL cannot be produced for a value that was not first
    # parsed as a private ref AND confirmed to live in `grom_media`. Express that as: ONE signing
    # site, and the parse plus the bucket check immediately precede it. Both survive a rename of
    # the helper or of its argument, which the old literal did not.
    lines = source.splitlines()
    signing_sites = [i for i, line in enumerate(lines) if 'await signed_private_media_url(' in line]
    assert len(signing_sites) == 1, (
        f'expected exactly one signing call so it cannot be bypassed, found {len(signing_sites)}')
    gate = '\n'.join(lines[max(0, signing_sites[0] - 12):signing_sites[0]])
    assert 'parse_private_media_ref(' in gate, 'signing is not gated by a private-ref parse'
    assert "bucket != 'grom_media'" in gate, 'signing is not gated by a grom_media bucket check'

    assert "media.guardian_approval_status != 'approved'" in source
    assert "Follow.follower_id == viewer_id" in source

    # ⚠️ The `get_current_user_id` assertion above is FILE-WIDE and therefore cannot tell which
    # route uses it. `77c83d77` also moved DELIVERY to `get_optional_user_id` so an approved,
    # public Grom post renders in the feed — a deliberate product change the old test was blind
    # to. Upload must stay strictly JWT-bound, and the anonymous path must be refused for anything
    # not both approved and public.
    assert 'Depends(get_current_user_id)' in source, 'the upload route must stay JWT-bound'
    assert 'if not viewer_id:' in source, (
        'can_view_grom_media must refuse a None viewer for followers-only media')