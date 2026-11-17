"""marine_source_tally.py: count, for the precomputed spot ratings, WHERE each marine point came from.

WHY (owner, 2026-11-17: "Count in precompute"). When no stored product answers a marine point the point
resolver takes its "2c" branch, a LIVE upstream: Open-Meteo's marine API for GFS and ICON, and for EURO first
Copernicus Marine (Meteo-France MFWAM, not ECMWF's own wave model) and then Open-Meteo. D-074's inventory lists that
as G5 and G6. It is live: one precompute run on 2026-11-17 made 503 requests to Open-Meteo's marine API. Nobody could
say how many SERVED spot-hours that is, by model and lead. This prints that number on every run.

WHAT IT IS. A pass-through around the resolver the precompute already builds for itself. Every call goes to the real
resolver unchanged and its answer is returned unchanged, the same object. On the way back a marine `waves` answer is
classified and one counter is incremented. Nothing else: no field is added to a rated row, no frame byte changes, no
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
_ARG_NAMES = ("model", "domain", "layer", "lat", "lng", "valid_time_str")   # resolve_point's positional order


def enabled() -> bool:
    return os.environ.get(FLAG, "1") != "0"


def classify(resp) -> str:
    """Where a marine point answer came from. PURE.

    `stored`               a stored product answered (the response carries a product_id)
    `upstream:<provider>`  no stored product: the resolver's live branch answered, from that provider
    `no_answer`            nothing usable came back (None, a non-point object, or a response with no point)"""
    if resp is None or getattr(resp, "point", None) is None:
        return NO_ANSWER
    if getattr(resp, "product_id", None):
        return STORED
    provider = getattr(resp, "upstream_provider", None) or getattr(resp, "provider", None) or "unknown"
    return "upstream:%s" % str(provider).strip().lower()


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
    """Pass-through around the precompute's resolver; counts marine `waves` answers by (model, lead band, source).

    Every attribute and every call goes to the inner resolver unchanged. An exception from the inner resolver is
    counted as `error` and re-raised as it was. A fault in the counting itself is swallowed: it must never cost a
    rating."""

    def __init__(self, inner, base: Optional[datetime] = None):
        self._inner = inner
        self._base = base
        self.counts = Counter()

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def _count(self, seen, source: str) -> None:
        try:
            key = (str(seen.get("model") or "?").upper(), lead_band(seen.get("valid_time_str"), self._base), source)
            self.counts[key] += 1
        except Exception:
            pass

    async def resolve_point(self, *args, **kwargs):
        try:
            seen = dict(zip(_ARG_NAMES, args))
            seen.update(kwargs)
            waves = seen.get("domain") == "marine" and seen.get("layer") == "waves"
        except Exception:
            seen, waves = {}, False
        try:
            resp = await self._inner.resolve_point(*args, **kwargs)
        except BaseException:
            if waves:
                self._count(seen, ERROR)
            raise
        if waves:
            try:
                source = classify(resp)
            except Exception:
                source = "unclassified"
            self._count(seen, source)
        return resp


def summary_lines(counts) -> list:
    """Markdown lines for the job log and step summary: per model and lead band, the count from each source and the
    share NOT from a stored product. PURE. Aggregates only."""
    if not counts:
        return ["Marine point source (spot ratings, waves): nothing counted."]
    sources = sorted({k[2] for k in counts}, key=lambda s: (s != STORED, s))
    bands = [name for _l, name in LEAD_BANDS] + [LAST_BAND, "unknown"]
    lines = ["Marine point source for the precomputed spot ratings (waves; counts of spot-frames):", "",
             "| model | lead | " + " | ".join(sources) + " | not stored |", "|---|---|" + "---|" * (len(sources) + 1)]
    for model in sorted({k[0] for k in counts}):
        for band in bands + ["all"]:
            row = [sum(n for (m, b, s), n in counts.items() if m == model and s == src and (band == "all" or b == band))
                   for src in sources]
            total = sum(row)
            if not total:
                continue
            stored = row[sources.index(STORED)] if STORED in sources else 0
            lines.append("| %s | %s | %s | %.1f%% |" % (model, band, " | ".join(str(n) for n in row),
                                                       100.0 * (total - stored) / total))
    return lines


def one_line(counts) -> str:
    """One log line: per model, the share of marine answers that did not come from a stored product. PURE."""
    out = []
    for model in sorted({k[0] for k in counts}):
        total = sum(n for (m, _b, _s), n in counts.items() if m == model)
        stored = sum(n for (m, _b, s), n in counts.items() if m == model and s == STORED)
        out.append("%s %d of %d not stored (%.1f%%)" % (model, total - stored, total,
                                                        100.0 * (total - stored) / total if total else 0.0))
    return "; ".join(out) or "nothing counted"


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
