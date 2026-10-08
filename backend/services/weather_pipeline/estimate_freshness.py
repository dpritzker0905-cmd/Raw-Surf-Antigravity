"""Dark A8-02: a newer neighbouring native frame defeats an older estimate.

Receipt age and verified cycle age remain separate facts. Unique far-horizon
estimates and different coverage/resolution classes are never discarded.
"""
from bisect import bisect_left, bisect_right
from datetime import datetime
import os


def enabled():
    return os.environ.get('FRESH_ESTIMATE_SELECTION', '0') == '1'


def _instant(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if isinstance(value, datetime) and value.tzinfo is not None and value.utcoffset() is not None:
        return value.timestamp()
    return None


def _cycle(product):
    if getattr(product, 'model_run_time_status', None) == 'known':
        return _instant(getattr(product, 'model_run_time', None))
    basis = getattr(product, 'estimate_basis', None) or {}
    sources = basis.get('cycle_sources')
    for source in sources if isinstance(sources, list) else []:
        if not isinstance(source, dict):
            continue
        if source.get('role') == 'native_anchor' and source.get('model_run_time_status') == 'known':
            return _instant(source.get('model_run_time'))
    return None


def _scope(product):
    coverage = product.coverage
    return (product.model.upper(), product.domain.lower(), product.layer.lower(),
            product.region_id, product.coverage_mode, product.resolution,
            coverage.west, coverage.south, coverage.east, coverage.north)


def _older(estimate, native):
    est_cycle, native_cycle = _cycle(estimate), _cycle(native)
    est_receipt, native_receipt = _instant(estimate.run_time), _instant(native.run_time)
    return ((est_cycle is not None and native_cycle is not None and est_cycle < native_cycle)
            or (est_receipt is not None and native_receipt is not None and est_receipt < native_receipt))


def obsolete_estimate_ids(products, window_s=3 * 3600):
    """Identity set; sorting/bisect keeps a whole-manifest reconciliation bounded.

    Selection callers already bounded both lists around one request; window_s=None
    compares that candidate set. Writers compare neighbours of each actual hour.
    """
    native = {}
    for product in products:
        if product.is_estimated or not product.is_forecast_authoritative:
            continue
        instant = _instant(product.valid_time_start)
        if instant is not None:
            native.setdefault(_scope(product), []).append((instant, product))
    indexed = {}
    for scope, entries in native.items():
        entries.sort(key=lambda entry: entry[0])
        indexed[scope] = ([entry[0] for entry in entries], [entry[1] for entry in entries])
    obsolete = set()
    for product in products:
        if not product.is_estimated:
            continue
        instant = _instant(product.valid_time_start)
        if instant is None:
            continue
        times, neighbours = indexed.get(_scope(product), ([], []))
        left = 0 if window_s is None else bisect_left(times, instant - window_s)
        right = len(times) if window_s is None else bisect_right(times, instant + window_s)
        if any(_older(product, item) for item in neighbours[left:right]):
            obsolete.add(id(product))
    return obsolete


def filter_estimate_pairs(authoritative, estimated):
    if not enabled():
        return authoritative, estimated
    obsolete = obsolete_estimate_ids([pair[0] for pair in authoritative + estimated], window_s=None)
    return authoritative, [pair for pair in estimated if id(pair[0]) not in obsolete]
