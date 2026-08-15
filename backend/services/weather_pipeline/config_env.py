"""config_env.py — numeric configuration reads that cannot crash the boot or accept nonsense.

MC-09 (Master Codex Audit 1.0), first slice, 2026-08-15. The census that motivated this: 22
module-level `int()`/`float()` parses over `os.environ.get` across 13 serving files. Every one was
an IMPORT-TIME crash on a config typo ("six", "0.5" into an int, a pasted unit) — the module dies
at boot and takes its routes with it. And the parsed values flowed into sharp edges unchecked:
`SPOT_RATINGS_CONCURRENCY=0` reached `asyncio.Semaphore(0)` in conditions.py:73 with no floor
(every /conditions/batch request waits forever), while weather.py:563 clamped the SAME variable —
one env var, two hardenings, the one-quantity-two-behaviors class.

THE FAILURE POLICY, chosen deliberately: config degrades to the SHIPPED DEFAULT, loudly. For
configuration, the default is the value every test lane and every calibration ran against — a
typo must cost a warning, never the boot. (Contrast auth, where fail-closed is correct; the
asymmetry is the point, not an oversight.) Out-of-range values CLAMP to the nearest bound,
loudly — a semaphore of 0 becomes 1 and says so instead of deadlocking silently.

Guarded by tests/test_config_env.py (contract) and tests/test_startup_config_hardening.py (the
class guard: no module-level bare numeric env parse may return to routes/ or weather_pipeline/).
"""
import hashlib
import os
import sys


def _warn(name: str, raw, action: str) -> None:
    sys.stderr.write(f"[config_env] {name}={raw!r}: {action}\n")


def env_int(name: str, default: int, lo: int = None, hi: int = None) -> int:
    """Read an int env var: typo → shipped default (loud); out of [lo, hi] → clamped (loud)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        val = int(raw)
    except (TypeError, ValueError):
        _warn(name, raw, f"unparseable int; using the shipped default {default}")
        return default
    if lo is not None and val < lo:
        _warn(name, raw, f"below the floor {lo}; clamped")
        return lo
    if hi is not None and val > hi:
        _warn(name, raw, f"above the ceiling {hi}; clamped")
        return hi
    return val


def env_float(name: str, default: float, lo: float = None, hi: float = None) -> float:
    """Read a float env var: typo/NaN → shipped default (loud); out of [lo, hi] → clamped (loud).

    NaN is treated as a typo, not a value — float("nan") parses, passes every comparison, and
    would poison any deadline or TTL it reached."""
    raw = os.environ.get(name)
    if raw is None:
        return float(default)
    try:
        val = float(raw)
    except (TypeError, ValueError):
        _warn(name, raw, f"unparseable float; using the shipped default {default}")
        return float(default)
    if val != val:
        _warn(name, raw, f"NaN; using the shipped default {default}")
        return float(default)
    if lo is not None and val < lo:
        _warn(name, raw, f"below the floor {lo}; clamped")
        return float(lo)
    if hi is not None and val > hi:
        _warn(name, raw, f"above the ceiling {hi}; clamped")
        return float(hi)
    return val


def compute_config_fingerprint() -> dict:
    """A REDACTED configuration identity for /api/health (the audit's Phase-1 config gate).

    sha256 over the sorted resolved `name=value` set of every flag DECLARED in `_RATING_FLAGS`,
    truncated to 12 hex chars, plus two counts. Incident response can tell two boxes or two
    moments apart without any flag value crossing the wire; brute-forcing the hash back to a
    flag combination tells an attacker nothing the admin panel does not already gate.

    The registry lives in a route module; the lazy import below is a deliberate, function-scoped
    layering exception (services → routes) so the fingerprint has ONE source of declared flags
    rather than a second copy that drifts (the two-copies class)."""
    from routes.admin.surf_forecast import _RATING_FLAGS
    parts = []
    non_default = 0
    for fname in sorted(_RATING_FLAGS):
        default = _RATING_FLAGS[fname][0]
        val = os.environ.get(fname, default)
        parts.append(f"{fname}={val}")
        if val != default:
            non_default += 1
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()[:12]
    return {
        "config_fingerprint": digest,
        "flags_declared": len(_RATING_FLAGS),
        "flags_non_default": non_default,
    }
