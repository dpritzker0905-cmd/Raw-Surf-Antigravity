"""Regression guards for the comment-reaction API contract."""

from routes.posts.interactions import VALID_COMMENT_REACTIONS


def test_comment_reaction_allowlist_contains_the_default_like():
    """Every standard comment Like submits a shaka that the API accepts."""
    assert "\U0001F919" in VALID_COMMENT_REACTIONS


def test_comment_reaction_allowlist_matches_the_supported_picker_set():
    """Keep the backend accept-list aligned with the shared frontend picker."""
    assert set(VALID_COMMENT_REACTIONS) == {
        "\U0001F919", "\U0001F30A", "\U0001F3C4", "\U0001F525", "\U0001F4AF",
        "\u2764\ufe0f", "\U0001F44F", "\U0001F602", "\U0001F60E", "\U0001F4AA",
    }