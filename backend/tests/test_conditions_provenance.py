"""conditions_source is the server's word, never the client's (check-in truth program P0, 2026-11-16).

The laundering path: a client sends 'manual' (or 'observed', or nothing at all), and the post reads back as a surfer's
own observation. These tests pin that no client value is stored as 'manual' or 'observed', and that the old line
`data.conditions_source or 'manual'` is caught if it comes back.
"""
import asyncio
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from services import conditions_provenance as P
from services.conditions_provenance import server_conditions_source

BACKEND = Path(__file__).resolve().parents[1]
ROUTES = [BACKEND / "routes" / "posts" / "feed.py", BACKEND / "routes" / "posts" / "post_collaboration.py"]


@pytest.mark.parametrize("hint,expected", [
    ("auto", "auto"), ("auto_current", "auto_current"), ("edited", "edited"), (" Edited ", "edited"),
    ("manual", "unverified"), ("observed", "unverified"), ("unavailable", "unverified"),
    ("", "unverified"), (None, "unverified"), ("buoy", "unverified"),
])
def test_only_honest_client_values_pass(hint, expected):
    assert server_conditions_source(hint, True) == expected


def test_no_conditions_means_no_source():
    for hint in ("auto", "manual", None):
        assert server_conditions_source(hint, False) is None


def test_defaults_no_longer_claim_manual():
    from routes.posts.post_collaboration import SessionMetadata
    from routes.posts.schemas import PostCreate
    from models.posts import Post
    assert SessionMetadata().conditions_source is None
    assert PostCreate.model_fields["conditions_source"].default is None
    assert Post.__table__.c.conditions_source.default is None


class _Result:
    def __init__(self, post):
        self._post = post

    def scalar_one_or_none(self):
        return self._post


class _DB:
    def __init__(self, post):
        self.post, self.commits = post, 0

    async def execute(self, *_a, **_k):
        return _Result(self.post)

    async def commit(self):
        self.commits += 1


def _post(**kw):
    base = dict(id="p1", author_id="u1", conditions_source=None, session_label=None,
                **{f: None for f in P.CONDITION_FIELDS})
    base.update(kw)
    return SimpleNamespace(**base)


def _update(post, **payload):
    from routes.posts.post_collaboration import SessionMetadata, update_post_session_metadata
    db = _DB(post)
    asyncio.run(update_post_session_metadata("p1", SessionMetadata(**payload), user_id="u1", db=db))
    return post


def test_the_laundering_path_through_the_metadata_route():
    """A client posting 'manual' with wave values used to be stored verbatim as 'manual'."""
    post = _update(_post(), wave_height_ft=4.0, conditions_source="manual")
    assert post.wave_height_ft == 4.0 and post.conditions_source == "unverified"
    post = _update(_post(), wind_speed_mph=8.0, conditions_source="observed")      # 'observed' is the server's (P1)
    assert post.conditions_source == "unverified"
    post = _update(_post(), tide_status="rising")                                  # values with no claim at all
    assert post.conditions_source == "unverified"


def test_honest_values_and_untouched_conditions():
    assert _update(_post(), wave_height_ft=3.0, conditions_source="edited").conditions_source == "edited"
    keep = _post(wave_height_ft=3.0, conditions_source="auto")
    assert _update(keep, session_label="Dawn Patrol").conditions_source == "auto"  # no condition touched: unchanged
    assert _update(_post(), conditions_source="auto").conditions_source is None    # a claim with no values: no source


# ── the mutant guard: the stored value may never be a client string defaulted to 'manual' ──

_LAUNDER = re.compile(r"conditions_source['\"]?\s*[=:].*['\"]manual['\"]|conditions_source\s*=\s*data\.conditions_source\b")


def laundering_lines(text):
    return [ln.strip() for ln in text.splitlines() if _LAUNDER.search(ln) and not ln.strip().startswith("#")]


def test_the_routes_store_no_client_string_and_no_manual_default():
    for path in ROUTES:
        assert laundering_lines(path.read_text(encoding="utf-8")) == [], path.name


def test_the_guard_catches_the_old_lines():
    """Mutants: each of the three laundering lines this PR removed must trip the guard."""
    for old in ("        conditions_source=data.conditions_source or 'manual',",
                "        post.conditions_source = data.conditions_source",
                '    conditions_source: Optional[str] = "manual"',
                '        "conditions_source": "manual"'):
        assert laundering_lines(old), old


def test_a_helper_mutant_that_restores_manual_fails_the_laundering_test():
    """Mutate the helper to pass 'manual' through, as the old code did; the laundering assertions must then fail."""
    src = Path(P.__file__).read_text(encoding="utf-8")
    mutant = src.replace('frozenset({"auto", "auto_current", "edited"})',
                         'frozenset({"auto", "auto_current", "edited", "manual"})')
    assert mutant != src
    ns = {}
    exec(compile(mutant, "conditions_provenance_mutant", "exec"), ns)
    assert ns["server_conditions_source"]("manual", True) == "manual"          # the mutant launders
    with pytest.raises(AssertionError):
        assert ns["server_conditions_source"]("manual", True) == "unverified"  # ... and the real test catches it


def test_a_bare_hint_never_relabels_a_post():
    """Advisor (2026-11-16), for P1: once the server sets 'observed', a client must not be able to erase it by sending a
    hint, or the same values again. Only a changed condition value recomputes the label."""
    observed = _post(wave_height_ft=4.0, conditions_source="observed")
    assert _update(observed, conditions_source="auto").conditions_source == "observed"               # hint alone
    assert _update(observed, wave_height_ft=4.0, conditions_source="manual").conditions_source == "observed"  # same value
    changed = _post(wave_height_ft=4.0, conditions_source="observed")
    assert _update(changed, wave_height_ft=5.0, conditions_source="edited").conditions_source == "edited"


def test_a_stored_legacy_manual_reads_as_unverified():
    assert P.read_conditions_source("manual") == "unverified"
    for v in ("auto", "auto_current", "edited", "unverified", "observed", None):
        assert P.read_conditions_source(v) == v
