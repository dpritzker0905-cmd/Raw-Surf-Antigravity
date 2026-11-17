"""marine_source_tally.py: count, for the precomputed spot ratings, WHERE each marine and wind point came from.

WHY (owner, 2026-11-17: "Count in precompute"). When no stored product answers a marine point the point
resolver takes its "2c" branch, a LIVE upstream: Open-Meteo's marine API for GFS and ICON, and for EURO first
Copernicus Marine (Meteo-France MFWAM, not ECMWF's own wave model) and then Open-Meteo. D-074's inventory lists that
as G5 and G6. It is live: the job log of precompute run 44132744032 (2026-11-17) has 579 lines "[Open-Meteo Provider]
Fetching single point forecast for <MODEL> marine/waves" (GFS 339, ICON 156, EURO 84), sent through the Netlify
weather-proxy, 433 of them before the "precompute complete" line. Those are FETCH lines, not served spot-frames.
Nobody could say how many SERVED spot-frames that is, by model and lead. This prints that number on every run.

WHAT IT COVERS. The served ratings stage only: the one `precompute_spot_ratings` call per model in
`run_spot_ratings_precompute`. The buoy-scoring stage builds its own resolver and is not counted here.

WIND TOO (owner, 2026-11-17, typed in the advisor's session and relayed: "Count wind too"). `rate_one_spot` asks the
same resolver for wind, and the wind branch has the same live fallback (`build_wind_direct_point_response`, Open-Meteo).
Wind is counted in its OWN table and never pooled with waves: the sources and the stored-product rules differ. The
classifying rule is the same for both and was read from code: the sampler stamps `product_id` on every answer it
samples from a stored product, whatever the domain, and neither live branch sets one.

WHAT IT IS. A pass-through around the resolver the precompute already builds for itself. Every call goes to the real
resolver unchanged and its answer is returned unchanged, the same object. On the way back a marine `waves` or a wind
`wind` answer is classified and one counter is incremented. Nothing else: no field is added to a rated row, no frame byte changes, no
extra request is made. `rate_one_spot` is not touched.

WHAT IT PRINTS. Counts and shares by model and by lead band. No spot, no coordinate, no value.
Kill: SPOT_RATINGS_SOURCE_TALLY=0 (the precompute then uses the bare resolver, exactly as before)."""
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

FLAG = "SPOT_RATINGS_SOURCE_TALLY"
STORED, NO_ANSWER, ERROR = "stored", "no_answer", "error"
LEAD_BANDS = ((24, "0-24h"), (48, "24-48h"), (72, "48-72h"))
LAST_BAND = "72h+"
COUNTED = {("marine", "waves"): "waves", ("wind", "wind"): "wind"}        # (domain, layer) -> the table it lands in
TABLES = ("waves", "wind")
_ARG_NAMES = ("model", "domain", "layer", "lat", "lng", "valid_time_str")   # resolve_point's positional order


def enabled() -> bool:
    return os.environ.get(FLAG, "1") != "0"


def classify(resp) -> str:
    """Where a point answer (waves or wind) came from. PURE.

    `stored`               a stored product answered (the response carries a product_id)
    `upstream:<provider>[:<model>]`  no stored product: the resolver's live branch answered. The labels are the
                           response's own: `copernicus:cmems_mod_glo_wav...` is Meteo-France MFWAM, `open-meteo:...`
                           is Open-Meteo (reached through the weather-proxy), `gfs_estimated_fallback:...` is the
                           GFS-based estimate served under another model's name
    `no_answer`            nothing usable came back (None, a non-point object, or a response with no point)"""
    if resp is None or getattr(resp, "point", None) is None:
        return NO_ANSWER
    if getattr(resp, "product_id", None):
        return STORED
    provider = getattr(resp, "upstream_provider", None) or getattr(resp, "provider", None) or "unknown"
    label = "upstream:%s" % str(provider).strip().lower()
    model = getattr(resp, "upstream_model", None)
    return "%s:%s" % (label, str(model).strip().lower()) if model else label


def lead_band(valid_time_str, base: Optional[datetime]) -> str:
    """The lead band of one frame: its valid time against the run's base hour. PURE. `unknown` if unreadable."""
    if base is None or not valid_time_str:
        return "unknown"
    try:
        s = str(valid_time_str).replace("Z", "+00:00")
        vt = datetime.fromisoformat(s)
        if vt.tzinfo is None:
            vt = vt.replace(tzinfo=timezone.utc)
        b = base if base.tzinfo is not None else base.replace(tzinfo=timezone.utc)
        hours = (vt - b).total_seconds() / 3600.0
    except (TypeError, ValueError):
        return "unknown"
    for limit, name in LEAD_BANDS:
        if hours < limit:
            return name
    return LAST_BAND


class CountingResolver:
    """Pass-through around the precompute's resolver; counts marine `waves` and wind `wind` answers by
    (table, model, lead band, source). Any other layer passes through uncounted.

    Every attribute and every call goes to the inner resolver unchanged. An exception from the inner resolver is
    counted as `error` and re-raised as it was. A fault in the counting itself is swallowed: it must never cost a
    rating."""

    def __init__(self, inner, base: Optional[datetime] = None):
        self._inner = inner
        self._base = base
        self.counts = Counter()

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def _count(self, table, seen, source: str) -> None:
        try:
            key = (table, str(seen.get("model") or "?").upper(), lead_band(seen.get("valid_time_str"), self._base), source)
            self.counts[key] += 1
        except Exception:
            pass

    async def resolve_point(self, *args, **kwargs):
        try:
            seen = dict(zip(_ARG_NAMES, args))
            seen.update(kwargs)
            table = COUNTED.get((str(seen.get("domain")).lower(), str(seen.get("layer")).lower()))
        except Exception:
            seen, table = {}, None
        try:
            resp = await self._inner.resolve_point(*args, **kwargs)
        except BaseException:
            if table:
                self._count(table, seen, ERROR)
            raise
        if table:
            try:
                source = classify(resp)
            except Exception:
                source = "unclassified"
            self._count(table, seen, source)
        return resp


def _table(counts, table) -> dict:
    return {k[1:]: n for k, n in counts.items() if k[0] == table}


def summary_lines(counts) -> list:
    """Markdown lines for the job log and step summary: one table for waves and one for wind; per model and lead band,
    the count from each source and the share NOT from a stored product. PURE. Aggregates only."""
    lines = []
    for table in TABLES:
        sub = _table(counts or {}, table)
        if lines:
            lines.append("")
        if not sub:
            lines.append("Point source (spot ratings, %s): nothing counted." % table)
            continue
        sources = sorted({k[2] for k in sub}, key=lambda src: (src != STORED, src))
        bands = [name for _l, name in LEAD_BANDS] + [LAST_BAND, "unknown"]
        lines += ["Point source for the precomputed spot ratings: %s (counts of spot-frames, served ratings stage):" % table.upper(),
                  "", "| model | lead | " + " | ".join(sources) + " | not stored |", "|---|---|" + "---|" * (len(sources) + 1)]
        for model in sorted({k[0] for k in sub}):
            for band in bands + ["all"]:
                row = [sum(n for (m, b, src), n in sub.items() if m == model and src == want and (band == "all" or b == band))
                       for want in sources]
                total = sum(row)
                if not total:
                    continue
                stored = row[sources.index(STORED)] if STORED in sources else 0
                lines.append("| %s | %s | %s | %.1f%% |" % (model, band, " | ".join(str(n) for n in row),
                                                           100.0 * (total - stored) / total))
    return lines


def one_line(counts) -> str:
    """One log line: per table and model, the share of answers that did not come from a stored product. PURE."""
    parts = []
    for table in TABLES:
        sub = _table(counts or {}, table)
        out = []
        for model in sorted({k[0] for k in sub}):
            total = sum(n for (m, _b, _s), n in sub.items() if m == model)
            stored = sum(n for (m, _b, src), n in sub.items() if m == model and src == STORED)
            out.append("%s %d of %d not stored (%.1f%%)" % (model, total - stored, total,
                                                            100.0 * (total - stored) / total if total else 0.0))
        parts.append("%s: %s" % (table, "; ".join(out) or "nothing counted"))
    return " | ".join(parts)


def write_step_summary(counts, env=None) -> bool:
    """Append the table to the Actions step summary when there is one. Never raises."""
    path = (os.environ if env is None else env).get("GITHUB_STEP_SUMMARY")
    if not path:
        return False
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(summary_lines(counts)) + "\n")
        return True
    except OSError:
        return False
