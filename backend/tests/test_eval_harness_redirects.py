"""Evaluation harness v0.1: the network guard applies to EVERY redirect hop, before that hop is contacted.

Finding (Codex bounded review at head 6c570ade): http_get checked only the first URL and then used the default
urlopen, whose HTTPRedirectHandler follows Location with no allowlist check. These tests drive the REAL private opener
and the REAL GuardedRedirectHandler through offline stub transports (no socket is opened): a stub answers 30x for a
scripted URL, and every URL any stub was asked for is recorded, so "refused before contact" is the assertion that the
denied target's URL never reached a stub."""
import email.message
import io
import urllib.request
import urllib.response

import pytest

from services.weather_pipeline import eval_provenance as pv

A = "https://www.ndbc.noaa.gov/data/realtime2/46025.txt"
B = "https://thredds.cdip.ucsd.edu/thredds/dodsC/x.ascii"
C = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/y.grib2"
D = "https://marine-api.open-meteo.com/v1/marine"
APP = "https://raw-surf.onrender.com/api/weather/point"
UNKNOWN = "https://example.com/data"
PLAIN = "http://www.ndbc.noaa.gov/data/realtime2/46025.txt"


class Script:
    """url -> ("redirect", code, location) | ("body", status, bytes). Records every request any stub received."""

    def __init__(self, routes):
        self.routes, self.contacted, self.headers = routes, [], {}

    def answer(self, req):
        url = req.full_url
        self.contacted.append(url)
        self.headers[url] = dict(req.header_items())
        kind, code, x = self.routes[url]
        h = email.message.Message()
        if kind == "redirect":
            h["Location"] = x
            body = b""
        else:
            body = x
            h["ETag"] = '"e1"'
        resp = urllib.response.addinfourl(io.BytesIO(body), h, url, code)
        resp.msg = "stub"
        return resp


def _handlers(script):
    class StubHTTPS(urllib.request.HTTPSHandler):
        handler_order = 100

        def https_open(self, req):
            return script.answer(req)

    class StubHTTP(urllib.request.HTTPHandler):
        handler_order = 100

        def http_open(self, req):
            return script.answer(req)

    return (StubHTTPS(), StubHTTP())


def _get(script, url=A, rng=None):
    return pv.http_get(url, rng=rng, extra_handlers=_handlers(script))


def test_allowed_to_allowed_is_followed_with_the_range_kept_and_recorded(tmp_path):
    s = Script({A: ("redirect", 302, B), B: ("body", 206, b"abcd")})
    body, status, hdr, route = _get(s, rng=(0, 3))
    assert (body, status) == (b"abcd", 206) and s.contacted == [A, B]
    assert route == {"final_url": B, "redirects": [{"code": 302, "url": B}]}
    assert s.headers[B].get("Range") == "bytes=0-3"
    c = pv.Cache(str(tmp_path / "c"), get=lambda u, rng=None, max_bytes=None: _get(s, u, rng), pause_s=0)
    s.contacted.clear()
    _, rec = c.fetch("k", A, (0, 3), source="s", parser="p")
    assert rec["url"] == A and rec["final_url"] == B and rec["redirects"] == [{"code": 302, "url": B}]
    m = pv.manifest(c.records, "x")
    assert m["files"][0]["final_url"] == B and m["files"][0]["redirects"][0]["url"] == B


def test_a_direct_answer_records_no_redirects():
    s = Script({A: ("body", 200, b"ok")})
    _, _, hdr, route = _get(s)
    assert route == {"final_url": A, "redirects": []} and hdr == {"ETag": '"e1"'}


@pytest.mark.parametrize("target", [APP, UNKNOWN, PLAIN, "https://abc.supabase.co/storage/v1/x",
                                    "/relative/but/fine/elsewhere"])
def test_a_redirect_to_a_refused_target_is_refused_before_contact(target):
    routes = {A: ("redirect", 301, target)}
    s = Script(routes)
    if target.startswith("/"):     # relative Location resolves against the allowed host: permitted, then answered
        routes["https://www.ndbc.noaa.gov/relative/but/fine/elsewhere"] = ("body", 200, b"x")
        _, _, _, route = _get(s)
        assert route["final_url"] == "https://www.ndbc.noaa.gov/relative/but/fine/elsewhere"
        return
    with pytest.raises(pv.NetworkRefused):
        _get(s)
    assert s.contacted == [A], "the refused hop must never be contacted"


def test_a_chain_that_ends_at_a_denied_host_is_refused():
    s = Script({A: ("redirect", 302, B), B: ("redirect", 307, C), C: ("redirect", 308, APP)})
    with pytest.raises(pv.NetworkRefused, match="app's own host"):
        _get(s)
    assert s.contacted == [A, B, C] and APP not in s.contacted


def test_more_than_three_hops_is_refused():
    s = Script({A: ("redirect", 302, B), B: ("redirect", 302, C), C: ("redirect", 302, D),
                D: ("redirect", 302, A + "?again")})
    with pytest.raises(pv.NetworkRefused, match="more than 3 redirects"):
        _get(s)
    assert s.contacted == [A, B, C, D]


def test_three_hops_is_allowed():
    s = Script({A: ("redirect", 302, B), B: ("redirect", 302, C), C: ("redirect", 302, D), D: ("body", 200, b"z")})
    _, _, _, route = _get(s)
    assert [h["url"] for h in route["redirects"]] == [B, C, D] and route["final_url"] == D


def test_the_guard_is_never_installed_globally():
    before = urllib.request._opener
    _get(Script({A: ("body", 200, b"ok")}))
    assert urllib.request._opener is before
