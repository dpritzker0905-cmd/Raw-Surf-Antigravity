"""Local loopback contracts; no product backend, provider, browser or weather data."""
import asyncio
import errno
import json
from pathlib import Path
import socket
import struct
import unittest

import uvicorn
from uvicorn.server import ServerState
from uvicorn.protocols.http.h11_impl import H11Protocol
from uvicorn.protocols.http.httptools_impl import HttpToolsProtocol

from connection_diagnostics import diagnostic_protocol


async def app(scope, receive, send):
    body = b"synthetic response"
    status = 503 if scope["path"] == "/fail" else 200
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


async def response(reader):
    head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
    length = next(int(line.split(b":")[1]) for line in head.split(b"\r\n")
                  if line.lower().startswith(b"content-length:"))
    return head.split(b"\r\n")[0], await reader.readexactly(length)


class NetworkContracts:
    base = None

    async def asyncSetUp(self):
        self.rows = []
        self.protocols = []
        await self.start(self.rows.append)

    async def start(self, emit, application=app):
        config = uvicorn.Config(application, lifespan="off", log_level="critical", access_log=False,
                                timeout_keep_alive=0.05)
        config.load()
        self.state = ServerState()
        observed = diagnostic_protocol(self.base, emit)

        def factory():
            protocol = observed(config, self.state, {})
            self.protocols.append(protocol)
            return protocol

        self.server = await asyncio.get_running_loop().create_server(factory, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def connect(self):
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        self.writers.append(writer)
        return reader, writer

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        for writer in self.writers:
            writer.close()
        for writer in self.writers:
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass
        for protocol in list(self.state.connections):
            protocol.shutdown()
        await asyncio.sleep(0.03)
        if self.state.tasks:
            await asyncio.gather(*self.state.tasks, return_exceptions=True)

    async def test_reuse_binds_two_ids_and_preserves_http_failure(self):
        self.writers = []
        reader, writer = await self.connect()
        for path, rid, status in [("/", "request_normal_01", b"200"), ("/fail", "request_failure_02", b"503")]:
            writer.write(f"GET {path}?private=DO_NOT_RETAIN HTTP/1.1\r\nHost: local\r\nAuthorization: DO_NOT_RETAIN\r\nX-Rawsurf-Synthetic-Request-Id: {rid}\r\n\r\n".encode())
            await writer.drain()
            line, body = await response(reader)
            self.assertIn(status, line)
            self.assertEqual(body, b"synthetic response")
        await asyncio.sleep(0.10)  # Deliberately let the native keepalive timer expire.
        self.assertEqual(await asyncio.wait_for(reader.read(), 2), b"")
        requests = [r for r in self.rows if r["event"] == "request"]
        self.assertEqual([r["request_id"] for r in requests], ["request_normal_01", "request_failure_02"])
        self.assertEqual([r["request_sequence"] for r in requests], [1, 2])
        self.assertEqual(len({r["connection_id"] for r in self.rows}), 1)
        self.assertTrue(any(r["event"] == "keepalive_callback" for r in self.rows))
        lost = next(r for r in self.rows if r["event"] == "lost")
        self.assertEqual(lost["requests_observed"], 2)
        self.assertGreater(lost["received_bytes"], 0)
        self.assertNotIn("DO_NOT_RETAIN", json.dumps(self.rows))
        self.assertNotIn("synthetic response", json.dumps(self.rows))

    async def test_connection_before_any_asgi_request_and_partial_abort(self):
        self.writers = []
        reader, writer = await self.connect()
        writer.write(b"GET /private HTTP/1.1\r\nX-Private: DO_NOT_RETAIN")
        await writer.drain()
        await asyncio.sleep(0.02)
        # An abort is an observed local control, not an assertion about wire-level RST.
        writer.transport.abort()
        await asyncio.sleep(0.04)
        self.assertTrue(any(r["event"] == "open" for r in self.rows))
        lost = next(r for r in self.rows if r["event"] == "lost")
        self.assertEqual(lost["requests_observed"], 0)
        self.assertGreater(lost["received_bytes"], 0)
        self.assertNotIn("DO_NOT_RETAIN", json.dumps(self.rows))

    async def test_duplicate_invalid_missing_ids_are_not_retained(self):
        self.writers = []
        reader, writer = await self.connect()
        for headers in [b"", b"X-Rawsurf-Synthetic-Request-Id: invalid!DO_NOT_RETAIN\r\n",
                        b"X-Rawsurf-Synthetic-Request-Id: duplicate_01\r\nX-Rawsurf-Synthetic-Request-Id: duplicate_02\r\n"]:
            writer.write(b"GET / HTTP/1.1\r\nHost: local\r\n" + headers + b"\r\n")
            await writer.drain()
            self.assertIn(b"200", (await response(reader))[0])
        requests = [r for r in self.rows if r["event"] == "request"]
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(r["request_id"] is None and not r["correlation_valid"] for r in requests))
        self.assertNotIn("DO_NOT_RETAIN", json.dumps(self.rows))
        self.assertNotIn("duplicate_01", json.dumps(self.rows))

    async def test_sink_failure_cannot_replace_response_or_shutdown(self):
        self.writers = []
        self.server.close()
        await self.server.wait_closed()

        def broken_sink(row):
            raise RuntimeError("DO_NOT_RETAIN")

        await self.start(broken_sink)
        reader, writer = await self.connect()
        writer.write(b"GET /fail HTTP/1.1\r\nHost: local\r\n\r\n")
        await writer.drain()
        self.assertIn(b"503", (await response(reader))[0])
        next(iter(self.state.connections)).shutdown()
        self.assertEqual(await asyncio.wait_for(reader.read(), 2), b"")

    async def test_explicit_eof_and_server_shutdown_remain_native(self):
        self.writers = []
        reader, writer = await self.connect()
        writer.write_eof()
        await asyncio.sleep(0.03)
        self.assertTrue(any(r["event"] == "eof" for r in self.rows))
        reader, writer = await self.connect()
        protocol = next(iter(self.state.connections))
        protocol.shutdown()
        self.assertEqual(await asyncio.wait_for(reader.read(), 2), b"")
        self.assertTrue(any(r["event"] == "shutdown_called" for r in self.rows))



    async def test_forced_client_reset_before_headers_is_observed(self):
        self.writers = []
        # Close a raw socket: asyncio transport.abort() may first send a FIN.
        # SO_LINGER(1,0) requests a local abortive close, not a hosted-cause finding.
        import sys
        layout = "hh" if sys.platform == "win32" else "ii"
        peer = socket.socket()
        try:
            await asyncio.to_thread(peer.connect, ("127.0.0.1", self.port))
            await asyncio.sleep(0.01)
            peer.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack(layout, 1, 0))
        finally:
            peer.close()
        await asyncio.sleep(0.05)
        lost = next(r for r in self.rows if r["event"] == "lost")
        self.assertEqual(lost["requests_observed"], 0)
        self.assertEqual(lost["error_kind"], "connection_reset")

    async def test_composes_with_actual_asgi_request_correlation(self):
        self.writers = []
        self.server.close()
        await self.server.wait_closed()
        from series_diagnostics import SeriesDiagnostics
        series = []
        observed = SeriesDiagnostics(app, emit=series.append)
        try:
            await self.start(self.rows.append, observed)
            reader, writer = await self.connect()
            writer.write(b"GET /api/weather/grid_series HTTP/1.1\r\nHost: local\r\nX-Rawsurf-Synthetic-Request-Id: composed_request_01\r\n\r\n")
            await writer.drain()
            self.assertIn(b"200", (await response(reader))[0])
            transport = next(r for r in self.rows if r["event"] == "request")
            self.assertEqual(transport["request_id"], "composed_request_01")
            self.assertEqual([r["event"] for r in series], ["request_start", "request_end"])
            self.assertTrue(all(r["request_id"] == transport["request_id"] for r in series))
            self.assertLessEqual(transport["monotonic_ns"], series[0]["monotonic_ns"])
        finally:
            observed.close()


class H11Contracts(NetworkContracts, unittest.IsolatedAsyncioTestCase):
    base = H11Protocol


class HttpToolsContracts(NetworkContracts, unittest.IsolatedAsyncioTestCase):
    base = HttpToolsProtocol


class SeamContracts(unittest.TestCase):
    def test_default_keeps_auto_protocol_selection(self):
        from uvicorn.protocols.http.auto import AutoHTTPProtocol
        self.assertTrue(issubclass(diagnostic_protocol(), AutoHTTPProtocol))

    def test_callback_errno_is_sanitized_and_native_callback_runs(self):
        calls, rows = [], []

        class Native:
            def __init__(self):
                self.app = app

            def connection_lost(self, exc):
                calls.append(exc)
                return "native-result"

        observed = diagnostic_protocol(Native, rows.append)()
        error = ConnectionResetError(errno.ECONNRESET, "DO_NOT_RETAIN")
        self.assertEqual(observed.connection_lost(error), "native-result")
        self.assertIs(calls[0], error)
        self.assertEqual(rows[0]["error_kind"], "connection_reset")
        self.assertNotIn("DO_NOT_RETAIN", json.dumps(rows))
        observed.connection_lost(ConnectionResetError(22, "DO_NOT_RETAIN"))
        self.assertEqual(rows[-1]["error_kind"], "connection_reset")
        observed.connection_lost(RuntimeError("DO_NOT_RETAIN"))
        self.assertEqual(rows[-1]["error_kind"], "other_error")

    def test_startup_gate_leaves_default_options_empty(self):
        # Execute only the actual startup selection statements, never the weather runner.
        import ast
        tree = ast.parse(Path(__file__).with_name("serve_synthetic.py").read_text(encoding="utf-8-sig"))
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
        selection = []
        selecting = False
        for node in main.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "observed_app" for t in node.targets):
                selecting = True
            if selecting:
                if isinstance(node, ast.Try):
                    break
                selection.append(node)
        from types import SimpleNamespace
        for enabled in (False, True):
            # #797 put `observed_app = install_bounce_lab(app)` first in this slice; its import sits just before the
            # slice, so give the slice an identity stub (the lab is idle until armed; this test is about the gate).
            env = {"app": app, "args": SimpleNamespace(series_diagnostics=enabled), "install_bounce_lab": lambda a: a}
            exec(compile(ast.Module(body=selection, type_ignores=[]), "<startup-selection>", "exec"), env)
            if enabled:
                self.assertTrue(issubclass(env["protocol_options"]["http"], diagnostic_protocol().__bases__[0]))
                env["observed_app"].close()
            else:
                self.assertIs(env["observed_app"], app)
                self.assertEqual(env["protocol_options"], {})


if __name__ == "__main__":
    unittest.main()
