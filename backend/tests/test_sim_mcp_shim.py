"""The sim's logic must be IMPORTABLE without a server framework — and must REFUSE to serve without one.

★★★ WHY THIS MATTERS MORE THAN IT LOOKS. fastmcp cannot be installed into this app's pinned stack
(every release needs `httpx>=0.28.1` against a pinned 0.27.2; forcing it lifts starlette until
`routes/social` dies on `on_startup`). Because `weather_sim_mcp.py` imported it at module scope,
`ci.yml` had to drop SIX modules from the composition guard suite BY NAME just to keep the suite
collectable — and among them were the sim's most load-bearing guards:

    test_sim_whatif_baseline          the ZERO-NETWORK invariant (`576dcbdd` = 42.2 s of blocking,
                                      past where an MCP client reports a timeout)
    test_sim_forecast_lane            the live-forecast lane
    test_sim_spots_identity           one identity per spot name
    test_rating_partitions_composition

⇒ **the sim's core invariants were verified only on a laptop.** A guard that runs nowhere is a guard
that will be broken by the first person who does not run it by hand, and nothing will say so.

`sim_mcp_shim` fixes that by standing in for the four fastmcp names this app uses. These tests pin
the two halves that make the stand-in safe rather than merely convenient:
  1. importing works, and the tool functions are the SAME OBJECTS either way;
  2. **running REFUSES** — a server that cannot serve must fail loudly, not accept connections and
     answer no tools. That would be "a swallowed throw is a feature that silently turns itself off",
     applied to a whole process.
"""
import importlib
import os

import pytest

from services.weather_pipeline import sim_mcp_shim


def _standin_module(monkeypatch):
    """Reload the shim with the stand-in forced, as CI experiences it."""
    monkeypatch.setenv("SIM_MCP_FORCE_STANDIN", "1")
    mod = importlib.reload(sim_mcp_shim)
    assert mod.USING_REAL_FASTMCP is False, (
        "SIM_MCP_FORCE_STANDIN=1 did not take the stand-in branch — this test would otherwise be "
        "silently exercising real fastmcp and proving nothing about the fallback")
    return mod


@pytest.fixture(autouse=True)
def _restore():
    """⚠️ The shim is a module-level singleton: leaving it reloaded in the forced state would make
    every later test in the session run against the stand-in. Restore it whatever happens."""
    yield
    os.environ.pop("SIM_MCP_FORCE_STANDIN", None)
    importlib.reload(sim_mcp_shim)


def test_the_standin_registers_tools_as_THEMSELVES_not_wrappers(monkeypatch):
    """★ Identity, not "it returns something callable". The guards call the tool bodies directly, and
    real fastmcp returns a Tool object carrying `.fn` — which is why the suite reads
    `getattr(tool, "fn", tool)`. That idiom must resolve to the SAME function under the stand-in, or
    the two environments are testing different objects while both look green."""
    mod = _standin_module(monkeypatch)
    mcp = mod.FastMCP("test")

    def a_tool(x):
        return x * 2

    assert mcp.tool(a_tool) is a_tool                       # bare  @mcp.tool
    assert mcp.tool()(a_tool) is a_tool                     # called @mcp.tool()
    assert mcp.resource("data://x")(a_tool) is a_tool
    assert mcp.prompt("advisor")(a_tool) is a_tool
    assert getattr(mcp.tool(a_tool), "fn", mcp.tool(a_tool)) is a_tool
    assert a_tool(21) == 42, "registration must not disturb the function's behaviour"


def test_running_the_standin_REFUSES_rather_than_serving_nothing(monkeypatch):
    """⛔ THE MOST IMPORTANT LINE IN THE SHIM. A silent stand-in is strictly worse than an
    ImportError: the process would start, register nothing, and answer no tools while looking
    healthy. Fail at startup instead."""
    mod = _standin_module(monkeypatch)
    with pytest.raises(RuntimeError) as e:
        mod.FastMCP("test").run()
    msg = str(e.value)
    assert "fastmcp is not installed" in msg
    # ★ The message must say what to DO, not just that something is wrong — a red that names its own
    # cause is the difference between a gate people keep and a gate people mute.
    assert "Install fastmcp" in msg and "cannot" in msg


def test_the_real_framework_is_preferred_whenever_it_is_installed():
    """The stand-in must never displace the real thing. Without the force flag, whatever this
    environment has is what gets used — and the flag is the ONLY way to take the fallback."""
    mod = importlib.reload(sim_mcp_shim)
    try:
        import fastmcp  # noqa: F401
        assert mod.USING_REAL_FASTMCP is True, (
            "fastmcp is importable here but the shim took the stand-in branch — the fallback is "
            "shadowing a working framework")
        assert mod.FastMCP is not mod._FastMCPStandIn
    except ImportError:
        assert mod.USING_REAL_FASTMCP is False
        assert mod.FastMCP is mod._FastMCPStandIn


def test_the_sim_module_imports_under_the_standin(monkeypatch):
    """END TO END: the point of the whole exercise. `weather_sim_mcp` must import with no fastmcp,
    because that is the only reason its guards can run in CI."""
    _standin_module(monkeypatch)
    import weather_sim_mcp
    mod = importlib.reload(weather_sim_mcp)
    for name in ("get_weather_forecast", "simulate_weather_change",
                 "find_best_spot", "find_best_window", "get_surf_spots"):
        fn = getattr(mod, name, None)
        assert fn is not None, f"{name} vanished when the stand-in registered it"
        assert callable(getattr(fn, "fn", fn)), f"{name} is not callable under the stand-in"
    importlib.reload(weather_sim_mcp)          # leave the session on whatever is really installed


def test_ci_does_not_still_exclude_what_the_shim_freed():
    """⭐ THE COVERAGE HALF. Making the modules importable buys nothing while `ci.yml` still greps
    them out by name — an exclusion outliving its reason is invisible, and 'excluded' and 'passing'
    look identical in a summary line. This asserts the workflow actually stopped dropping them."""
    ci = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "..", ".github", "workflows", "ci.yml")
    with open(os.path.normpath(ci), "r", encoding="utf-8") as fh:
        text = fh.read()
    freed = ["sim_forecast_lane", "sim_spots_identity", "sim_whatif_baseline",
             "rating_partitions_composition", "sim_whatif_size_curve_and_io_budget"]
    still = [n for n in freed if f"{n}|" in text or f"|{n}" in text or f"({n})" in text]
    assert not still, (
        f"ci.yml still excludes {still} from the guard suite, but sim_mcp_shim makes them "
        f"importable without fastmcp. Remove them from the grep -vE pattern.")
