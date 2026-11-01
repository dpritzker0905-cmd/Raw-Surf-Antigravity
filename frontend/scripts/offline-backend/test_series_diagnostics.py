"""Standard-library ASGI contracts; no backend imports, sockets or weather execution."""
import asyncio
import io
import json
import logging
import unittest

from series_diagnostics import HEADER, SeriesDiagnostics

LOGGER = logging.getLogger("services.weather_pipeline.grid_series_helper")


def scope(query=b"model=GFS&domain=marine&layer=waves&hours=0,3,6", request_id=b"client-one-123"):
    return {"type": "http", "method": "GET", "path": "/api/weather/grid_series",
            "query_string": query, "headers": [(HEADER, request_id)]}


async def run(app, request=None):
    sent = []
    async def receive():
        return {"type": "http.disconnect"}
    async def send(message):
        sent.append(message)
    await app(request or scope(), receive, send)
    return sent


def responder(body, warning=True, status=200):
    async def app(_scope, receive, send):
        if warning:
            LOGGER.warning("[grid_series] hour +39h timed out after 10.0s")
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"), (b"x-existing", b"keep")]})
        await send({"type": "http.response.body", "body": body[:7], "more_body": True})
        await send({"type": "http.response.body", "body": body[7:]})
    return app


class CorrelationTests(unittest.IsolatedAsyncioTestCase):
    def wrap(self, app, **kwargs):
        events = []
        wrapper = SeriesDiagnostics(app, emit=events.append, **kwargs)
        self.addCleanup(wrapper.close)
        return wrapper, events

    async def test_timeout_id_census_and_original_warning_are_preserved(self):
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        LOGGER.addHandler(handler)
        self.addCleanup(LOGGER.removeHandler, handler)
        body = b'{"frame_count":2,"frames":[{"hour_offset":0},{"hour_offset":3}]}'
        wrapped, events = self.wrap(responder(body))
        sent = await run(wrapped)
        self.assertEqual(b"".join(m.get("body", b"") for m in sent), body)
        self.assertEqual(sent[0]["status"], 200)
        self.assertIn((b"x-existing", b"keep"), sent[0]["headers"])
        self.assertIn((HEADER, b"client-one-123"), sent[0]["headers"])
        self.assertEqual([e["event"] for e in events], ["request_start", "frame_timeout", "request_end"])
        self.assertEqual({e["request_id"] for e in events}, {"client-one-123"})
        timeout = events[1]
        self.assertEqual(timeout["hour_offset"], 39)
        self.assertEqual(timeout["printed_budget_seconds"], 10.0)
        self.assertIsNone(timeout["effective_budget_seconds"])
        self.assertEqual(timeout["timer_origin"], "unobserved")
        self.assertIn("hour +39h timed out after 10.0s", stream.getvalue())
        self.assertEqual(events[-1]["frame_census"]["missing_hours"], [6])
        self.assertEqual(events[-1]["frame_census"]["returned_hours"], [0, 3])
        self.assertEqual(events[-1]["frame_census"]["coverage"], "complete")
        self.assertEqual(events[-1]["timeout_warnings"], 1)
        self.assertTrue(all("at" in e and "monotonic_ns" in e for e in events))

    async def test_original_last_resort_warning_is_not_suppressed(self):
        stream = io.StringIO()
        root = logging.getLogger()
        saved_root = root.handlers[:]
        saved_handlers = LOGGER.handlers[:]
        saved_resort = logging.lastResort
        try:
            root.handlers = []
            LOGGER.handlers = []
            logging.lastResort = logging.StreamHandler(stream)
            wrapped, events = self.wrap(responder(b'{"frames":[]}'))
            await run(wrapped)
            self.assertIn("hour +39h timed out after 10.0s", stream.getvalue())
            self.assertEqual(sum(e["event"] == "frame_timeout" for e in events), 1)
        finally:
            root.handlers = saved_root
            LOGGER.handlers = saved_handlers
            logging.lastResort = saved_resort

    async def test_concurrent_requests_do_not_mix_warning_context(self):
        entered = asyncio.Event()
        async def app(request, receive, send):
            if request["query_string"].startswith(b"model=EURO"):
                entered.set()
                await asyncio.sleep(0)
            else:
                await entered.wait()
            LOGGER.warning("[grid_series] hour +42h timed out after 10.0s")
            await responder(b'{"frames":[]}', warning=False)(request, receive, send)
        wrapped, events = self.wrap(app)
        await asyncio.gather(run(wrapped, scope(b"model=EURO&hours=42", b"euro-request-123")),
                             run(wrapped, scope(b"model=ICON&hours=42", b"icon-request-123")))
        warnings = [e for e in events if e["event"] == "frame_timeout"]
        self.assertEqual({(e["request_id"], e["request"]["model"]) for e in warnings},
                         {("euro-request-123", "EURO"), ("icon-request-123", "ICON")})

    async def test_unobserved_and_other_path_warnings_are_not_falsely_bound(self):
        wrapped, events = self.wrap(responder(b"{}"))
        LOGGER.warning("[grid_series] hour +39h timed out after 10.0s")
        other = scope()
        other["path"] = "/api/weather/grid"
        sent = await run(wrapped, other)
        self.assertEqual(events, [])
        self.assertNotIn(HEADER, dict(sent[0]["headers"]))

    async def test_secrets_and_invalid_identifiers_are_not_logged(self):
        wrapped, events = self.wrap(responder(b'{"frames":[]}'))
        request = scope(b"model=private-value&hours=bad&token=private-token&bbox=bad", b"bad\r\nvalue")
        request["headers"].append((b"authorization", b"private-auth"))
        await run(wrapped, request)
        text = json.dumps(events)
        for private in ("private-value", "private-token", "private-auth", "bad\\r"):
            self.assertNotIn(private, text)
        self.assertNotEqual(events[0]["request_id"], "bad\r\nvalue")
        self.assertEqual(events[-1]["frame_census"]["coverage"], "request_hours_unknown")

    async def test_over_cap_and_malformed_bodies_have_explicit_unknown_census(self):
        for body, limit, expected in [(b'{"frames":[]}', 4, "body_limit"),
                                      (b"not json", 100, "invalid_json")]:
            wrapped, events = self.wrap(responder(body, warning=False), max_body_bytes=limit)
            sent = await run(wrapped)
            self.assertEqual(b"".join(m.get("body", b"") for m in sent), body)
            self.assertEqual(events[-1]["frame_census"]["coverage"], expected)

    async def test_disconnect_observation_does_not_add_receive_calls(self):
        calls = []
        async def app(request, receive, send):
            calls.append(await receive())
            await responder(b'{"frames":[]}', warning=False)(request, receive, send)
        wrapped, events = self.wrap(app)
        await run(wrapped)
        self.assertEqual(calls, [{"type": "http.disconnect"}])
        self.assertTrue(events[-1]["disconnect_observed"])

    async def test_original_exception_and_cancellation_survive_logging(self):
        for error in (ValueError("do not log private message"), asyncio.CancelledError()):
            async def app(request, receive, send):
                raise error
            wrapped, events = self.wrap(app)
            with self.assertRaises(type(error)) as caught:
                await run(wrapped)
            self.assertIs(caught.exception, error)
            self.assertNotIn("private message", json.dumps(events))
            self.assertEqual(events[-1]["outcome"], "cancelled" if isinstance(error, asyncio.CancelledError) else "error")
        broken = SeriesDiagnostics(responder(b"{}"), emit=lambda _e: (_ for _ in ()).throw(OSError("sink failed")))
        self.addCleanup(broken.close)
        self.assertEqual((await run(broken))[0]["status"], 200)

    async def test_late_warning_is_marked_after_request_end(self):
        release = asyncio.Event()
        tasks = []
        async def child():
            await release.wait()
            LOGGER.warning("[grid_series] hour +33h timed out after 10.0s")
        async def app(request, receive, send):
            tasks.append(asyncio.create_task(child()))
            await responder(b'{"frames":[]}', warning=False)(request, receive, send)
        wrapped, events = self.wrap(app)
        await run(wrapped)
        release.set()
        await tasks[0]
        self.assertEqual(events[-1]["event"], "frame_timeout")
        self.assertTrue(events[-1]["after_request_end"])

    async def test_unknown_frame_hours_do_not_invent_a_missing_hour_list(self):
        body = b'{"frames":[{"hour_offset":"unknown"}]}'
        wrapped, events = self.wrap(responder(body, warning=False))
        sent = await run(wrapped)
        self.assertEqual(b"".join(m.get("body", b"") for m in sent), body)
        self.assertEqual(events[-1]["frame_census"]["coverage"], "frame_hours_unknown")
        self.assertIsNone(events[-1]["frame_census"]["missing_hours"])

    async def test_deep_invalid_json_does_not_replace_response(self):
        body = b"[" * 2000 + b"not-json" + b"]" * 2000
        wrapped, events = self.wrap(responder(body, warning=False))
        sent = await run(wrapped)
        self.assertEqual(b"".join(m.get("body", b"") for m in sent), body)
        self.assertEqual(events[-1]["frame_census"]["coverage"], "invalid_json")

    async def test_encoded_response_is_forwarded_without_guessing_frame_coverage(self):
        async def app(request, receive, send):
            await send({"type": "http.response.start", "status": 200,
                        "headers": [(b"content-type", b"application/json"), (b"content-encoding", b"gzip")]})
            await send({"type": "http.response.body", "body": b"opaque compressed bytes"})
        wrapped, events = self.wrap(app)
        sent = await run(wrapped)
        self.assertEqual(sent[-1]["body"], b"opaque compressed bytes")
        self.assertEqual(events[-1]["frame_census"]["coverage"], "encoded")


if __name__ == "__main__":
    unittest.main()
