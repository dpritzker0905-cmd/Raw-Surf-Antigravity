"""ENS member set (amendment 5, log 2026-11-15-wind-long-range.md 18:17Z): the open-data `ef` files lost the control
member on 2026-05-13 00Z. pf 1..50 are required; cf is included first only when the run's index carries it."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from services.weather_pipeline import ens_wind_fetch as ef

RUN = datetime(2026, 9, 13, tzinfo=timezone.utc)


def _index(with_cf=True, drop=None):
    lines, off = [], 0
    for p in ("10u", "10v", "10fg"):
        members = ([0] if with_cf else []) + list(range(1, 51))
        for m in members:
            if drop == (p, m):
                continue
            e = {"type": "cf" if m == 0 else "pf", "param": p, "step": "180", "levtype": "sfc", "_offset": off, "_length": 10}
            if m:
                e["number"] = str(m)
            lines.append(json.dumps(e))
            off += 10
    return "\n".join(lines)


def _session(index_text):
    def get(url, headers=None, timeout=None):
        if url.endswith(".index"):
            return SimpleNamespace(status_code=200, text=index_text)
        return SimpleNamespace(status_code=206, content=b"\0" * 10_000_000)
    return SimpleNamespace(get=get)


def _fake_decode(buf, span_keys, wanted, prefer="auto"):
    # value of each message = its member number, so the stacking order is visible
    return {k: (np.full((2, 2), float(k.split("#")[1])), {"ni": 2, "nj": 2}) for k in span_keys}


@pytest.mark.parametrize("with_cf,n", [(True, 51), (False, 50)])
def test_member_set_follows_the_index(with_cf, n):
    with patch.object(ef.g2, "decode_span", side_effect=_fake_decode):
        f, meta = ef.fetch_step(_session(_index(with_cf)), RUN, 180, lambda a, m: a[0, 0])
    assert meta["has_cf"] is with_cf and meta["n_members"] == n
    assert f["10u"].shape == (n,)
    assert f["10u"][0] == (0.0 if with_cf else 1.0)      # the control comes first only when present
    assert f["10fg"][-1] == 50.0


def test_a_missing_perturbed_member_drops_the_run():
    with patch.object(ef.g2, "decode_span", side_effect=_fake_decode), pytest.raises(ValueError):
        ef.fetch_step(_session(_index(False, drop=("10v", 17))), RUN, 180, lambda a, m: a[0, 0])


def test_a_control_on_only_some_params_is_left_out():
    text = "\n".join(ln for ln in _index(True).splitlines()
                     if not ('"cf"' in ln and '"10fg"' in ln))
    with patch.object(ef.g2, "decode_span", side_effect=_fake_decode):
        f, meta = ef.fetch_step(_session(text), RUN, 180, lambda a, m: a[0, 0])
    assert meta["has_cf"] is False and f["10u"].shape == (50,)
