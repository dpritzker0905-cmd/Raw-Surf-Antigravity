"""Index all locally recoverable commit history; no source or ref mutations."""
import collections
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / 'commit-history'
OUT.mkdir(exist_ok=True)


def git(*args):
    return subprocess.check_output(['git', '-c', 'core.quotepath=false', *args], cwd=ROOT).decode('utf-8', 'replace')


reachable = set(git('rev-list', '--all').splitlines())
dev = set(git('rev-list', 'origin/dev').splitlines())
main = set(git('rev-list', 'origin/main').splitlines())
raw = git('log', '--all', '--reflog', '--reverse', '--topo-order', '--name-status',
          '--format=%x1e%H%x1f%P%x1f%aI%x1f%cI%x1f%an%x1f%D%x1f%B%x1d')
weather_path = re.compile(r'weather|marine|swell|forecast|buoy|zoomlab|ci_floor|components/map/|\.github/workflows/ci.yml', re.I)
records = []
for block in raw.split('\x1e')[1:]:
    header, paths = block.split('\x1d', 1)
    sha, parents, authored, committed, author, refs, message = header.split('\x1f', 6)
    changes = [line.split('\t') for line in paths.strip().splitlines() if line]
    candidate = any(weather_path.search(path) for change in changes for path in change[1:])
    records.append({'sha': sha, 'parents': parents.split(), 'authored_at': authored,
                    'committed_at': committed, 'author': author, 'tip_refs': refs,
                    'subject': message.strip().splitlines()[0] if message.strip() else '',
                    'message': message.strip(), 'changes': changes,
                    'weather_path_candidate': candidate, 'reachable_from_refs': sha in reachable,
                    'in_dev': sha in dev, 'in_main': sha in main})
for name, selected in [('all-commits.jsonl', records),
                       ('weather-path-commits.jsonl', [r for r in records if r['weather_path_candidate']])]:
    (OUT / name).write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in selected), encoding='utf-8')
refs = git('for-each-ref', '--format=%(refname) %(objectname)')
(OUT / 'refs.txt').write_text(refs, encoding='utf-8')
summary = {'indexed_commits': len(records), 'reachable_commits': len(reachable),
           'reflog_only_commits': sum(not r['reachable_from_refs'] for r in records),
           'weather_path_candidates': sum(r['weather_path_candidate'] for r in records),
           'dev_commits': len(dev), 'main_commits': len(main),
           'root_commits': [r['sha'] for r in records if not r['parents']],
           'author_date_range': [min(r['authored_at'] for r in records), max(r['authored_at'] for r in records)],
           'commit_date_range': [min(r['committed_at'] for r in records), max(r['committed_at'] for r in records)],
           'months': dict(sorted(collections.Counter(r['committed_at'][:7] for r in records).items())),
           'current_head': git('rev-parse', 'HEAD').strip(),
           'coverage_limit': 'All fetched refs plus available local reflogs. Deleted/unreachable server commits, other machines and expired reflogs are not guaranteed. Weather filter is a candidate index, not semantic certification.',
           'ordering': 'Reverse topological, not inferred causal order from author timestamps.'}
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
(OUT / 'SHA256.json').write_text(json.dumps({f.name: hashlib.sha256(f.read_bytes()).hexdigest()
                                           for f in OUT.iterdir() if f.name != 'SHA256.json'}, indent=2))
print(json.dumps(summary, indent=2))
