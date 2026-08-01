"""`FastMCP`, or a stand-in that lets the sim's logic be IMPORTED without the server framework.

## Why this exists

fastmcp **cannot be installed into this app's pinned stack**, and that is not a pin to tune: every
published release (3.3.1 … 2.2.10) requires `httpx>=0.28.1` against a pinned `httpx==0.27.2`, and
forcing it lifts starlette until `routes/social` dies on
`Router.__init__() got an unexpected keyword argument 'on_startup'`.

The consequence was invisible and expensive: **`weather_sim_mcp.py` imports fastmcp at module scope,
so every test that imports it is unrunnable in CI**, and `ci.yml` dropped six modules from the
composition guard suite BY NAME to keep the suite collectable. Among the excluded were the sim's
most load-bearing guards — `test_sim_whatif_baseline` (the ZERO-NETWORK invariant, whose regression
`576dcbdd` was 42.2 s of blocking past an MCP client's timeout), `test_sim_forecast_lane`, and
`test_sim_spots_identity`. ⇒ **the sim's core invariants were verified only on a laptop.** A guard
that runs nowhere is a guard that will be broken by the first person who does not run it by hand.

★ The fix is the one `HANDOFF-2026-08-01-E` §5 called "smaller and the better shape": stop requiring
a *server framework* in order to import *pure logic*. The fastmcp surface this app uses is four
names — the class, `.tool`, `.resource`, `.prompt` — plus `.run()`. Standing in for them is a few
lines; extracting ~300 LOC of tool bodies into a second module would have been the alternative.

## ⛔ THE FAILURE MODE THIS MUST NOT HAVE

A silent stand-in is worse than an ImportError: the server would start, register nothing, and answer
no tools while looking healthy — the recorded *"a swallowed throw is a feature that silently turns
itself off"* shape, applied to a whole process. So:

* `USING_REAL_FASTMCP` states plainly which one is loaded, and callers can assert on it.
* **`run()` REFUSES.** A server that cannot serve must fail loudly at startup, not accept a socket
  and answer nothing. This is the single most important line in the file.
* Registration is a **no-op that returns the function unchanged** — never a wrapper — so importing
  under the stand-in cannot change what the tool functions ARE. Real fastmcp returns a Tool object
  carrying `.fn`, which is why the suite reads `getattr(tool, "fn", tool)`; that idiom resolves to
  the plain function here, so tests exercise identical objects either way.
"""
import os
from typing import Any, Callable, Optional

# ★ REPRODUCE CI'S CONDITION ON A LAPTOP THAT HAS fastmcp. Set SIM_MCP_FORCE_STANDIN=1 to take the
# no-fastmcp branch deliberately. This exists because of a mistake made earlier the same day: a
# junitxml behaviour was measured in a bare scratch directory, generalised, and turned out to be
# wrong inside the real test package. **A measurement taken outside the configuration that actually
# runs answers an adjacent question**, so the configuration CI uses must be reachable here.
_FORCED = os.environ.get("SIM_MCP_FORCE_STANDIN", "0") == "1"

try:                                             # pragma: no cover - trivial, and env-dependent
    if _FORCED:
        raise ImportError("SIM_MCP_FORCE_STANDIN=1")
    from fastmcp import FastMCP as _FastMCP
    USING_REAL_FASTMCP = True
except ImportError:                              # pragma: no cover - see module docstring
    _FastMCP = None
    USING_REAL_FASTMCP = False


def _identity(fn: Callable) -> Callable:
    """Register nothing and return the function UNCHANGED — never a wrapper.

    ⚠️ Returning a wrapper would make the stand-in observably different from the real framework in
    the one way that matters to the guards: they call the tool bodies directly. Identity keeps
    "imported without a server" and "imported with one" the same objects to everything downstream.
    """
    return fn


class _FastMCPStandIn:
    """Enough of the FastMCP surface to IMPORT a server module. Not enough to RUN one, on purpose."""

    def __init__(self, name: str = "", *args: Any, **kwargs: Any) -> None:
        self.name = name

    # `@mcp.tool` is used BARE in weather_sim_mcp.py (no call parens), so this must accept the
    # function directly. It also accepts the called form `@mcp.tool(...)` so a future edit in the
    # other style does not silently register a decorator factory as if it were a tool.
    def tool(self, fn: Optional[Callable] = None, *args: Any, **kwargs: Any) -> Callable:
        return _identity(fn) if callable(fn) else _identity

    def resource(self, *args: Any, **kwargs: Any) -> Callable:
        return _identity

    def prompt(self, *args: Any, **kwargs: Any) -> Callable:
        return _identity

    def run(self, *args: Any, **kwargs: Any):
        raise RuntimeError(
            "fastmcp is not installed, so this process can IMPORT the weather-sim logic but cannot "
            "SERVE it. Refusing to start rather than accepting connections and answering no tools. "
            "Install fastmcp in the environment that runs the MCP server; the test environment "
            "deliberately does not have it (it is incompatible with the app's pinned httpx)."
        )


FastMCP = _FastMCP if USING_REAL_FASTMCP else _FastMCPStandIn
