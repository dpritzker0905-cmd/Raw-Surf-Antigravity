"""The sim MCP server must ANSWER — the deadlock these tests pin made every tool unreachable.

2026-07-27: `get_surf_spots` returned nothing for 480 s against the live stdio server (the MCP
client aborts at 1800 s) while the identical call in-process took 0.02 s. faulthandler dumps of the
hung server, byte-identical at 25/50/75 s, put the AnyIO worker thread inside `create_module`
loading numpy's `_multiarray_umath` C extension — reached from `bathymetry.shelf_depth_at`, where
`import numpy` is a FUNCTION-level import. The first tool call therefore performed a C-extension
DLL load inside a worker thread under the running event loop, and never returned.

Every unit test in `test_weather_sim_mcp.py` passed throughout, because they call the tool functions
directly on the main thread. Only driving the server over stdio reproduces it, so these do that.
"""
import json
import os
import subprocess
import sys
import threading
import time

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(BACKEND_DIR, "weather_sim_mcp.py")

# A healthy first call answers in ~0.02 s after a ~2.4 s handshake; the defect is unbounded. This
# sits far above the noise and far below "hung".
FIRST_CALL_DEADLINE_S = 60.0

pytestmark = pytest.mark.skipif(
    not os.path.exists(SERVER), reason="weather_sim_mcp.py not present")


def _run_module_probe(code: str, env_extra=None):
    """Import the server module in a FRESH interpreter and report on it. Returns stdout, stripped."""
    env = dict(os.environ)
    env["PYTHONPATH"] = BACKEND_DIR + os.pathsep + env.get("PYTHONPATH", "")
    env.update(env_extra or {})
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                          cwd=BACKEND_DIR, env=env, timeout=180)
    assert proc.returncode == 0, f"probe failed: {proc.stderr[-2000:]}"
    return proc.stdout.strip().splitlines()[-1].strip()


def test_importing_the_server_resolves_the_hot_paths_lazy_imports():
    """THE INVARIANT: nothing on the tool hot path may be imported for the first time later.

    numpy is imported inside `shelf_depth_at`, so without the main-thread warm-up the first tool
    call is the thing that loads it — in an AnyIO worker thread, where it deadlocks.
    """
    got = _run_module_probe(
        "import sys; import weather_sim_mcp; print('numpy' in sys.modules)")
    assert got == "True", (
        "numpy is not imported after importing weather_sim_mcp — the hot path was not warmed on "
        "the main thread, so the first tool call will load it inside a worker thread and hang.")


def test_warmup_kill_switch_leaves_the_import_lazy():
    """SIM_EAGER_WARMUP=0 restores the old behaviour — which also proves the test above is not
    vacuously true (numpy is genuinely absent until the warm-up runs)."""
    got = _run_module_probe(
        "import sys; import weather_sim_mcp; print('numpy' in sys.modules)",
        env_extra={"SIM_EAGER_WARMUP": "0"})
    assert got == "False", (
        "numpy was imported even with the warm-up disabled — the kill switch no longer isolates "
        "the warm-up, so this suite can no longer tell warmed from unwarmed.")


class _StdioClient:
    """Minimal MCP stdio client: enough to handshake and call one tool with a deadline."""

    def __init__(self, proc):
        self.proc = proc
        self._lines = []
        self._cv = threading.Condition()
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self):
        for line in self.proc.stdout:
            with self._cv:
                self._lines.append(line.rstrip())
                self._cv.notify_all()

    def send(self, msg):
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def read(self, timeout):
        deadline = time.time() + timeout
        with self._cv:
            while not self._lines:
                remaining = deadline - time.time()
                if remaining <= 0:
                    return None
                self._cv.wait(remaining)
            return json.loads(self._lines.pop(0))


def test_first_tool_call_over_stdio_answers_promptly():
    """END TO END: spawn the real server and call a tool the way the MCP client does.

    This is the only shape that reproduces the deadlock — a plain `threading.Thread` and a bare
    `anyio.to_thread.run_sync` both complete the same call in 0.11 s.
    """
    proc = subprocess.Popen(
        [sys.executable, SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, cwd=BACKEND_DIR, text=True, encoding="utf-8", bufsize=1)
    try:
        client = _StdioClient(proc)
        client.send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                     "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                                "clientInfo": {"name": "pytest", "version": "0"}}})
        assert client.read(90) is not None, "server never completed the MCP handshake"
        client.send({"jsonrpc": "2.0", "method": "notifications/initialized"})

        t0 = time.time()
        client.send({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                     "params": {"name": "get_surf_spots",
                                "arguments": {"query": "Mavericks", "limit": 3}}})
        reply = client.read(FIRST_CALL_DEADLINE_S)
        elapsed = time.time() - t0

        assert reply is not None, (
            f"the FIRST tool call did not answer within {FIRST_CALL_DEADLINE_S:.0f}s. This is the "
            "2026-07-27 deadlock: a lazy C-extension import running inside an AnyIO worker thread.")
        assert reply.get("id") == 2, (
            f"got a response for id={reply.get('id')} instead of the request just sent — responses "
            "are arriving late, which is the deadlock's signature (a later request unblocks it).")
        assert "error" not in reply, reply
        assert elapsed < FIRST_CALL_DEADLINE_S
    finally:
        proc.kill()
