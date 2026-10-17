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

import services.weather_pipeline.store as store_mod
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
    monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: True)          # the designated writer: the lane CAN be active
    for name in ("MANIFEST_IMMUTABLE_PUBLICATION", "MANIFEST_MERGE_ON_UPLOAD", "MANIFEST_POINTER"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def http(monkeypatch):
    """requests.get / requests.patch: each call consumes the next scripted Reply (the last one repeats)."""
    import requests
    script = SimpleNamespace(get=[], patch=[], gets=0, patches=0, calls=[])

    def answer(queue, counter):
        def call(url, **kwargs):
            script.calls.append((counter, url, kwargs))
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


# ── the strict standard belongs to the ACTIVE lane only (round-6 finding 1) ────────────────────────────────────────────────
# `_one_step_lane_on()` read the raw flag, so with the flag on but the lane unavailable (immutable publication, merging switched off,
# not the designated writer) the legacy and immutable publishers still got the strict 404 standard: on a PGRST205 table they retried
# for ever instead of latching at the first read, 6 never-retired ~16 MB uploads over 6 manifest.json PUTs (immutable) or 6 bare
# manifest-g1 overwrites (merge off). One predicate now decides, in one place: manifest_pointer.one_step_lane_active().

LANE_UNAVAILABLE = {
    "flag-off": lambda monkeypatch: monkeypatch.delenv(FLAG, raising=False),
    "immutable-publication": lambda monkeypatch: (monkeypatch.setenv(FLAG, "1"), monkeypatch.setenv("MANIFEST_IMMUTABLE_PUBLICATION", "1")),
    "merge-on-upload-off": lambda monkeypatch: (monkeypatch.setenv(FLAG, "1"), monkeypatch.setenv("MANIFEST_MERGE_ON_UPLOAD", "0")),
    "not-the-designated-writer": lambda monkeypatch: (monkeypatch.setenv(FLAG, "1"),
                                                      monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: False)),
}
BODIES = {"PGRST205": AMBIGUOUS["PGRST205-schema-cache-miss"], "42P01": DEFINITE["404-42P01"]}


@pytest.mark.parametrize("which", ["read", "cas"])
@pytest.mark.parametrize("body", sorted(BODIES))
@pytest.mark.parametrize("combination", sorted(LANE_UNAVAILABLE))
def test_when_the_lane_is_not_active_the_old_standard_applies_byte_for_byte_even_with_the_flag_on(
        monkeypatch, http, caplog, capsys, combination, body, which):
    """Any 404 latches at once and quietly, exactly as with the flag off: no annotation, no ERROR."""
    LANE_UNAVAILABLE[combination](monkeypatch)
    status, content = BODIES[body]
    (http.get if which == "read" else http.patch).append(Reply(status, content))
    with caplog.at_level(logging.WARNING):
        assert _calls(which)() in (None, False)
    assert mp.pointer_enabled() is False, "a 404 must latch where the lane is not the lane"
    assert "::error::" not in capsys.readouterr().out
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


@pytest.mark.parametrize("combination", sorted(LANE_UNAVAILABLE))
def test_six_manifest_json_puts_on_a_pgrst205_table_make_no_pointer_uploads_unless_the_lane_is_active(
        monkeypatch, http, combination):
    """The reviewer's P2: 6 unique never-retired uploads (immutable) / 6 bare manifest-g1 overwrites (merge off); flag off made none."""
    LANE_UNAVAILABLE[combination](monkeypatch)
    http.get.append(Reply(*AMBIGUOUS["PGRST205-schema-cache-miss"]))
    uploads = []
    for _ in range(6):
        mp.publish_run_keyed(None, b"{}", lambda key, data, **kw: uploads.append(key) or True, lambda key: None)
    assert uploads == []


def test_the_one_predicate_is_the_one_the_dispatcher_uses(monkeypatch):
    """One source of truth: submit_manifest_publish and the 404 standard cannot disagree about whether the lane is the lane."""
    for name, arrange in LANE_UNAVAILABLE.items():
        arrange(monkeypatch)
        assert mp.one_step_lane_active() is mps.one_step_active() is False, name
        monkeypatch.undo()
        monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: True)
    monkeypatch.setenv(FLAG, "1")
    assert mp.one_step_lane_active() is mps.one_step_active() is True


# ── the REAL cas_advance classification, not the harness hand-setting `_cas_answer` (round-6 finding 6) ───────────────────────
# The publisher's lost-ack rules hang on one bit: did the swap CERTAINLY not apply ("lost") or MAY it have ("unknown")? Every other
# test fakes that bit in the Chain. These drive the real function over scripted HTTP answers.

def _cas_answers():
    import requests
    ok = json.dumps([{"generation": 6}]).encode()
    return {
        "200-row": (Reply(200, ok), True, "won"),
        "201-row": (Reply(201, ok), True, "won"),
        "200-empty-list": (Reply(200, b"[]"), False, "lost"),
        "200-empty-object": (Reply(200, b"{}"), False, "lost"),
        "409-conflict": (Reply(409, b'{"code": "23505"}'), False, "unknown"),
        "500": (Reply(500, b"boom"), False, "unknown"),
        "503": (Reply(503, b"unavailable"), False, "unknown"),
        "429": (Reply(429, b"slow down"), False, "unknown"),
        "401": (Reply(401, b'{"message": "JWT expired"}'), False, "unknown"),
        "200-not-json": (Reply(200, b"<html>gateway</html>"), False, "unknown"),
        "timeout": (requests.Timeout("read timed out"), False, "unknown"),
        "connection-reset": (requests.ConnectionError("reset by peer"), False, "unknown"),
        "404-PGRST205": (Reply(404, json.dumps(PGRST205).encode()), False, "unknown"),
        "404-empty": (Reply(404, b""), False, "unknown"),
    }


@pytest.mark.parametrize("name", sorted(_cas_answers()))
def test_cas_advance_classifies_every_answer_as_won_lost_or_unknown(monkeypatch, http, name):
    monkeypatch.setenv(FLAG, "1")
    reply, returned, answer = _cas_answers()[name]
    http.patch.append(reply)
    assert mp.cas_advance(5, "manifests/new.json", None, "designated:test", expected_key="k") is returned
    assert mp.last_cas_answer() == answer


@pytest.mark.parametrize("name", sorted(DEFINITE))
def test_a_definite_missing_table_on_the_swap_is_unknown_not_lost(monkeypatch, http, name):
    """The swap did not apply either, but nothing here says 'a precondition missed'; the lane is latched off and never asks again."""
    monkeypatch.setenv(FLAG, "1")
    http.patch.append(Reply(*DEFINITE[name]))
    assert mp.cas_advance(5, "k", None, "x") is False and mp.last_cas_answer() == "unknown"


@pytest.mark.parametrize("flag", ["on", "off"])
@pytest.mark.parametrize("status", [500, 503, 429])
@pytest.mark.parametrize("which", ["read", "cas"])
def test_a_server_error_that_quotes_42P01_never_latches_the_lane(monkeypatch, http, which, status, flag):
    """M04: 'any status carrying 42P01' would turn a 5xx whose body mentions the code into the lossy old path for the process."""
    if flag == "on":
        monkeypatch.setenv(FLAG, "1")
    else:
        monkeypatch.delenv(FLAG, raising=False)
    (http.get if which == "read" else http.patch).append(Reply(status, json.dumps(UNDEFINED_TABLE).encode()))
    assert _calls(which)() in (None, False)
    assert mp.pointer_enabled() is True


def test_every_swap_starts_from_unknown_so_a_stale_won_never_survives_a_call_that_did_not_get_an_answer(monkeypatch, http):
    monkeypatch.setenv(FLAG, "1")
    http.patch.append(Reply(200, json.dumps([{"generation": 6}]).encode()))
    assert mp.cas_advance(5, "k", None, "x") is True and mp.last_cas_answer() == "won"
    http.patch[:] = [Reply(503, b"unavailable")]
    assert mp.cas_advance(6, "k2", None, "x") is False and mp.last_cas_answer() == "unknown"
    mp._cas_answer.value = "won"                                                    # left over from anything earlier on this thread
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: (None, None))         # ... and a call that never reaches the network
    assert mp.cas_advance(5, "k", None, "x") is False and mp.last_cas_answer() == "unknown"


def test_the_answer_belongs_to_the_thread_that_made_the_call(monkeypatch, http):
    import threading
    monkeypatch.setenv(FLAG, "1")
    http.patch.append(Reply(200, json.dumps([{"generation": 6}]).encode()))
    assert mp.cas_advance(5, "k", None, "x") is True
    seen = []
    worker = threading.Thread(target=lambda: seen.append(mp.last_cas_answer()))
    worker.start()
    worker.join()
    assert seen == ["unknown"] and mp.last_cas_answer() == "won"


def _gave_up_after(real_pointer, store, parked, http, sleeps, replies):
    chain = real_pointer
    http.get[:] = [_row_reply(chain)]
    http.patch[:] = replies
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    return mps._slot


def test_through_the_real_function_a_clean_loss_remembers_nothing_and_an_unknown_answer_remembers_the_swap(
        real_pointer, store, parked, http, sleeps):
    slot = _gave_up_after(real_pointer, store, parked, http, sleeps, [Reply(200, b"[]")])
    assert http.patches == mps.MAX_ATTEMPTS and slot.attempted == {} and slot.unconfirmed is None, "a clean loss is not a lost answer"
    slot.pending = None
    slot = _gave_up_after(real_pointer, store, parked, http, sleeps, [Reply(503, b"unavailable")])
    assert slot.pending is not None and len(slot.attempted) == mps.ATTEMPTED_KEEP, "an unknown answer may have applied: its key is remembered"


@pytest.mark.parametrize("name", ["409-conflict", "401", "200-not-json", "timeout"])
def test_through_the_real_function_every_answer_but_a_clean_loss_counts_as_unknown(real_pointer, store, parked, http, sleeps, name):
    reply = _cas_answers()[name][0]
    slot = _gave_up_after(real_pointer, store, parked, http, sleeps, [reply])
    assert len(slot.attempted) == mps.ATTEMPTED_KEEP


def test_the_real_pointer_calls_keep_their_8_second_default_and_honour_an_explicit_timeout(monkeypatch, http):
    """The exit flush passes what is left of its budget; every other caller must keep today's 8 s."""
    monkeypatch.setenv(FLAG, "1")
    http.get.append(Reply(200, b"[]"))
    http.patch.append(Reply(200, b"[]"))
    mp.read_pointer()
    mp.cas_advance(5, "k", None, "x")
    mp.read_pointer(timeout=3)
    mp.cas_advance(5, "k", None, "x", timeout=3)
    assert [(kind, kwargs["timeout"]) for kind, _, kwargs in http.calls] == [("gets", 8), ("patches", 8), ("gets", 3), ("patches", 3)]
