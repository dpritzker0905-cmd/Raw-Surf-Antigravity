"""Read-only dependency health for stored estimates; mixed verified cycles are legitimate."""
from datetime import datetime, timezone


def parse_cycle(value):
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None or result.utcoffset() is None:
            return None
        return result.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        return None


def estimate_cycle_report(product, now, newest_native, thresholds):
    basis = getattr(product, 'estimate_basis', None)
    sources = basis.get('cycle_sources') if isinstance(basis, dict) else None
    if not isinstance(sources, list):
        return None
    parsed, issues, models = {}, [], {}
    for source in sources:
        if not isinstance(source, dict):
            issues.append('invalid contributor')
            continue
        role = source.get('role')
        if role not in ('native_anchor', 'gfs_anchor', 'gfs_target', 'icon_anchor', 'icon_target'):
            issues.append('unknown contributor role')
            continue
        if role in models:
            issues.append('duplicate contributor role')
        models[role] = source.get('model')
        cycle = parse_cycle(source.get('model_run_time')) if source.get('model_run_time_status') == 'known' else None
        if cycle is None:
            issues.append(f'{role} cycle unverified')
        elif (cycle - now).total_seconds() > 300:
            issues.append(f'{role} cycle future')
        else:
            parsed[role] = cycle
    required = {'native_anchor', 'gfs_anchor', 'gfs_target'}
    if any(role.startswith('icon_') for role in models):
        required |= {'icon_anchor', 'icon_target'}
    for role in sorted(required - models.keys()):
        issues.append(f'{role} missing')
    anchor = parsed.get('native_anchor')
    if models.get('native_anchor') != getattr(product, 'model', None):
        issues.append('native anchor model mismatch')
    for role, model in models.items():
        if role.startswith('gfs_') and model != 'GFS' or role.startswith('icon_') and model != 'ICON':
            issues.append(f'{role} model mismatch')
    for model in ('gfs', 'icon'):
        if parsed.get(model + '_anchor') != parsed.get(model + '_target'):
            issues.append(f'{model} anchor/target cycle mismatch')
    if anchor is not None and (newest_native is None or anchor != newest_native):
        issues.append('anchor is not newest verified native cycle')
    skews = [(cycle - anchor).total_seconds() / 3600 for role, cycle in parsed.items()
             if role != 'native_anchor' and anchor is not None]
    if any(skew < 0 or skew > 12 for skew in skews):
        issues.append('donor cycle skew outside 0..12h')
    verdict = 'warn' if issues else 'ok'
    ages = []
    for role, cycle in parsed.items():
        model = models[role]
        warn, critical = thresholds(model, getattr(product, 'domain', 'marine'))
        age = max(0, (now - cycle).total_seconds() / 3600)
        ages.append(age)
        if age > critical:
            verdict = 'critical'
            issues.append(f'{role} model cycle {age:.1f}h old (> {critical}h)')
        elif age > warn:
            if verdict != 'critical':
                verdict = 'warn'
            issues.append(f'{role} model cycle {age:.1f}h old (> {warn}h)')
    report = {'anchor_cycle': anchor.isoformat() if anchor else None,
              'donor_cycles': {role: cycle.isoformat() for role, cycle in sorted(parsed.items())
                               if role != 'native_anchor'},
              'cycle_skew_h': round(max(skews), 1) if skews else None,
              'verdict': verdict, 'issues': sorted(set(issues))}
    return report, verdict, ages, anchor, len(set(parsed.values())) > 1
