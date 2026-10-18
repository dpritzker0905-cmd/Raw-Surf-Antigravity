"""Read-only cycle freshness; receipt/valid timestamps never stand in for a model cycle."""
from datetime import datetime, timezone
import math
import os
from services.weather_pipeline.blend_cycle_health import verified_blend_cycles


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
    known_ages, unknown, contributors = [], set(), {}
    for _, group in cohorts.values():
        for p in group:
            provenance = getattr(p, 'model_run_time_status', 'missing')
            try:
                sources = verified_blend_cycles(p)
            except ValueError:
                unknown.add(str(provenance) if provenance != 'known' else 'invalid')
                continue
            if sources is not None:
                for source_model, dataset, cycle in sources:
                    age = (now - cycle).total_seconds() / 3600
                    if age < -5 / 60:
                        unknown.add('future')
                        continue
                    age = max(0.0, age)
                    source_warn, source_critical = cycle_thresholds(source_model, domain)
                    source_verdict = ('critical' if age > source_critical else
                                      'warn' if age > source_warn else 'ok')
                    contributors[(source_model, dataset, cycle)] = {
                        'model': source_model, 'source_dataset': dataset,
                        'model_run_time': cycle.isoformat(), 'age_h': round(age, 1),
                        'warn_h': source_warn, 'critical_h': source_critical, 'verdict': source_verdict,
                    }
                    if source_model == model:
                        known_ages.append(age)
                continue
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
    source_details = [contributors[key] for key in sorted(contributors)]
    for source in source_details:
        if source['model'] == model or source['verdict'] == 'ok':
            continue
        if source['verdict'] == 'critical' or verdict == 'ok':
            verdict = source['verdict']
        threshold = source['critical_h'] if source['verdict'] == 'critical' else source['warn_h']
        reasons.append(f"{source['model']}/{source['source_dataset']} contributor cycle "
                       f"{source['age_h']:.1f}h old (> {threshold}h)")
    if unknown or age_h is None:
        if verdict != 'critical':
            verdict = 'warn'
        reasons.append('model cycle unverified: ' + ','.join(sorted(unknown or {'missing'})))
    status = ('mixed' if unknown and known_ages else 'unverified') if unknown or not known_ages else (
        'verified_contributors' if contributors else 'known')
    return {'model_cycle_age_h': round(age_h, 1) if age_h is not None else None,
            'model_cycle_status': status, 'model_cycle_contributors': source_details,
            'model_cycle_unverified': sorted(unknown), 'model_cycle_warn_h': warn_h,
            'model_cycle_critical_h': critical_h}, verdict, reasons
