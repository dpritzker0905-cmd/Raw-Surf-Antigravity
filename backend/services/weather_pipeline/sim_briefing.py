"""sim_briefing.py — the sim's PROSE surfaces: the conditions summary resource and the advisor prompt.

Extracted from `weather_sim_mcp.py`, which sat at 792 of the 800-line ratchet with a new tool to
land. Nothing about the behaviour changed in the move; `weather_sim_mcp` keeps the `@mcp.resource`
and `@mcp.prompt` decorators (they are the transport binding) and delegates the body here.

★ WHY THESE TWO BELONG TOGETHER: both turn resolved state into ENGLISH for a model to read, and both
have the same failure mode — saying something confident about a spot the catalogue does not carry.
The summary once iterated the hand-tuned defaults directly and so described `Mavericks` at a
coordinate 637 m from production's; the prompt once fell back to `MOCK_SPOTS["Mavericks"]` whenever
a name was unknown, briefing the model about a Californian big-wave break without ever saying so.
Both now resolve through `sim_spots` like every other surface, and both say plainly when they
cannot.

⚠️ A SUMMARY LINE COSTS TWO HTTP REQUESTS (marine + wind). `SUMMARY_MAX` is a LATENCY bound, not a
display preference — the catalogue has 1,800+ spots and iterating it here would take hours.
"""
import logging
import os
from typing import Any, Callable, Dict, Optional

from services.weather_pipeline import sim_forecast, sim_spots
from services.weather_pipeline.sim_rating import calculate_surf_rating, shore_normal_for

logger = logging.getLogger("weather_sim_mcp")

# The reference spots the summary works through when nothing is staged. Resolved through the LIVE
# catalogue like any other name, so they report the app's coordinates rather than the hand-tuned ones.
SUMMARY_REFERENCE = ("Mavericks", "Montara State Beach", "Pacifica State Beach")

# Staged overrides are exempt from this budget: their vector is already in memory and costs no
# network at all.
from services.weather_pipeline.config_env import env_int
SUMMARY_MAX = env_int("SIM_SUMMARY_MAX", 3, lo=1)


def summary_line(label: str, spot: Dict[str, Any], baseline: Dict[str, float], source: str,
                 provenance: Optional[Dict[str, Any]] = None) -> str:
    # `provenance` carries the size curve the app graded this coordinate on (`5f19ac7d`). Optional
    # and defaulting to None so an existing 4-arg caller keeps working, but every in-repo caller
    # passes it: a briefing that quotes a different curve from the forecast tool is the same
    # two-compositions-one-answer split that made find_best_spot rank on the global curve.
    # ⚠️ A staged override has no provenance -> None -> the flag+blob path, which is right: an
    # invented sea was never served, so there is no served curve to mirror.
    calc = calculate_surf_rating(
        spot, baseline["swell_height_m"], baseline["swell_period_sec"],
        baseline["swell_direction_deg"], baseline["wind_speed_knots"],
        baseline["wind_direction_deg"], partitions=sim_forecast.baseline_partitions(baseline),
        allow_reference_lookup=True,
        served_reference_size_m=sim_forecast.served_reference(provenance))
    # `conditions_label` is the SIZE ladder — this line used to print it inside "Quality: …",
    # reporting e.g. "Quality: 56.4/100 (Triple Overhead+)" and mixing the two vocabularies the rest
    # of the module works to keep apart. Size and verdict are now named separately.
    # ⛔ AND NAME THE UPPER BOUND. This line quotes a HEIGHT, and when `directional_conflict` fires
    # the size and the quality disagree about how much swell energy reaches the break — the size
    # being the more generous of the two. `sim_window` (`d9e1ffd3`) and `sim_compare` both say so
    # now; this briefing was the third consumer and said nothing, so a reader skimming the daily
    # summary got the generous number with no marker at all.
    # ⚠️ ASCII only: this string is printed to consoles, and an emoji here crashed the sim_window
    # probe on cp1252.
    conflict = calc.get("directional_conflict") or {}
    ratio = conflict.get("energy_disagreement") if conflict else None
    bound = (f" | HEIGHT IS AN UPPER BOUND ({ratio}x size/quality exposure disagreement)"
             if ratio else " | HEIGHT IS AN UPPER BOUND (size/quality exposure disagree)") \
        if conflict else ""
    return (f" - {label}: Breaking at {calc['breaking_height_ft']} ft "
            f"({calc['conditions_label']}) | Quality: {calc['quality_rating']}/100 "
            f"({calc['quality_label']}) | Wind: {round(baseline['wind_speed_knots'], 1)} kts "
            f"{calc['wind_class']}{bound} | [{source}]")


def forecasts_summary(overrides: Dict[str, Dict[str, float]],
                      baseline_with_source: Callable[..., Any]) -> str:
    """A textual summary of staged simulations and a sample of live surf conditions.

    `overrides` and `baseline_with_source` are INJECTED rather than imported: they are the MCP
    server's own mutable state, and importing them here would make this module and that one
    circular."""
    live = sim_forecast.fetch_catalog()
    total = len(live) if live else None
    lines = ["=== DAILY OCEAN CONDITIONS AND FORECAST SUMMARY ===",
             f"Catalogue: {total if total is not None else 'unavailable'} active spots "
             f"({sim_spots.catalog_source()}). This is a SAMPLE — call "
             f"get_weather_forecast(spot_name) for any spot."]

    # 1. Everything staged. This is the sim's own state and the reason to read this resource at all;
    #    it is also free, so it is never truncated by the latency budget.
    staged = sorted(overrides)
    lines.append("")
    lines.append(f"STAGED SIMULATION OVERRIDES ({len(staged)}):"
                 if staged else "STAGED SIMULATION OVERRIDES: none")
    for name in staged:
        spot = sim_spots.resolve(name).spot or {"name": name}
        if spot.get("latitude") is None:
            continue
        lines.append(summary_line(name, spot, overrides[name], "simulated_override"))

    # 2. A bounded sample of real conditions, skipping anything already listed above.
    lines.append("")
    lines.append(f"REFERENCE SPOTS (up to {SUMMARY_MAX}):")
    shown = 0
    for name in SUMMARY_REFERENCE:
        if shown >= SUMMARY_MAX:
            break
        if name in overrides:
            continue
        found = sim_spots.resolve(name)
        if not found.spot:
            continue
        baseline, source, prov = baseline_with_source(found.spot)
        if baseline is None:
            continue
        label = found.spot["name"]
        if found.identity_source == "catalog_default":
            # Say it plainly: the app's catalogue does not carry this name, so the line describes a
            # hand-tuned coordinate rather than a production spot.
            label += " (not in the app catalogue)"
        lines.append(summary_line(label, found.spot, baseline, source, prov))
        shown += 1
    return "\n".join(lines)


def advisor_prompt(spot_name: str) -> str:
    """Prompt template that helps analyze surf and wind parameters to give strategic surf advice."""
    found = sim_spots.resolve(spot_name)
    if found.candidates:
        names = ", ".join(f"{c['name']} ({c['region']})" for c in found.candidates)
        return (f"The name '{spot_name}' matches several spots in the catalogue: {names}. Ask the "
                f"surfer which one they mean before advising — do not pick one.")
    if not found.spot:
        # Was `or MOCK_SPOTS["Mavericks"]`, which briefed the model about a Californian big-wave
        # break whenever the requested name was unknown, without ever saying so.
        return (f"No spot named '{spot_name}' is in the catalogue. Say so, and offer to search "
                f"with get_surf_spots(query=...) — do not advise about a different spot.")
    spot = found.spot
    normal = shore_normal_for(spot)
    # Both optimal directions are DERIVED from the one shore normal rather than stored separately.
    # The stored `optimal_wind_dir`/`optimal_swell_dir` fields disagreed with the bearing the engine
    # actually scores against (by 20 deg at Montara, 64.9 deg at Mavericks), so this prompt used to
    # brief the model on parameters the simulation was not using.
    if normal is None:
        return (f"You are a veteran surf forecaster advising a professional surfer about "
                f"'{spot['name']}'. No shore orientation could be resolved for this spot, so treat "
                f"swell-window and wind-direction reasoning as unconstrained and say so explicitly.")
    return f"""You are a veteran surf forecaster and oceanographer advising a professional surfer.

Here are the resolved parameters for the spot '{spot['name']}':
- Shore normal (seaward bearing): {round(normal, 1)}°
- Optimal swell direction: {round(normal, 1)}° (swell arriving head-on)
- Optimal wind direction: {round((normal - 180) % 360, 1)}° (offshore — blowing out to sea)

Analyze the current weather and swell forecast for this spot. Run a physical simulation calculating the wave break height and wind-swell vector alignment. Detail:
1. Expected breaking wave height (ft) and swell-to-beach vector alignment percentage.
2. The offshore/sideshore classification of the wind vector.
3. Your strategic recommendation: Should they surf this spot today, wait for tide changes, or head to another spot in the region? Explain your reasoning with physical principles of bathymetry and wave shoaling.
"""
