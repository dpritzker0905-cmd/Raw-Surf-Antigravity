"""The owner's rule (David, 2026-11-16 22:23 EST): what merges ships ON, with an automated test of its kill switch.

Five raster frame sets merged dark behind a repo variable that was never set, each after its gate passed:
water_temp and temperature_icon (#888, parity within the codec tolerance), cloud_cover_euro (#955), precipitation_icon_0p125
(#956) and temperature_icon_0p125 (#957). They now ship ON: unset = on, in code (SPECS default_on) and in both workflows.
'0' is the kill switch. A killed set publishes nothing, which was every run's output before the flip (no step, no frames).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_raster_frames as script  # noqa: E402
import raster_set_freshness as rsf  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402

SHIPPED_ON = {
    "water_temp": "FRAME_RASTER_WATER_TEMP",
    "temperature_icon": "FRAME_RASTER_TEMPERATURE_ICON",
    "cloud_cover_euro": "FRAME_RASTER_CLOUD_EURO",
    "precipitation_icon_0p125": "FRAME_RASTER_PRECIP_ICON_0P125",
    "temperature_icon_0p125": "FRAME_RASTER_TEMPERATURE_ICON_0P125",
}
WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"


def _step(name):
    yml = (WORKFLOWS / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if f"--set {name}\n" in s + "\n"]
    assert len(steps) == 1, name
    return steps[0]


@pytest.mark.parametrize("name", sorted(SHIPPED_ON))
def test_unset_is_on_and_0_kills_it(name, monkeypatch, capsys):
    env = SHIPPED_ON[name]
    assert fsr.SPECS[name]["env"] == env and fsr.SPECS[name]["default_on"] is True
    monkeypatch.delenv(env, raising=False)
    assert fsr.enabled(name)
    monkeypatch.setenv(env, "")                   # how a workflow passes an UNSET variable: still on
    assert fsr.enabled(name)
    monkeypatch.setenv(env, "0")
    assert not fsr.enabled(name)
    # Killed, the publisher uploads nothing and says so: the output of every run before the flip.
    assert script.main(["--set", name, "--out-dir", "unused"]) == 0 and "skipped" in capsys.readouterr().out


@pytest.mark.parametrize("name", sorted(SHIPPED_ON))
def test_the_pilots_step_runs_unless_its_variable_is_0(name):
    env, step = SHIPPED_ON[name], _step(name)
    # `(vars.X || '1') != '0'`, never `vars.X != '0'` (an unset variable compares as 0 there) nor `vars.X == '1'` (the dark form).
    assert f"vars.FRAME_IMAGES_PUBLISH == '1' && (vars.{env} || '1') != '0' }}}}" in step
    assert f"vars.{env} == '1'" not in step
    assert f"{env}: ${{{{ vars.{env} || '1' }}}}" in step
    assert f"ON, kill {env}=0)" in step.splitlines()[0]


@pytest.mark.parametrize("name", sorted(SHIPPED_ON))
def test_the_freshness_monitor_expects_each_set_while_unset_and_drops_it_at_0(name, monkeypatch, capsys):
    # The monitor passes every raster switch bare (test_raster_set_freshness pins that form): an unset variable arrives as "",
    # which raster_set_freshness.main drops, so a default-on set is EXPECTED; '0' takes it off the list. Through main, end to end.
    env = SHIPPED_ON[name]
    mon = (WORKFLOWS / "data-health-monitor.yml").read_text(encoding="utf-8")
    assert f"{env}: ${{{{ vars.{env} }}}}" in mon
    monkeypatch.setattr(rsf.urllib.request, "urlopen", lambda url, timeout: _Empty())
    for sp in fsr.SPECS.values():
        monkeypatch.delenv(sp["env"], raising=False)
    monkeypatch.setenv(env, "")
    assert rsf.main(["--base", "https://cdn.test/weather-frames"]) == 0
    assert f"Raster set {name} not published yet" in capsys.readouterr().out
    monkeypatch.setenv(env, "0")
    assert rsf.main(["--base", "https://cdn.test/weather-frames"]) == 0
    assert f"Raster set {name} not published yet" not in capsys.readouterr().out


class _Empty:
    def read(self):
        return b'{"sets": {}}'

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False
