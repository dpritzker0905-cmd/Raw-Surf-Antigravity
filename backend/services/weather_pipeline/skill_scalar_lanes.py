"""Scalar-height SHADOW lanes of the skill ledger, one per wave model (2026-09-30 GFS; EURO and ICON 2026-11-01).

`/point` interpolates a marine height as |bilinear(u, v)| (the vector mean) unless SAMPLER_SCALAR_HEIGHT serves the
scalar for that model (sampler.scalar_marine_height_enabled). The vector mean can only shrink a significant wave height,
by as much as the corners' directions diverge. GFS flipped to the scalar on 2026-10-17 on the owner's word, decided on
its paired shadow `raw_surf:GFS_SCALAR`. EURO and ICON wait on their own (SAMPLER_SCALAR_HEIGHT_MODELS stays 'GFS'):
these lanes grade them on the same buoys, hours, leads and observations as `raw_surf:EURO` / `raw_surf:ICON`.
Serves nothing: forecast_skill.run_skill_ledger resolves a lane under sampler.force_scalar_height(), a context, so the
served lanes in the same process never see it.
"""
import os
from typing import List, Optional

SCALAR_LANE_SUFFIX = "_SCALAR"
GFS_SCALAR = "GFS" + SCALAR_LANE_SUFFIX           # retired 2026-10-17: GFS serves the scalar
# SAMPLER_SCALAR_LEDGER_MODELS: which models get a scalar shadow lane while SAMPLER_SCALAR_LEDGER is '1'. Default GFS
# (the only lane before 2026-11-01, so the default is byte-identical). 'GFS,EURO,ICON' adds `raw_surf:EURO_SCALAR` and
# `raw_surf:ICON_SCALAR` beside `raw_surf:EURO` / `raw_surf:ICON`: the evidence SAMPLER_SCALAR_HEIGHT_MODELS waits on
# before naming EURO or ICON (sampler.SCALAR_HEIGHT_MODELS_DEFAULT). Serves nothing.
SCALAR_LEDGER_MODELS_DEFAULT = "GFS"
_SCALAR_SHADOW_ELIGIBLE = ("GFS", "EURO", "ICON")    # real wave models; never CONSENSUS, GFS_RAW or another shadow


def scalar_shadow_lanes(primary: str, graded: List[str]) -> List[str]:
    """`<MODEL>_SCALAR` lanes for the models named in SAMPLER_SCALAR_LEDGER_MODELS, while SAMPLER_SCALAR_LEDGER is '1'.

    A shadow is added only beside a raw lane this pass already grades (the primary or a compare model in `graded`), so
    every scalar row has a same-(buoy, target, lead, observation) partner to pair with. It retires itself per model
    once that model's height SERVES as the scalar (sampler.scalar_marine_height_enabled: master switch on AND the model
    in SAMPLER_SCALAR_HEIGHT_MODELS): the raw lane then IS the scalar answer and the shadow would count it twice. GFS
    retired this way on 2026-10-17; EURO and ICON keep theirs until their own flip."""
    if os.environ.get("SAMPLER_SCALAR_LEDGER", "0") != "1":
        return []
    from services.weather_pipeline.sampler import scalar_marine_height_enabled
    raw_lanes = {(primary or "").strip().upper()} | {(m or "").strip().upper() for m in graded}
    out = []
    for m in os.environ.get("SAMPLER_SCALAR_LEDGER_MODELS", SCALAR_LEDGER_MODELS_DEFAULT).split(","):
        m = m.strip().upper()
        lane = m + SCALAR_LANE_SUFFIX
        if (m in _SCALAR_SHADOW_ELIGIBLE and m in raw_lanes and lane not in out
                and not scalar_marine_height_enabled("marine", m)):
            out.append(lane)
    return out


def scalar_shadow_base(model: str) -> Optional[str]:
    """The wave model a `<MODEL>_SCALAR` shadow lane resolves (None for any other lane name)."""
    m = (model or "").strip().upper()
    if m.endswith(SCALAR_LANE_SUFFIX) and m[:-len(SCALAR_LANE_SUFFIX)] in _SCALAR_SHADOW_ELIGIBLE:
        return m[:-len(SCALAR_LANE_SUFFIX)]
    return None
