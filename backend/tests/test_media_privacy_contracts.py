"""Source-level regressions for sensitive media routes until the legacy suite is JWT-migrated.

⚠️⚠️ WHY THESE ASSERT AGAINST `_live_code()` AND NOT `_source()` (2026-08-05)
---------------------------------------------------------------------------
Every assertion here used to read `'needle' in _source(path)` — raw file text. Measured: all five
tests passed GREEN against mutants of all seven modules that contained **zero executable AST
nodes**. A comment, a docstring, or a bare `import` satisfies a raw-text search, so this file could
certify a security contract for a module whose body had been deleted.

`_live_code()` parses the module, **drops every docstring**, and re-emits it with `ast.unparse` —
which also **discards all comments**, because comments are not in the AST. What is left is only what
actually executes. The assertions read the same; they can no longer be satisfied by prose.

★ And for identity specifically, text is not enough even after that, because an `import` survives
  unparsing. `_dependency_names()` walks for a real `Depends(<name>)` Call node, which is the
  construct that actually binds the identity to the route.

⚠️ These are still STRUCTURAL, not behavioural. The behavioural coverage lives in
`test_private_media.py` (real HTTP calls) and `test_grom_media_policy.py` (calls the real policy
function). `test_private_media.py` is deliberately OUT of ci.yml's forecast-chain lane "by module
name rather than by accident" — so it runs in NO CI lane today. That is the orphan-lane gap, not a
defect of this file.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

_DOCSTRING_HOSTS = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding='utf-8')


def _tree(relative_path: str) -> ast.Module:
    return ast.parse(_source(relative_path))


def _live_code(relative_path: str) -> str:
    """The module with comments and docstrings REMOVED — i.e. only what executes.

    `ast.unparse` never emits comments (they are not AST nodes), and we strip docstrings
    explicitly. A needle found in this string is a needle in real code.
    """
    tree = _tree(relative_path)
    for node in ast.walk(tree):
        if isinstance(node, _DOCSTRING_HOSTS):
            body = getattr(node, 'body', None)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


def _dependency_names(relative_path: str) -> set:
    """Every NAME passed to a `Depends(...)` call — the construct that actually binds identity."""
    found = set()
    for node in ast.walk(_tree(relative_path)):
        if isinstance(node, ast.Call) and getattr(node.func, 'id', None) == 'Depends':
            for arg in node.args:
                if isinstance(arg, ast.Name):
                    found.add(arg.id)
                elif isinstance(arg, ast.Attribute):
                    found.add(arg.attr)
    return found


def _called_names(relative_path: str) -> set:
    """Every function name that is actually CALLED. An import alone does not appear here."""
    found = set()
    for node in ast.walk(_tree(relative_path)):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name):
                found.add(f.id)
            elif isinstance(f, ast.Attribute):
                found.add(f.attr)
    return found


# --- the control ---------------------------------------------------------------------------------

def test_live_code_strips_prose_but_keeps_code():
    """THE INSTRUMENT'S OWN CONTROL. If `_live_code` ever returned raw text, every assertion below
    would silently weaken back to a substring search and nothing would go red."""
    stripped = _live_code('routes/grom_hq/protected_media.py')
    raw = _source('routes/grom_hq/protected_media.py')
    assert 'signed_private_media_url' in stripped, 'real code must survive'
    # a needle that exists ONLY in prose must NOT survive the strip
    prose_only = ast.parse('"""mentions get_current_user_id in a docstring"""\nx = 1\n')
    assert 'get_current_user_id' not in _live_code_of_tree(prose_only)
    assert len(stripped) < len(raw), 'stripping prose should shrink the module'


def _live_code_of_tree(tree: ast.Module) -> str:
    for node in ast.walk(tree):
        if isinstance(node, _DOCSTRING_HOSTS):
            body = getattr(node, 'body', None)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


# --- the contracts -------------------------------------------------------------------------------

def test_sensitive_media_routes_use_strict_jwt_identity():
    """⭐ Asserted as a real `Depends(get_current_user_id)` binding, not a mention. An `import` of
    the symbol satisfies a text search and proves nothing about the routes."""
    for path in (
        'routes/profiles/user_media.py',
        'routes/gallery/grom.py',
        'routes/gallery/gallery_purchases.py',
        'routes/content/stories.py',
    ):
        assert 'get_current_user_id' in _dependency_names(path), (
            f'{path}: no route binds Depends(get_current_user_id)')


def test_grom_media_has_sitewide_and_per_item_guardian_ceilings():
    source = _live_code('routes/grom_hq/media_privacy.py')
    assert 'sitewide_media_max_visibility' in source
    assert 'privacy-cap' in source
    assert 'enforce_sitewide_visibility_cap' in source
    assert 'Story' in source


def test_post_feed_uses_followers_and_hides_unapproved_grom_media():
    source = _live_code('routes/posts/feed.py')
    assert 'get_optional_user_id' in source
    assert 'Follow.following_id' in source
    assert "p.guardian_approval_status != 'approved'" in source
    assert "ref.bucket != 'grom_media'" in source
    assert 'data.thumbnail_url' in source


def test_story_routes_require_protected_grom_media_and_apply_view_gate():
    source = _live_code('routes/content/stories.py')
    assert "private_ref.bucket != 'grom_media'" in source
    assert 'can_view_story' in source
    assert "story.guardian_approval_status == 'approved'" in source


def test_protected_grom_media_has_jwt_bound_upload_and_authorized_delivery():
    path = 'routes/grom_hq/protected_media.py'
    source = _live_code(path)
    assert "bucket='grom_media'" in source
    assert 'upload_private_media_stream' in _called_names(path)
    assert 'signed_private_media_url' in _called_names(path)

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
    # ⚠️ Read off `_live_code`, so a commented-out signing call no longer counts as a site.
    lines = source.splitlines()
    signing_sites = [i for i, line in enumerate(lines) if 'await signed_private_media_url(' in line]
    assert len(signing_sites) == 1, (
        f'expected exactly one signing call so it cannot be bypassed, found {len(signing_sites)}')
    gate = '\n'.join(lines[max(0, signing_sites[0] - 12):signing_sites[0]])
    assert 'parse_private_media_ref(' in gate, 'signing is not gated by a private-ref parse'
    assert "bucket != 'grom_media'" in gate, 'signing is not gated by a grom_media bucket check'

    assert "media.guardian_approval_status != 'approved'" in source
    assert 'Follow.follower_id == viewer_id' in source

    # ⚠️ The identity assertion is FILE-WIDE and therefore cannot tell which route uses it.
    # `77c83d77` moved DELIVERY to `get_optional_user_id` so an approved, public Grom post renders
    # in the feed — a deliberate product change the old test was blind to. Upload must stay strictly
    # JWT-bound, and the anonymous path must be refused for anything not both approved and public.
    assert 'get_current_user_id' in _dependency_names(path), 'the upload route must stay JWT-bound'
    assert 'if not viewer_id:' in source, (
        'can_view_grom_media must refuse a None viewer for followers-only media')
