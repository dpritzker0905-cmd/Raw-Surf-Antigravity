"""WS-CAN-0009 / WS-OBJ-103 — a failed request must not answer 200, and must not leak the exception.

THE DEFECT. `routes/surf_data/conditions.py` had NINE error-shaped returns (verified by AST, not by
the register's line numbers), FOUR of which returned raw `str(e)` to the client. Every one answered
**HTTP 200**, so a total upstream failure was indistinguishable from data at the status layer.

⭐ THE CLIENT CONTRACT DECIDED THE STATUS CODE, and it ruled out the obvious answer.
`lib/apiClient.js` is axios with a rejecting response interceptor, and it handles some codes
GLOBALLY:

    401 -> session-expired toast + redirect
    403 -> handled
    429 -> "Too many requests" toast
    503 -> "Service temporarily unavailable. Please try again shortly."   <-- GLOBAL TOAST

So mapping these failures to **503** — the intuitive choice for "upstream unavailable" — would fire a
user-visible toast on every failure, including one failing spot behind the explore feed. **502** falls
through to `return Promise.reject(error)` and lands in each caller's existing `catch`. That is why
the register's Remaining Work says *"map failures to real status codes WITH A CLIENT-CONTRACT CHECK
FIRST"*.

⚠️ THE BATCH IS DIFFERENT AND MUST STAY 200. `/conditions/batch` is a partial-success surface: one
spot's upstream failure must not fail the other 86. The failed spot KEEPS its entry, in input order,
with a GENERIC message — I first omitted it and an existing guard
(`test_spot_conditions_batch_bounds::test_response_shape_and_input_order_match_the_serial_implementation`)
caught it. That guard is right: "this one failed" is a real answer about that spot, and collapsing it
into "absent" would make an upstream failure indistinguishable from an id that does not exist. The
failure is additionally lifted to a top-level `failed` key, mirroring the `truncated_to` key the same
function already uses.

That matters because of what the client does with an error entry today
(`hooks/useExploreData.js:32`):

    conditionsMap[spotId] = { spot_id, wave_height_ft: data.wave_height_ft, ...data }

An `{"error": ...}` dict spreads straight into the UI's state map as `wave_height_ft: undefined` —
a failure rendering as blank data, with the catch never firing because the status was 200.

⛔ NOT EVERY ERROR-SHAPED RETURN IS A FAILURE. `:270` returns "Tide data unavailable for this
location" after `logger.info("no global tide series")` — a genuine ABSENCE, and its own comment
explains the deliberate refusal to serve another region's tides. It stays 200. The adjacent `:274`
returned the SAME sentence from an `except` block — a failure wearing absence's words. Only that one
changes.
"""
import ast
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

SRC = os.path.join(BACKEND, "routes", "surf_data", "conditions.py")


def _tree():
    return ast.parse(open(SRC, encoding="utf-8").read())


def _error_returns():
    """Every `return` whose value mentions an error, by line — AST, never a line-number list."""
    out = []
    for fn in [n for n in ast.walk(_tree()) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        for n in ast.walk(fn):
            if isinstance(n, ast.Return) and n.value is not None:
                try:
                    txt = ast.unparse(n.value)
                except Exception:
                    continue
                if "error" in txt.lower():
                    out.append((n.lineno, fn.name, txt))
    return out


# ── the leak ────────────────────────────────────────────────────────────────────────────────────

def test_no_response_body_carries_the_exception_text():
    """THE SECURITY HALF. `str(e)` on a wire reachable by any client leaks internal paths, driver
    messages, and upstream URLs. Four sites did this. The exception must be LOGGED, never returned."""
    leaks = [f"conditions.py:{ln} in {fn}(): {txt[:90]}"
             for ln, fn, txt in _error_returns()
             if "str(e" in txt or "str(exc" in txt or "{e}" in txt]
    assert not leaks, (
        "these return the raw exception text to the client:\n  " + "\n  ".join(leaks))


def test_the_scan_can_actually_see_the_returns__THE_CONTROL():
    """REFUSE rather than pass vacuously — if the AST walk stops reading the file, the leak guard
    above passes on nothing.

    ⚠️ This originally asserted `>= 3` error-shaped returns, calibrated to the PRE-FIX tree, and it
    went red the moment the fix landed and left only the genuine-absence path. A control must verify
    that the INSTRUMENT works, not encode the defect's own count — otherwise it fails on success.
    So it now checks the walk reaches the real handlers and a plausible number of returns overall,
    plus the one error-shaped return we deliberately kept."""
    fns = {n.name for n in ast.walk(_tree())
           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    for required in ("get_batch_conditions", "get_spot_conditions", "get_spot_forecast",
                     "get_spot_tides"):
        assert required in fns, f"{required} not seen — the scan is reading the wrong file"
    all_returns = [n for n in ast.walk(_tree()) if isinstance(n, ast.Return)]
    assert len(all_returns) >= 8, (
        f"only {len(all_returns)} returns found in the whole module — the walk is not working")
    assert _error_returns(), (
        "no error-shaped return at all — the genuine-absence path was swept up in the status "
        "change, so absence is now being reported as a failure")


# ── the status ──────────────────────────────────────────────────────────────────────────────────

def test_a_total_failure_raises_instead_of_returning_200():
    """The three single-spot routes have no partial-success semantics: if the resolver failed, the
    request failed. Their `except` blocks must raise, not return a 200 body."""
    offenders = []
    for fn in [n for n in ast.walk(_tree()) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        if fn.name not in ("get_spot_conditions", "get_spot_forecast", "get_spot_tides"):
            continue
        for h in [n for n in ast.walk(fn) if isinstance(n, ast.ExceptHandler)]:
            for n in ast.walk(h):
                if isinstance(n, ast.Return) and n.value is not None:
                    try:
                        txt = ast.unparse(n.value)
                    except Exception:
                        continue
                    if "error" in txt.lower():
                        offenders.append(f"{fn.name}():{n.lineno} returns {txt[:70]}")
    assert not offenders, (
        "an exception handler answers HTTP 200 with an error body, so a failed request is "
        "indistinguishable from data at the status layer:\n  " + "\n  ".join(offenders))


@pytest.mark.parametrize("bad", ["503", "429", "401", "403"])
def test_the_new_status_codes_avoid_the_GLOBALLY_HANDLED_ones(bad):
    """⭐ THE CLIENT-CONTRACT GUARD, and the reason this mission did not use 503.

    `lib/apiClient.js` toasts 503 and 429 globally and redirects on 401. A conditions failure must
    not trigger a global toast — one failing spot behind the explore feed would spam the user. 502
    falls through to the caller's own catch. If someone later 'simplifies' these to 503, this fails
    and says why."""
    src = open(SRC, encoding="utf-8").read()
    tree = ast.parse(src)
    used = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Raise) and n.exc is not None:
            txt = ast.unparse(n.exc)
            if "HTTPException" in txt:
                for code in ("400", "401", "403", "404", "429", "500", "502", "503", "504"):
                    if f"status_code={code}" in txt:
                        used.add(code)
    assert bad not in used, (
        f"conditions.py raises HTTPException({bad}) — apiClient.js handles that status GLOBALLY "
        f"(toast/redirect), so a single spot's upstream failure becomes a user-visible interruption. "
        f"Use 502: it falls through to the caller's catch.")


def test_a_genuine_ABSENCE_is_still_a_200():
    """⛔ NOT EVERY ERROR-SHAPED RETURN IS A FAILURE. `get_spot_tides` returns 'Tide data unavailable
    for this location' when no global tide series covers the coordinate — a real answer about the
    world, deliberately refusing to serve a neighbouring region's tides. Turning THAT into a 5xx
    would report a system fault for a place that simply has no tide station."""
    src = open(SRC, encoding="utf-8").read()
    assert "Tide data unavailable for this location" in src, (
        "the genuine-absence path lost its wording — check it was not swept up in the status change")
    kept = [txt for ln, fn, txt in _error_returns()
            if "Tide data unavailable for this location" in txt]
    assert kept, "the absence path no longer RETURNS (it now raises) — absence is not a failure"


# ── the batch stays partial-success ─────────────────────────────────────────────────────────────

def test_the_batch_never_raises_for_one_spot():
    """`/conditions/batch` serves up to 200 spots. One upstream failure must not fail the request —
    the other 86 are good data."""
    for fn in [n for n in ast.walk(_tree()) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        if fn.name != "get_batch_conditions":
            continue
        raises = [ast.unparse(n.exc) for n in ast.walk(fn)
                  if isinstance(n, ast.Raise) and n.exc is not None]
        bad = [r for r in raises if "HTTPException" in r and "404" not in r]
        assert not bad, f"the batch route raises on a per-spot failure: {bad}"
        return
    pytest.fail("get_batch_conditions not found — the scan is looking at the wrong file")


def test_a_failed_spot_stays_in_the_payload_and_is_DISCLOSED_at_the_top_level():
    """⚠️ I GOT THIS WRONG FIRST AND AN EXISTING GUARD CAUGHT ME.

    My first design OMITTED a failed spot from `conditions`, reasoning that an unknown id is already
    absent (verified on production) so failure should look the same. But
    `test_spot_conditions_batch_bounds.py::test_response_shape_and_input_order_match_the_serial_implementation`
    pins a failed spot as PRESENT, in input order — and it is right: this is a partial-success
    surface, "this one failed" is a real answer about that spot, and collapsing it into "absent"
    would make an upstream failure indistinguishable from an id that does not exist.

    So the entry stays, with a GENERIC message, and the failure is additionally lifted to a
    top-level `failed` key so a caller can branch without type-sniffing every value — mirroring the
    `truncated_to` key this same function already uses.

    ⛔ RESIDUAL, and it is client-side: `useExploreData.js:32` spreads each entry into the UI state
    map, so an error entry still lands as `wave_height_ft: undefined` — blank data rather than a
    stated failure. That needs the frontend, which is frozen (WS-CAN-0039)."""
    src = open(SRC, encoding="utf-8").read()
    assert '"failed"' in src or "'failed'" in src, (
        "no top-level `failed` disclosure — a caller must type-sniff every entry to find failures")
    assert 'out["truncated_to"]' in src, (
        "the additive-key precedent this mirrors is gone — re-check the disclosure shape")
    assert 'return spot_id, {"error": "Unable to fetch conditions"}' in src, (
        "the per-spot error entry is no longer generic — either it was dropped (breaking the "
        "serial-parity contract) or the exception text is back")
