"""PartitionSource as ruled (advisor 2026-11-22): the SERVED partitions, the SAME model member the chain uses, per region.

It reads exactly what the served chain's partition path returns, `PointResolutionService._resolve_partitions`, from our STORED
products only:
  * the service's provider is replaced by `StoredOnlyProvider`, whose every call raises, so a stored-grid miss can NEVER become a
    live Open-Meteo / CMEMS request. A point that cannot be answered from storage is recorded as unavailable;
  * the partitions flag is read from the served code path, which is gated on SURF_PARTITIONS. Production declares it '0', so the
    served chain currently resolves NO partitions and falls through to the total field. The archive job therefore sets the flag
    for the duration of the call (`partitions_flag_forced_on` in the meta, an open question to the advisor) and records, per row,
    whether the row is `partitions` or the single `total` train the served chain would have used.
The per-region source (provider, source_dataset, upstream model) the total point answers from is recorded in the archive meta; if a
region resolves to something other than CMEMS MFWAM, that source is used and shows up there.

Nothing here fetches. The service object is injected; `build_service` (CI only) constructs a stored-only one.
"""
import asyncio
import os
from contextlib import contextmanager
from datetime import timedelta

MODEL_LEADS_H = range(0, 73)


class StoredOnlyError(RuntimeError):
    """A direct/live point fetch was attempted. The archive reads stored products only."""


class StoredOnlyProvider:
    """Stands in for OpenMeteoProvider: any attribute is an async callable that raises StoredOnlyError."""

    def __getattr__(self, name):
        async def _refuse(*_a, **_k):
            raise StoredOnlyError(f"stored products only: provider.{name} refused")
        return _refuse


@contextmanager
def stored_only_guard():
    """Block the one KNOWN live-fetch path that bypasses `provider`: point_resolution lazily imports
    `services.copernicus_marine_service.fetch_euro_marine` (a native CMEMS request) for EURO marine points the store cannot answer.
    The name is replaced for the duration of the read, so that import-at-call picks up the refusing stub. If the module is
    not installed there is no such path, and the guard is a no-op."""
    try:
        import services.copernicus_marine_service as cms
    except ImportError:
        yield
        return
    prev = getattr(cms, "fetch_euro_marine", None)

    async def _refuse(*_a, **_k):
        raise StoredOnlyError("stored products only: copernicus_marine_service.fetch_euro_marine refused")
    cms.fetch_euro_marine = _refuse
    try:
        yield
    finally:
        if prev is not None:
            cms.fetch_euro_marine = prev


@contextmanager
def partitions_flag_on():
    prev = os.environ.get("SURF_PARTITIONS")
    os.environ["SURF_PARTITIONS"] = "1"
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop("SURF_PARTITIONS", None)
        else:
            os.environ["SURF_PARTITIONS"] = prev


def _valid_time(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _src(resp):
    return {k: getattr(resp, k, None) for k in ("provider", "model", "source_dataset", "upstream_provider", "upstream_model")}


class ServedPartitionSource:
    """`rows(init, targets)` for the archive job. `targets`: dicts with id, lat, lon, region (optional), model (optional).
    `model_for` maps a target to the model member the served chain uses for it (default: the target's own `model`, else `default_model`)."""

    def __init__(self, service, default_model="EURO", leads_h=MODEL_LEADS_H):
        self.service, self.default_model, self.leads_h = service, default_model, list(leads_h)
        self._sources, self._basis = {}, {"partitions": 0, "total": 0, "unavailable": 0}
        self._models = {}

    def model_for(self, target):
        return target.get("model") or self.default_model

    async def _row(self, init, target, lead):
        model = self.model_for(target)
        vt = _valid_time(init + timedelta(hours=lead))
        try:
            resp = await self.service._resolve_point_internal(model=model, domain="marine", layer="waves",
                                                              lat=target["lat"], lng=target["lon"], valid_time_str=vt)
        except Exception:                                                  # StoredOnlyError or a stored-grid miss
            return {"target": target["id"], "lead_h": lead, "partitions": None, "basis": "unavailable", "total": None}
        p = getattr(resp, "point", None)
        h, tp = (getattr(p, "speed", None), getattr(p, "period", None)) if p is not None else (None, None)
        if not (h and tp and h == h and tp == tp and h > 0 and tp > 0):
            return {"target": target["id"], "lead_h": lead, "partitions": None, "basis": "unavailable", "total": None}
        self._sources.setdefault(target.get("region", "unspecified"), {})[repr(sorted(_src(resp).items()))] = _src(resp)
        try:
            parts = await self.service._resolve_partitions(model, "waves", target["lat"], target["lon"], vt, h, tp)
        except Exception:
            parts = None
        d = getattr(p, "direction", None)
        d = None if (d is not None and d != d) else d
        total = {"h": float(h), "tp": float(tp), "dir": d}               # always archived: it IS what production rates (CHAIN_SERVED)
        if parts:
            return {"target": target["id"], "lead_h": lead, "partitions": parts, "basis": "partitions", "total": total}
        return {"target": target["id"], "lead_h": lead, "basis": "total", "total": total,
                "partitions": [dict(total, kind="swell")]}

    async def rows_async(self, init, targets):
        out = []
        with partitions_flag_on(), stored_only_guard():
            for t in targets:
                self._models[t["id"]] = self.model_for(t)
                for lead in self.leads_h:
                    r = await self._row(init, t, lead)
                    self._basis[r["basis"]] += 1
                    out.append(r)
        return out

    def rows(self, init, targets):
        return asyncio.run(self.rows_async(init, targets))

    def meta(self):
        """Provenance for the archive meta: per-region source(s), model per target, basis counts, the forced flag."""
        return {"partition_basis_counts": dict(self._basis), "partitions_flag_forced_on": True,
                "partition_model_by_target": dict(sorted(self._models.items())),
                "partition_sources_by_region": {r: sorted(v.values(), key=lambda s: repr(sorted(s.items())))
                                                for r, v in sorted(self._sources.items())},
                "stored_products_only": True}


def build_service():
    """CI ONLY: a PointResolutionService over OUR stored products with a stored-only provider. Needs the same bucket secrets
    the tide read uses. Not exercised by the unit tests (they inject a fake service); the first real run is the check."""
    from services.weather_pipeline.dynamic_index import DynamicProductIndex
    from services.weather_pipeline.point_resolution import PointResolutionService
    from services.weather_pipeline.store import ProductStore
    store = ProductStore()
    store.restore_from_supabase()
    return PointResolutionService(store=store, dynamic_index=DynamicProductIndex(), provider=StoredOnlyProvider())
