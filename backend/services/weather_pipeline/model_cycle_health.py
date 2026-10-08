"""Read-only cycle freshness; receipt/valid timestamps never stand in for a model cycle."""
from datetime import datetime, timezone
import math
import os
import json
from services.weather_pipeline.estimate_cycle_health import estimate_cycle_report


def _utc(value):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        return None
    return value.astimezone(timezone.utc)


def cycle_thresholds(model, domain):
    # Global GFS/atmospheric IFS: 6h; GWAM and Copernicus global waves: 12h.
    # Allow two/three missed cycles plus 6h publication/ingest slack. These are
    # operational thresholds, not a forecast-skill or serving selection policy.
    cadence = 12 if domain == 'marine' and model in ('ICON', 'EURO') else 6
    defaults = (2 * cadence + 6, 3 * cadence + 6)
    try:
        warn, critical = [float(os.environ.get(f'HEALTH_MODEL_CYCLE_{level}_HOURS_{model}_{domain.upper()}', default))
                          for level, default in zip(('WARN', 'CRITICAL'), defaults)]
        if not (math.isfinite(warn) and math.isfinite(critical) and 0 < warn < critical):
            raise ValueError('invalid cycle thresholds')
        return warn, critical
    except (TypeError, ValueError):
        return defaults


def summarize_model_cycles(products, now, model, domain):
    # Latest receipt per component/global tier/tile. Old retained frames do not
    # poison a refreshed cohort; new unknown receipts cannot borrow old provenance.
    cohorts = {}
    for p in products:
        rt = getattr(p, 'run_time', None)
        if not isinstance(rt, datetime):
            continue
        rt = rt.replace(tzinfo=timezone.utc) if rt.tzinfo is None else rt.astimezone(timezone.utc)
        key = (getattr(p, 'layer', ''), getattr(p, 'region_id', None), getattr(p, 'tile_id', None),
               bool(getattr(p, 'is_estimated', False)))
        current = cohorts.get(key)
        if current is None or rt > current[0]:
            cohorts[key] = (rt, [p])
        elif rt == current[0]:
            current[1].append(p)
    warn_h, critical_h = cycle_thresholds(model, domain)
    known_ages, unknown = [], set()
    native_cycles = {}
    for _, group in cohorts.values():
        for p in group:
            if not getattr(p, 'is_estimated', False) and getattr(p, 'model_run_time_status', '') == 'known':
                cycle = _utc(getattr(p, 'model_run_time', None))
                if cycle is not None and (cycle - now).total_seconds() <= 300:
                    key = (getattr(p, 'layer', ''), getattr(p, 'region_id', None), getattr(p, 'tile_id', None))
                    native_cycles[key] = max(cycle, native_cycles.get(key, cycle))
    dependency_reports, dependency_reasons = {}, set()
    dependency_verdict, mixed_verified = 'ok', False
    for _, group in cohorts.values():
        for p in group:
            if getattr(p, 'is_estimated', False):
                key = (getattr(p, 'layer', ''), getattr(p, 'region_id', None), getattr(p, 'tile_id', None))
                dependency = estimate_cycle_report(p, now, native_cycles.get(key), cycle_thresholds)
                if dependency is not None:
                    report, dep_verdict, ages, anchor, mixed = dependency
                    known_ages.extend(ages)
                    mixed_verified |= mixed
                    if report['issues']:
                        dependency_reasons.update(report['issues'])
                    if dep_verdict == 'critical' or dep_verdict == 'warn' and dependency_verdict == 'ok':
                        dependency_verdict = dep_verdict
                    fingerprint = json.dumps(report, sort_keys=True)
                    row = dependency_reports.setdefault(fingerprint, {**report, 'products': 0})
                    row['products'] += 1
                    continue
            provenance = getattr(p, 'model_run_time_status', 'missing')
            cycle = _utc(getattr(p, 'model_run_time', None)) if provenance == 'known' else None
            if cycle is None:
                unknown.add(str(provenance) if provenance != 'known' else 'invalid')
                continue
            age = (now - cycle).total_seconds() / 3600
            if age < -5 / 60:
                unknown.add('future')
            else:
                known_ages.append(max(0.0, age))
    age_h = max(known_ages, default=None)
    verdict, reasons = 'ok', []
    if age_h is not None and age_h > critical_h:
        verdict = 'critical'
        reasons.append(f'model cycle {age_h:.1f}h old (> {critical_h}h)')
    elif age_h is not None and age_h > warn_h:
        verdict = 'warn'
        reasons.append(f'model cycle {age_h:.1f}h old (> {warn_h}h)')
    if unknown or age_h is None:
        if verdict != 'critical':
            verdict = 'warn'
        reasons.append('model cycle unverified: ' + ','.join(sorted(unknown or {'missing'})))
    if dependency_verdict == 'critical' or dependency_verdict == 'warn' and verdict == 'ok':
        verdict = dependency_verdict
    reasons.extend(sorted(dependency_reasons))
    newest_native = max(native_cycles.values(), default=None)
    return {'model_cycle_age_h': round(age_h, 1) if age_h is not None else None,
            'model_cycle_status': 'mixed' if known_ages and (unknown or mixed_verified) else ('known' if known_ages else 'unverified'),
            'native_model_cycle_age_h': round(max(0, (now - newest_native).total_seconds() / 3600), 1) if newest_native else None,
            'estimate_cycles': [dependency_reports[key] for key in sorted(dependency_reports)[:64]],
            'estimate_cycle_groups_omitted': max(0, len(dependency_reports) - 64),
            'model_cycle_unverified': sorted(unknown), 'model_cycle_warn_h': warn_h,
            'model_cycle_critical_h': critical_h}, verdict, reasons
