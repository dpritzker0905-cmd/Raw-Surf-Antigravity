"""Coverage accounting for all available commit metadata; never label it patch review."""
import collections
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
raw = subprocess.check_output(['git', 'log', '--all', '--reflog', '--reverse', '--topo-order',
    '--name-only', '--format=%x1e%H%x1f%P%x1f%cI%x1f%B%x1d'], cwd=ROOT).decode('utf-8', 'replace')
patterns = {
    'physics_quantities': r'physics|shoal|refract|breaking|breaker|spectrum|spectral|wave.height|energy|swell|gamma',
    'provenance_time': r'provenance|cycle|valid.time|run.time|forecast.hour|lead.time|authority|estimated',
    'verification_calibration': r'calibrat|skill|buoy|nearshore.validation|accuracy|persistence|holdout|jacobian|science',
    'rendering_geography': r'shader|webgl|mask|halo|crest|opacity|zoom|viewport|antimeridian|mercator|lod',
    'transport_lifecycle': r'abort|retry|race|cache|fetch|ingest|timeout|readiness|handoff',
    'product_rating': r'rating|score|confidence|spread|owner|preference|surf.height|climatolog',
    'ci_evidence_memory': r'workflow|github|\bci\b|test|evidence|memory|brain|audit|forensic|handoff|register',
}
records = []
counts = collections.Counter()
for block in raw.split('\x1e')[1:]:
    header, paths = block.split('\x1d', 1)
    sha, parents, date, message = header.split('\x1f', 3)
    text = message + '\n' + paths
    axes = [axis for axis, regex in patterns.items() if re.search(regex, text, re.I)]
    counts.update(axes)
    records.append({'sha': sha, 'parents': parents.split(), 'date': date,
                    'subject': message.strip().splitlines()[0], 'message': message.strip(),
                    'paths': paths.strip().splitlines(), 'candidate_axes': axes,
                    'review_level': 'metadata_scanned; patch_semantics_not_certified'})
(OUT / 'context-all-commit-metadata.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in records), encoding='utf-8')
summary = {'commits': len(records), 'candidate_axis_counts_nonexclusive': dict(counts),
           'scope': 'Every available commit message and changed-path list processed. Keyword axes are navigation, not evidence of code correctness. Semantic review is limited to explicitly cited paths/diffs in SCIENTIFIC_CONTEXT.md.'}
(OUT / 'context-history-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary))
