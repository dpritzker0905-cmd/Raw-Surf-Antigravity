"""Read-only pytest plugin: proves whether the two direct-point builders EXECUTE.

Wraps the names at the CALL SITE module (point_resolution) and at the defining module
(point_direct_fallbacks). Does not modify any file on disk.
"""
import functools

CALLS = {"wind": 0, "scalar": 0}
RESULTS = {"wind": [], "scalar": []}


def pytest_configure(config):
    from services.weather_pipeline import point_direct_fallbacks as pdf
    from services.weather_pipeline import point_resolution as pr

    def wrap(name, key):
        orig = getattr(pdf, name)

        @functools.wraps(orig)
        async def probe(*a, **kw):
            CALLS[key] += 1
            out = await orig(*a, **kw)
            RESULTS[key].append(
                None if out is None else (
                    getattr(out, "source", None),
                    getattr(getattr(out, "point", None), "speed", None),
                    getattr(getattr(out, "point", None), "direction", None),
                    getattr(getattr(out, "point", None), "u", None),
                    getattr(getattr(out, "point", None), "v", None),
                    getattr(getattr(out, "point", None), "value", None),
                    getattr(out, "resolution", "NO_ATTR"),
                )
            )
            return out

        setattr(pdf, name, probe)
        setattr(pr, name, probe)

    wrap("build_wind_direct_point_response", "wind")
    wrap("build_scalar_direct_point_response", "scalar")


def pytest_sessionfinish(session, exitstatus):
    print("\n=== DIRECT-POINT BUILDER EXECUTION PROBE ===")
    print("wind builder calls   :", CALLS["wind"])
    print("scalar builder calls :", CALLS["scalar"])
    for k in ("wind", "scalar"):
        for r in RESULTS[k]:
            print(f"  {k} -> (source, speed, dir, u, v, value, resolution) = {r}")
    print("=== END PROBE ===")
