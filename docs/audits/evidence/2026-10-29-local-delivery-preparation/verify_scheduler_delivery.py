"""Replay only the actual weekly registration AST; never import/start scheduler."""
import ast
import json
from pathlib import Path
from datetime import datetime, timezone
from apscheduler.triggers.cron import CronTrigger
from pydantic import BaseModel
from typing import List, Union
R=Path(__file__).resolve().parents[4]
E=R/'docs/audits/evidence/2026-10-29-weekly-challenge-trophies'
checks={}
def check(name, value): checks[name]=bool(value)
source=(R/'backend/scheduler/__init__.py').read_text(encoding='utf-8')
tree=ast.parse(source)
start=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='start_scheduler')
def ident(n):
 if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call):
  for k in n.value.keywords:
   if k.arg=='id' and isinstance(k.value,ast.Constant): return k.value.value
nodes=[n for n in start.body if ident(n)=='weekly_challenge_finalize']
check('exactly_one_weekly_registration',len(nodes)==1)
base=ast.parse((E/'backend__scheduler____init__.py.baseline').read_text(encoding='utf-8'))
bstart=next(n for n in base.body if isinstance(n,ast.FunctionDef) and n.name=='start_scheduler')
check('all_preexisting_start_body_AST_unchanged',[ast.dump(n) for n in start.body if ident(n)!='weekly_challenge_finalize']==[ast.dump(n) for n in bstart.body])
check('actual_domain_task_import',any(isinstance(n,ast.ImportFrom) and n.module=='gamification' and any(a.name=='weekly_challenge_finalize_task' for a in n.names) for n in tree.body))
class Registry:
 def __init__(self): self.jobs={};self.calls=0
 def add_job(self,fn,trigger,**kwargs):
  self.calls+=1
  assert kwargs['replace_existing'] is True
  self.jobs[kwargs['id']]=(fn,trigger,kwargs)
registry=Registry()
async def domain(): pass
def tracked(*args):
 check('tracked_metadata_matches_registration',args[:3]==('weekly_challenge_finalize','Finalize weekly challenge trophies','Weekly (Mon 00:05 UTC)'))
 check('actual_task_symbol_bound',args[3] is domain)
 return args[3]
env=dict(scheduler=registry,tracked=tracked,CronTrigger=CronTrigger,timezone=timezone,weekly_challenge_finalize_task=domain)
if nodes:
 code=compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'actual-registration','exec')
 exec(code,env);exec(code,env)
 check('repeat_replaces_same_job',registry.calls==2 and len(registry.jobs)==1)
 fn,trigger,kw=registry.jobs['weekly_challenge_finalize']
 check('process_overlap_and_coalescing',kw['max_instances']==1 and kw['coalesce'] is True)
 for now,expected in [('2020-12-31T23:59:59+00:00','2021-01-04T00:05:00+00:00'),('2026-03-08T12:00:00+00:00','2026-03-09T00:05:00+00:00'),('2026-11-01T12:00:00+00:00','2026-11-02T00:05:00+00:00'),('2026-10-26T00:05:01+00:00','2026-11-02T00:05:00+00:00')]:
  check('UTC_fire_'+now,trigger.get_next_fire_time(None,datetime.fromisoformat(now)).isoformat()==expected)
 schema=ast.parse((R/'backend/routes/photographer/schemas.py').read_text(encoding='utf-8'))
 cls=next(n for n in schema.body if isinstance(n,ast.ClassDef) and n.name=='PhotographerStatsResponse')
 ns=dict(BaseModel=BaseModel,List=List,Union=Union)
 exec(compile(ast.fix_missing_locations(ast.Module(body=[cls],type_ignores=[])),'actual-stats-schema','exec'),ns)
 trophy={'type':'weekly_champion','rank':1,'week':53,'year':2020,'emoji':'medal'}
 values=['first_responder',trophy]
 result=ns['PhotographerStatsResponse'](badges=values).model_dump()
 check('mixed_badges_preserved_and_countable',result['badges']==values and len(result['badges'])==2)
 bsource=ast.parse((E/'backend__scheduler__gamification.py.baseline').read_text(encoding='utf-8'))
 final=ast.parse((R/'backend/scheduler/gamification.py').read_text(encoding='utf-8'))
 old=next(n for n in bsource.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='monthly_leaderboard_reset_task')
 new=next(n for n in final.body if isinstance(n,ast.AsyncFunctionDef) and n.name==old.name)
 check('monthly_callback_reraises_failure',any(isinstance(n,ast.ExceptHandler) and any(isinstance(v,ast.Raise) and v.exc is None for v in n.body) for n in ast.walk(new)))
print(json.dumps(dict(passed=sum(checks.values()),total=len(checks),checks=checks,normal_scheduler_startup=False,normal_backend_startup=False),indent=2))
raise SystemExit(0 if all(checks.values()) else 1)
