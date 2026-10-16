"""MANIFEST_PUBLISH_ONE_STEP: only a DEFINITE "the pointer table does not exist" latches the lane off (round-5 finding 1).

read_pointer and cas_advance used to treat ANY HTTP 404 as "migration not applied" and latch `_disabled_for_process`, after which
the process ran the old path (a bare manifest.json PUT, no CAS). A PostgREST schema-cache miss (PGRST205) or a proxy's 404 page is
enough to trigger that, which turns one transient read into the lossy path the lane exists to avoid. With the one-step flag on, only
an answer that SAYS the relation does not exist (Postgres 42P01, or PostgREST's `relation "..." does not exist` message) latches;
every other 404 is a failed attempt like any 5xx: retried with backoff, logged at ERROR now and then, never a manifest.json write.
A latched process says so loudly (`::error::`) because pointer-first readers will never see its later registrations. With the flag
OFF the old standard (any 404) is untouched, byte for byte."""
import json
import logging
from types import SimpleNamespace

import pytest

from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import manifest_publish_step as mps
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import BASE, FLAG, PILOTS_NEW, chain, parked, store, submit  # noqa: F401,F811

REAL = SimpleNamespace(read_pointer=mp.read_pointer, cas_advance=mp.cas_advance, pointer_enabled=mp.pointer_enabled)

PGRST205 = {"code": "PGRST205", "details": None, "hint": "Perhaps you meant the table 'public.weather_manifest_pointer_v2'",
            "message": "Could not find the table 'public.weather_manifest_pointer' in the schema cache"}
UNDEFINED_TABLE = {"code": "42P01", "details": None, "hint": None, "message": 'relation "public.weather_manifest_pointer" does not exist'}
RELATION_MESSAGE_ONLY = {"message": 'relation "public.weather_manifest_pointer" does not exist'}

# (status, body) pairs a healthy deployment can answer without the table being gone
AMBIGUOUS = {
    "PGRST205-schema-cache-miss": (404, json.dumps(PGRST205).encode()),
    "empty-body": (404, b""),
    "proxy-html": (404, b"<html><body>404 Not Found</body></html>"),
    "other-json": (404, json.dumps({"error": "not_found"}).encode()),
}
DEFINITE = {
    "404-42P01": (404, json.dumps(UNDEFINED_TABLE).encode()),
    "400-42P01": (400, json.dumps(UNDEFINED_TABLE).encode()),
    "404-relation-message": (404, json.dumps(RELATION_MESSAGE_ONLY).encode()),
    "404-42P01-localized-message": (404, json.dumps({"code": "42P01", "message": "la relation « x » n'existe pas"}).encode()),
}


class Reply:
    def __init__(self, status_code, body):
        self.status_code, self.content = status_code, body
        self.text = body.decode("utf-8", "replace")

    def json(self):
        return json.loads(self.content)


@pytest.fixture(autouse=True)
def _pointer_env(monkeypatch):
    monkeypatch.setattr(mp, "_disabled_for_process", False)
    monkeypatch.setattr(mp, "_ambiguous_404s", 0)
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: ("https://db.invalid", {"apikey": "test-key"}))
    monkeypatch.delenv("MANIFEST_POINTER", raising=False)


@pytest.fixture
def http(monkeypatch):
    """requests.get / requests.patch: each call consumes the next scripted Reply (the last one repeats)."""
    import requests
    script = SimpleNamespace(get=[], patch=[], gets=0, patches=0)

    def answer(queue, counter):
        def call(url, **kwargs):
            setattr(script, counter, getattr(script, counter) + 1)
            reply = queue[0] if len(queue) == 1 else queue.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply
        return call
    monkeypatch.setattr(requests, "get", answer(script.get, "gets"))
    monkeypatch.setattr(requests, "patch", answer(script.patch, "patches"))
    return script


def _calls(which):
    return {"read": lambda: mp.read_pointer(),
            "cas": lambda: mp.cas_advance(5, "manifests/new.json", None, "designated:test", expected_key="k")}[which]


# ── the standard itself ────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("which", ["read", "cas"])
@pytest.mark.parametrize("name", sorted(AMBIGUOUS))
def test_with_the_lane_on_a_404_that_does_not_say_the_relation_is_gone_is_transient_and_never_latches(
        monkeypatch, http, caplog, capsys, which, name):
    monkeypatch.setenv(FLAG, "1")
    status, body = AMBIGUOUS[name]
    (http.get if which == "read" else http.patch).append(Reply(status, body))
    with caplog.at_level(logging.WARNING):
        result = _calls(which)()
    assert result in (None, False)
    assert mp.pointer_enabled() is True, "one ambiguous %d latched the lane off for the whole process" % status
    assert any(r.levelno >= logging.ERROR for r in caplog.records), "the first ambiguous answer must be loud"
    assert "::error::" not in capsys.readouterr().out


@pytest.mark.parametrize("which", ["read", "cas"])
@pytest.mark.parametrize("name", sorted(DEFINITE))
def test_with_the_lane_on_an_answer_that_says_the_relation_does_not_exist_latches_and_says_so_loudly(
        monkeypatch, http, capsys, which, name):
    monkeypatch.setenv(FLAG, "1")
    status, body = DEFINITE[name]
    (http.get if which == "read" else http.patch).append(Reply(status, body))
    assert _calls(which)() in (None, False)
    assert mp.pointer_enabled() is False
    assert "::error::" in capsys.readouterr().out, "pointer-first readers will never see this process's registrations: say so"


def test_the_latch_annotation_is_written_once_per_process(monkeypatch, http, capsys):
    monkeypatch.setenv(FLAG, "1")
    http.get.append(Reply(*DEFINITE["404-42P01"]))
    http.patch.append(Reply(*DEFINITE["404-42P01"]))
    mp.read_pointer()
    mp.cas_advance(5, "k", None, "x")                                   # a second definite answer: already latched, not repeated
    assert capsys.readouterr().out.count("::error::") == 1


@pytest.mark.parametrize("which", ["read", "cas"])
@pytest.mark.parametrize("name", sorted(AMBIGUOUS) + sorted(DEFINITE))
def test_with_the_flag_off_the_old_standard_is_untouched_any_404_and_a_400_with_42P01_latch_quietly(
        monkeypatch, http, capsys, which, name):
    monkeypatch.delenv(FLAG, raising=False)
    status, body = {**AMBIGUOUS, **DEFINITE}[name]
    (http.get if which == "read" else http.patch).append(Reply(status, body))
    _calls(which)()
    latches_by_the_old_rule = status == 404 or (status == 400 and b"42P01" in body)
    assert (mp.pointer_enabled() is False) == latches_by_the_old_rule
    assert "::error::" not in capsys.readouterr().out, "flag off writes nothing new"


def test_ambiguous_404s_are_logged_at_error_once_every_five_and_at_warning_between(monkeypatch, http, caplog):
    assert mp.AMBIGUOUS_404_ERROR_EVERY == 5
    monkeypatch.setenv(FLAG, "1")
    http.get.append(Reply(*AMBIGUOUS["PGRST205-schema-cache-miss"]))
    with caplog.at_level(logging.WARNING):
        for _ in range(11):
            mp.read_pointer()
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errors) == 3 and mp.pointer_enabled() is True


# ── what the publisher does with it ────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def real_read(chain, monkeypatch):
    """The Chain's pointer READ out of the way: the REAL read_pointer / pointer_enabled over a scripted HTTP (the swap stays the Chain's)."""
    monkeypatch.setattr(mp, "read_pointer", REAL.read_pointer)
    monkeypatch.setattr(mp, "pointer_enabled", REAL.pointer_enabled)
    return chain


@pytest.fixture
def real_pointer(real_read, monkeypatch):
    """... and the REAL cas_advance too."""
    monkeypatch.setattr(mp, "cas_advance", REAL.cas_advance)
    return real_read


def _row_reply(chain):
    return Reply(200, json.dumps([{"generation": chain.generation, "manifest_key": chain.head_key}]).encode())


def test_one_ambiguous_404_on_the_pointer_read_is_retried_and_the_snapshot_publishes_through_the_pointer(
        real_read, store, parked, http, sleeps):
    """P4 (reviewer): after one 404 the process was latched, made 0 CAS calls and PUT manifest.json once."""
    chain = real_read
    http.get[:] = [Reply(*AMBIGUOUS["PGRST205-schema-cache-miss"]), _row_reply(chain)]
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert mp.pointer_enabled() is True
    assert [c["won"] for c in chain.cas_calls] == [True] and chain.head_files() == sorted(BASE + PILOTS_NEW)
    order = [u[0] for u in chain.uploads]
    assert order[0].startswith("manifests/") and order.count("manifest.json") == 1 and order.index("manifest.json") > 0, order
    assert len(sleeps) == 1


def test_five_ambiguous_404s_publish_nothing_and_never_touch_manifest_json(real_read, store, parked, http, sleeps, caplog):
    chain = real_read
    http.get[:] = [Reply(*AMBIGUOUS["proxy-html"])]
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert chain.uploads == [] and chain.cas_calls == [] and mp.pointer_enabled() is True
    assert http.gets == mps.MAX_ATTEMPTS and len(sleeps) == mps.MAX_ATTEMPTS - 1
    assert any(r.levelno >= logging.ERROR for r in caplog.records)


def test_an_ambiguous_404_on_the_swap_is_a_failed_attempt_not_a_latch_and_not_the_old_path(real_pointer, store, parked, http, sleeps):
    chain = real_pointer
    http.get[:] = [_row_reply(chain)]
    http.patch[:] = [Reply(*AMBIGUOUS["PGRST205-schema-cache-miss"])]
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert mp.pointer_enabled() is True and http.patches == mps.MAX_ATTEMPTS
    assert "manifest.json" not in [u[0] for u in chain.uploads], "a transient 404 fell back to the lossy path"
    assert chain.generation == 5


def test_a_definite_missing_table_runs_the_old_path_once_and_the_lane_is_inert_afterwards(real_read, store, parked, http, capsys):
    chain = real_read
    http.get[:] = [Reply(*DEFINITE["404-42P01"])]
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert mp.pointer_enabled() is False and mps.one_step_active() is False
    assert [u[0] for u in chain.uploads] == ["manifest.json"] and chain.cas_calls == []
    out = capsys.readouterr().out
    assert out.count("::error::") == 2 and "pointer" in out.lower(), "the latch and the old path each say so"
