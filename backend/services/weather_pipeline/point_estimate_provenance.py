"""Identity of actual direct-point blend inputs, independent of its physical recipe."""
from datetime import datetime, timezone

from services.weather_pipeline.cycle_provenance import cycle_from_points


def _sample_time(raw, index):
    # Provider hourly timestamps without an offset are UTC (same as the selector).
    date = datetime.fromisoformat(raw["hourly"]["time"][index].replace("Z", "+00:00"))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone.utc)


def point_estimate_provenance(target_dt, contributors):
    """Report selected samples and verified cycles; never infer identity from the ask.

    `contributors` contains only sources used by the recipe, as (role, model, raw, index).
    Persistence uses a historical anchor by design. Serving honesty therefore describes
    the common *target* sample time, not the anchor. Different active target samples
    have no common frame or single signed offset: expose each and flag that explicitly.
    This function neither samples a value nor chooses/changes a source or its weight.
    """
    sources, points, target_dates = [], [], set()
    for role, model, raw, index in contributors:
        point = {"__model_run_time": raw.get("__model_run_time")}
        points.append(point)
        cycle = cycle_from_points([point])
        sample = _sample_time(raw, index)
        if role.endswith("_target"):
            target_dates.add(sample)
        sources.append({
            "role": role, "model": model,
            "provider": "copernicus" if role == "native_anchor" else "open-meteo",
            "source_dataset": raw.get("source_dataset"),
            "sampled_valid_time": sample.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "model_run_time": cycle["model_run_time"].isoformat() if cycle["model_run_time"] else None,
            "model_run_time_status": cycle["model_run_time_status"],
        })
    shared_target = len(target_dates) == 1
    basis = {"cycle_semantics": "shared_contributor_cycle", "cycle_sources": sources,
             "target_time_semantics": "shared_target_sample",
             "target_time_status": "known" if shared_target else "mixed"}
    if shared_target:
        sample = next(iter(target_dates))
        offset = (sample - target_dt).total_seconds() / 3600.0
        honesty = {"served_valid_time": sample.strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "frame_offset_hours": round(offset, 2), "frame_substituted": abs(offset) > .5}
    else:
        honesty = {"served_valid_time": None, "frame_offset_hours": 0.0, "frame_substituted": True,
                   "warnings": ["estimate_target_times_mixed: active donor target samples differ; "
                                "no single served frame or signed offset. See estimate_basis.cycle_sources."]}
    return basis, {**cycle_from_points(points), **honesty}
