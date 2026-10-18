"""Validate the recorded cycles of an estimate without inventing a shared run.

Different forecasting models need not publish the same cycle. A trend's anchor
and target from the same model must agree, and every recorded role must be
complete. This inspects metadata only; it never selects or rebuilds a forecast.
"""
from datetime import datetime, timezone


def verified_blend_cycles(product):
    """Return verified (model, dataset, cycle) tuples, None for legacy recipes.

    Recognized but malformed records raise ValueError, including contradictory
    top-level claims. Unknown records must never borrow receipt or valid time.
    """
    basis = getattr(product, 'estimate_basis', None)
    model = getattr(product, 'model', '')
    if (not getattr(product, 'is_estimated', False) or
            getattr(product, 'domain', '') != 'marine' or model not in ('ICON', 'EURO') or
            not isinstance(basis, dict) or
            basis.get('type') not in (f'{model.lower()}_persistence_gfs_blend',
                                      'euro_persistence_gfs_icon_blend')):
        return None
    if basis.get('cycle_semantics') != 'shared_contributor_cycle':
        if 'cycle_sources' in basis:
            raise ValueError('unrecognized contributor semantics')
        return None
    sources = basis.get('cycle_sources')
    if not isinstance(sources, list) or not all(isinstance(s, dict) for s in sources):
        raise ValueError('missing contributor records')
    roles = [s.get('role') for s in sources]
    required = {'native_anchor', 'gfs_anchor', 'gfs_target'}
    if (not all(isinstance(role, str) for role in roles) or len(roles) != len(set(roles)) or
            set(roles) not in (required, required | {'icon_anchor', 'icon_target'})):
        raise ValueError('incomplete or duplicated contributor roles')
    native_id = 'persistence_anchor_product_id' if model == 'ICON' else 'euro_anchor_product_id'
    dates_by_model, identities, cycles = {}, {}, []
    for source in sources:
        role = source['role']
        expected_model = model if role == 'native_anchor' else ('GFS' if role.startswith('gfs_') else 'ICON')
        expected_id = basis.get(native_id if role == 'native_anchor' else role + '_product_id')
        dataset = source.get('source_dataset')
        if (source.get('model') != expected_model or not isinstance(expected_id, str) or not expected_id or
                source.get('product_id') != expected_id or not isinstance(dataset, str) or not dataset or
                source.get('model_run_time_status') != 'known' or
                source.get('reported_model_run_time_status') != 'known'):
            raise ValueError('unverified contributor identity')
        try:
            cycle = datetime.fromisoformat(source['model_run_time'].replace('Z', '+00:00'))
            if cycle.tzinfo is None or cycle.utcoffset() is None:
                raise ValueError('unqualified contributor cycle')
            cycle = cycle.astimezone(timezone.utc)
        except (KeyError, AttributeError, TypeError) as exc:
            raise ValueError('invalid contributor cycle') from exc
        if expected_model in dates_by_model and dates_by_model[expected_model] != cycle:
            raise ValueError('conflicting cycles within a contributing model')
        dates_by_model[expected_model] = cycle
        if role != 'native_anchor':
            family = role.split('_')[0]
            identity = (source.get('provider'), dataset)
            if family in identities and identities[family] != identity:
                raise ValueError('trend donor identities disagree')
            identities[family] = identity
        cycles.append((expected_model, dataset, cycle))
    shared = set(dates_by_model.values())
    status = getattr(product, 'model_run_time_status', 'missing')
    if status == 'known':
        if len(shared) != 1 or getattr(product, 'model_run_time', None) != next(iter(shared)):
            raise ValueError('shared-cycle claim contradicts contributors')
    elif status != 'conflicting' or len(shared) < 2 or getattr(product, 'model_run_time', None) is not None:
        raise ValueError('unverified shared-cycle claim')
    return cycles
