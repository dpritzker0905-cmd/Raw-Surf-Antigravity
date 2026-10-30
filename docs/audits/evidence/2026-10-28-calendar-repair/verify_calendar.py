"""Run with backend venv Python -B. Actual calendar route, synthetic DB seam.
No server, event loop, provider, real data or authentication is exercised.
Python socket guards are in-process, not an OS firewall.
"""
import os, socket, sys, types
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace as NS
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear(); os.environ.update(keep)
os.environ.update(PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*args,**kwargs): raise RuntimeError('Network disabled for calendar regression')
socket.socket.connect=blocked; socket.socket.connect_ex=blocked; socket.create_connection=blocked
backend=Path(__file__).resolve().parents[4]/'backend'; sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *args,**kwargs:False
for name,folder in [('routes',backend/'routes'),('routes.photographer',backend/'routes'/'photographer')]:
    module=types.ModuleType(name); module.__path__=[str(folder)]; sys.modules[name]=module
from routes.photographer.availability import get_photographer_bookings_calendar
class Result:
    def __init__(self,value): self.value=value
    def scalar_one_or_none(self): return self.value
    def scalars(self): return self
    def all(self): return self.value
class Database:
    def __init__(self,bookings): self.results=iter([NS(id='synthetic-photographer'),bookings,[],[]])
    async def execute(self,statement): return Result(next(self.results))
def booking(identifier,statuses):
    return NS(id=identifier,participants=[NS(status=s) for s in statuses],session_date=datetime(2026,11,2,9,tzinfo=timezone.utc),status='Confirmed',location='Synthetic beach',duration=60,creator=None)
def check(rows,expected):
    co=get_photographer_bookings_calendar('synthetic-photographer','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z',Database(rows))
    try: yielded=co.send(None)
    except StopIteration as done: response=done.value
    else:
        co.close(); raise AssertionError(f'Unexpected asynchronous I/O: {yielded!r}')
    actual=[(r['id'],r['current_participants']) for r in response['bookings']]
    assert actual==expected,(actual,expected)
    assert len(response['availability_windows'])==7 and response['blocked_dates']==[]
cases=[
('empty first',[booking('empty',[])],[('empty',0)]),
('mixed then empty',[booking('mixed',['pending','confirmed','cancelled']),booking('empty',[])],[('mixed',2),('empty',0)]),
('empty then mixed',[booking('empty',[]),booking('mixed',['confirmed','cancelled'])],[('empty',0),('mixed',1)]),
('cancelled only',[booking('cancelled',['cancelled'])],[('cancelled',0)]),
('no bookings',[],[])]
failures=[]
for name,rows,expected in cases:
    try: check(rows,expected)
    except Exception as error:
        failures.append(name); print(f'FAIL {name}: {type(error).__name__}: {error}')
    else: print(f'PASS {name}')
print(f'{len(cases)-len(failures)}/{len(cases)} calendar cases passed')
raise SystemExit(bool(failures))
