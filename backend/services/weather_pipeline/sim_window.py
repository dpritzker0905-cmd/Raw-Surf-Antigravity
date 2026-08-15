"""sim_window.py — "when should I surf?", scanned across the forecast horizon.

The sim could answer "how is it at this hour" one hour at a time. The question a surfer actually
asks is WHICH hour, and answering it by hand meant one tool call per frame with the caller doing
the ranking. This walks the horizon through the SAME chain a single-hour answer uses
(`sim_rating.calculate_surf_rating` -> `surf_point.estimate_surf_at` + `surf_rating.rating_score`),
so a window's score is the number the app would show at that spot and hour — not a second opinion.

★ Only affordable because the forecast cache stopped holding a single hour (see `sim_forecast.
_remember`). Measured at Mavericks before that change, 16 frames cost 19.8 s cold and 6.2 s warm;
after, 6.7 s cold and 0.000 s warm.

⚠️ THE FRAME COUNT IS A LATENCY BUDGET, NOT A DISPLAY PREFERENCE. Every uncached frame is TWO HTTP
requests (marine + wind). An MCP client reports a TIMEOUT rather than an answer well before the
scan would finish if this were unbounded, and a timeout is indistinguishable from "the sim is
broken" — that is the `576dcbdd` regression. `MAX_FRAMES` bounds the worst case; the circuit
breaker in `sim_forecast` bounds the case where the app is down.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from services.weather_pipeline import sim_daylight
# `served_reference` only READS the provenance dict `baseline_at` already returns — it performs no
# I/O, so importing it here does not give this module the network dependency the injected
# `baseline_at` exists to keep out. (`sim_forecast` imports no sibling sim module: no cycle.)
from services.weather_pipeline import sim_forecast
from services.weather_pipeline.sim_rating import calculate_surf_rating

# 24 frames x 2 requests = 48 worst-case round trips. At the measured 0.42 s per frame warm-server
# cold-cache, that is ~10 s — inside a client budget, and the far tail is bounded by the breaker.
from services.weather_pipeline.config_env import env_int
MAX_FRAMES = env_int("SIM_WINDOW_MAX_FRAMES", 24, lo=1)
MAX_HOURS_AHEAD = env_int("SIM_WINDOW_MAX_HOURS", 168, lo=1)   # the app serves ~7 days


def plan_hours(hours_ahead: int, step_hours: int, now: Optional[datetime] = None) -> List[str]:
    """The top-of-hour UTC stamps to scan, bounded by MAX_FRAMES.

    Pure, so the bounding rule is testable without a clock or a network. The horizon is TRUNCATED
    rather than the step being silently widened: a caller who asked for 3-hourly resolution and
    quietly got 9-hourly would have no way to tell, whereas a short answer that reports its own
    range is self-describing."""
    step = max(1, int(step_hours))
    ahead = max(step, min(int(hours_ahead), MAX_HOURS_AHEAD))
    base = (now or datetime.now(timezone.utc)).replace(minute=0, second=0, microsecond=0)
    n = min(MAX_FRAMES, ahead // step + 1)
    return [(base + timedelta(hours=step * i)).strftime("%Y-%m-%dT%H:%M:%SZ") for i in range(n)]


def _rank_key(r: Dict[str, Any]):
    """⭐ RANK ON THE PHYSICS, PRESENT THE DISPLAY.

    `quality_raw` is the UNGATED score; `quality_rating` is what the app shows. Gating a rank key is
    what inverts a ranking (`79e1001a`) — and since the unconfirmed cap ties every good hour at
    69.9, reading the gated value here would make the best hours indistinguishable from each other.
    Falling back to `quality_rating` keeps a row that carries no raw score ordered exactly as before.

    Module-level rather than a closure so the contract is testable in isolation: the previous
    version was invisible to any guard, which is how it published the ungated score under the
    display name for as long as it did.
    """
    raw = r.get("quality_raw")
    return (not r.get("surfable_light", True),
            -float(raw if raw is not None else r["quality_rating"]),
            -r["breaking_height_ft"])


def scan(spot: Dict[str, Any], baseline_at: Callable[[Dict[str, Any], str], Any],
         hours: List[str], top: int = 5) -> Dict[str, Any]:
    """Rate `spot` at each hour and rank the results.

    `baseline_at(spot, hour)` returns `(baseline | None, source, provenance)` — injected rather than
    imported so this module has no MCP dependency and the scan is testable against a stub.

    Geometry resolves ONCE per coordinate and is reused across every frame (CLAUDE.md: the
    correction is arithmetic, not I/O) — `sim_rating.spot_geometry` caches on the coordinate, so
    scanning 24 hours costs one bathymetry resolution, not 24."""
    series: List[Dict[str, Any]] = []
    unresolved: List[str] = []
    sources = set()
    # The conflict PROSE is identical wherever it fires, so it is captured once and hoisted into
    # `note` rather than repeated on every frame. See the per-frame block below for why.
    conflict_means: Optional[str] = None
    for hour in hours:
        baseline, source, provenance = baseline_at(spot, hour)
        if baseline is None:
            unresolved.append(hour)
            continue
        sources.add(source)
        # The scan rates the BASELINE sea itself (no what-if), so the trains it carried — the ones
        # the server's own height ran on — always still describe it. Absent key -> None -> the
        # total-field path, byte-identical to before.
        # ⚠️ `allow_reference_lookup=True` AND DELIBERATELY NO `valid_time`. This scan has already
        # fetched a baseline for `hour`, so the I/O is paid and the local size reference must be
        # resolved — otherwise every row grades on the global 1.2 m curve while the map glyph for
        # the same spot-hour grades on the spot's own good day.
        # ⛔ Passing `valid_time` ALSO switches on the observation gate, which caps at 69.9 and
        # would flatten the very quality ranking this scan exists to produce — the "gating a RANK
        # key inverts its meaning" defect `79e1001a` fixed for sim_compare. Measured when this was
        # briefly wired that way: the winning hour moved 09:00 -> 06:00 (test_sim_daylight).
        # ⭐⭐ THAT REASONING WAS RIGHT ABOUT RANKING AND WRONG ABOUT PRESENTATION (2026-08-03,
        # external deep audit finding 2). Omitting `valid_time` protected the rank key by making the
        # published `quality_rating` the UNGATED score — the same field name the app-parity surfaces
        # use for the CAPPED one — so a window could announce `97.3 epic` for an hour the app shows
        # as `69.9 fair_good`. Ranking and presentation are different questions and the scan now
        # answers BOTH: gate for display, rank on `quality_raw`, exactly as `sim_compare` does.
        # ⚠️ The gate costs a `confirmation_for` lookup, which reads the precomputed ratings through
        # `load_spot_ratings_l2_cached` — a cached read, not per-hour I/O.
        # ★ PER HOUR, from THAT hour's provenance. The reference is a property of the place, so it
        # is stable across the scan in practice — but reading it per row means a frame the app could
        # not answer for cannot silently lend its curve to a neighbouring hour.
        calc = calculate_surf_rating(
            spot, baseline["swell_height_m"], baseline["swell_period_sec"],
            baseline["swell_direction_deg"], baseline["wind_speed_knots"],
            baseline["wind_direction_deg"], partitions=baseline.get("partitions"),
            valid_time=hour,
            allow_reference_lookup=True,
            served_reference_size_m=sim_forecast.served_reference(provenance))
        row = {
            "valid_time": hour,
            "breaking_height_ft": calc["breaking_height_ft"],
            "quality_rating": calc["quality_rating"],      # DISPLAY — what the app shows
            "quality_raw": calc.get("quality_raw"),        # RANKING — the physics, sorted on below
            "quality_confirmed": calc.get("quality_confirmed"),
            "quality_label": calc["quality_label"],
            "conditions_label": calc["conditions_label"],
            "wind_class": calc["wind_class"],
            "wind_speed_knots": round(float(baseline["wind_speed_knots"]), 1),
            "swell_period_sec": round(float(baseline["swell_period_sec"]), 1),
            "size_verdict": calc["size_verdict"],
        }
        # ⭐ WHY THE RANKING RANKED THIS WAY. `calc` already knows, and this row used to throw it
        # away — so two frames could differ 3x in score with every published field near-identical
        # and nothing in the payload able to say why. Measured 2026-08-06 at Pipeline: 08-06T02Z
        # scored 2.2 and 08-07T11Z scored 7.2 at the SAME 3.5 ft, ~11 kt and similar period. The
        # driver was swell direction (73.8 deg against a 325 deg shore normal -> 10% alignment),
        # and NO field in the series carried direction or alignment. That is this house's
        # "a divergence count is not a finding, an attribution is" applied to the product surface.
        # ⚠️ Two fields, not the whole `why` block: the series can run to 168 frames at
        # hours_ahead=168/step=1, and the per-multiplier detail belongs to get_weather_forecast's
        # single-hour answer. `limiting_factor` is the NAME only; its prose is stable and hoisted.
        alignment = calc.get("swell_alignment_pct")
        if alignment is not None:
            row["swell_alignment_pct"] = alignment
        limiting = (calc.get("why") or {}).get("limiting_factor") or {}
        if limiting.get("factor"):
            row["limiting_factor"] = limiting["factor"]

        # ⛔⛔ THE DISCLOSURE THAT WAS REACHING EVERY SURFACE BUT THIS ONE. When the size and the
        # quality disagree about how much swell energy reaches the break, `sim_rating` emits
        # `directional_conflict` and says the height is the likelier overestimate. Five surfaces
        # publish it (routes/weather.py, spot_conditions, spot_ratings, point_surf_augment,
        # admin/surf_forecast) — the window scan dropped it, so the one view a surfer uses to pick
        # an hour was the one view that never warned the height was an upper bound.
        # ⚠️ NUMBERS PER FRAME, PROSE ONCE. `means` is ~200 chars and identical across frames; at
        # 168 frames repeating it would add ~34 KB to a payload the tool docstring already budgets.
        # It is hoisted into `note` below instead, so nothing is lost and nothing is repeated.
        conflict = calc.get("directional_conflict")
        if conflict:
            row["directional_conflict"] = {
                k: v for k, v in conflict.items() if k != "means"
            }
            if conflict_means is None and conflict.get("means"):
                conflict_means = conflict["means"]
        # ⚠️ ANNOTATION ONLY — `quality_rating` above is untouched by daylight. See sim_daylight's
        # docstring: darkness is a property of the observer, not of the swell, and the sim's score
        # must stay byte-identical to the one the map and the hub show for the same spot-hour.
        row.update(sim_daylight.annotate(spot.get("latitude"), spot.get("longitude"), hour))
        series.append(row)

    # Rank SURFABLE light first, then quality, then SIZE as the tie-break — at a spot where several
    # hours score the same (common: wind and period barely move over three hours) the bigger one is
    # the better session.
    #
    # ★ Ranking, not filtering. Every scanned hour stays in `series` with its own `light`, because a
    # dark hour is a real forecast a caller may legitimately want (a dawn session starts before
    # first light; a night swell tells you what the morning inherits). What must not happen is a
    # dark hour being PRESENTED as "the best time to surf" — measured 2026-07-29 at 9 of 17 spots.
    # A frame whose light could not be determined sorts as surfable, i.e. exactly as it did before.
    best = sorted(series, key=_rank_key)[:max(1, top)]

    out: Dict[str, Any] = {
        "scanned": {
            "from": hours[0] if hours else None,
            "to": hours[-1] if hours else None,
            "frames_requested": len(hours),
            "frames_resolved": len(series),
            "baseline_sources": sorted(sources),
        },
        "best_windows": best,
        "series": series,
    }
    notes: List[str] = []
    if series and any("light" in r for r in series):
        lit = [r for r in series if r.get("surfable_light", True)]
        out["scanned"]["surfable_light_frames"] = len(lit)
        if not lit:
            # Polar night, or a horizon short enough to sit entirely inside one night. Ranking still
            # happened on quality alone — say so rather than returning an empty or silently
            # night-time list. Fails OPEN: an answer, labelled, beats no answer.
            out["scanned"]["all_frames_dark"] = True
            notes.append("Every hour in this range is in darkness, so the ranking is by quality "
                         "alone — none of these windows is surfable in daylight.")
    if unresolved:
        # Name them. A scan that silently skipped half the horizon would rank the surviving hours
        # against each other and present that as "the best window in the next 48 h".
        out["scanned"]["unresolved_hours"] = unresolved
        notes.append(f"{len(unresolved)} of {len(hours)} frames had no forecast and were "
                     f"EXCLUDED from the ranking, not scored as flat.")
    if conflict_means:
        # Hoisted, not repeated: the prose is identical on every frame that carries the conflict,
        # and the per-frame numbers are already in `directional_conflict` on those rows.
        conflicted = [r for r in series if r.get("directional_conflict")]
        out["scanned"]["directional_conflict_frames"] = len(conflicted)
        notes.append(f"{len(conflicted)} of {len(series)} frames disagree about swell exposure "
                     f"between the size and the quality: {conflict_means}")
    if not series:
        # Overwrites rather than appends: with nothing ranked, the other notes describe an answer
        # that does not exist.
        notes = ["No frame in this range resolved a forecast, so there is nothing to rank. "
                 "Check get_weather_forecast(spot_name) for the reason."]
    if notes:
        out["note"] = " ".join(notes)
    return out


def summarize(best: List[Dict[str, Any]]) -> Optional[str]:
    """One line naming the winning window, so a caller that reads only the summary is not misled
    about which hour it describes."""
    if not best:
        return None
    b = best[0]
    # Name the light. When every hour in range is dark the ranking falls back to quality alone, and
    # a summary that read like an ordinary recommendation would be the original defect all over
    # again — one sentence deep instead of one field deep.
    light = sim_daylight.describe(b.get("light"))
    # ⭐ AND NAME THE UPPER BOUND, for exactly the reason the light is named. A summary that reads
    # like an ordinary recommendation while the winning frame's own row says the size and the
    # quality disagree about swell exposure is the daylight defect again — one sentence deep
    # instead of one field deep. The height is the more generous of the two and the likelier
    # overestimate, so a caller who reads only this line must not take it as settled.
    # ⚠️ ASCII ONLY IN THE RETURNED STRING. My own probe crashed printing this line —
    # UnicodeEncodeError, cp1252 — because the first draft opened the caveat with an emoji. Comments
    # can carry them; a value that a caller may print to a Windows console cannot.
    conflict = b.get("directional_conflict") or {}
    caveat = ""
    if conflict:
        ratio = conflict.get("energy_disagreement")
        caveat = (f" NOTE: treat that height as an upper bound - the size and the quality disagree "
                  f"about swell exposure by {ratio}x.") if ratio else \
                 " NOTE: treat that height as an upper bound - the size and the quality disagree " \
                 "about swell exposure."
    return (f"Best in range: {b['valid_time']} — {b['breaking_height_ft']} ft "
            f"({b['conditions_label']}), quality {b['quality_rating']}/100 "
            f"({b['quality_label']}), {b['wind_speed_knots']} kt {b['wind_class']}"
            f"{', ' + light if light else ''}.{caveat}")
