"""Independent Jan-4 calendar oracle; replay only the actual pure date helpers."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import ast,json,sys
ROOT=Path(__file__).resolve().parents[4]
path=Path(__file__).parent/'baseline_challenges.py' if '--baseline' in sys.argv else ROOT/'backend/routes/career_hub/challenges.py'
tree=ast.parse(path.read_text(encoding='utf-8-sig'));nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('get_week_dates','get_current_week')]
assert len(nodes)==2
class Clock(datetime):
    current=datetime(2021,1,1,12,tzinfo=timezone.utc)
    @classmethod
    def now(cls,tz=None):return cls.current.astimezone(tz) if tz else cls.current.replace(tzinfo=None)
ns={'datetime':Clock,'timedelta':timedelta,'timezone':timezone};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),ns)
checks=[]
for year in range(2015,2031):
    jan4=datetime(year,1,4,tzinfo=timezone.utc);monday=jan4-timedelta(days=jan4.weekday())
    next_jan4=datetime(year+1,1,4,tzinfo=timezone.utc);next_monday=next_jan4-timedelta(days=next_jan4.weekday())
    for week in range(1,(next_monday-monday).days//7+1):
        expected=monday+timedelta(weeks=week-1);end=expected+timedelta(days=6,hours=23,minutes=59,seconds=59)
        actual=ns['get_week_dates'](week,year);checks.append(actual==(expected,end))
keycases=[('2021-01-01T12:00:00+00:00',(53,2020)),('2018-12-31T12:00:00+00:00',(1,2019)),('2024-01-01T00:00:00+00:00',(1,2024)),('2027-01-03T23:59:59+00:00',(53,2026)),('2027-01-04T00:00:00+00:00',(1,2027))]
keys=[]
for stamp,expected in keycases:
    Clock.current=datetime.fromisoformat(stamp);keys.append(ns['get_current_week']()==expected)
result={'oracle':'Jan4 weekday anchor and independent hand-coded ISO-year boundary cases','helper_AST_replay':True,'normal_backend_startup':False,'week_checks_passed':sum(checks),'week_checks_total':len(checks),'key_checks_passed':sum(keys),'key_checks_total':len(keys),'baseline':'--baseline' in sys.argv};print(json.dumps(result,indent=2));assert len(checks)==835
raise SystemExit(0 if all(checks+keys) else 1)
