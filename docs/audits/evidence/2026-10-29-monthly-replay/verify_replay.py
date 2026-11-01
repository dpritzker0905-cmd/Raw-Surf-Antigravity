"""Monthly archive replay/atomicity tests: real storage, no scheduler startup."""
import sys,importlib.util,types,ast,time
from pathlib import Path
EVIDENCE=Path(__file__).resolve().parent
previous=EVIDENCE.parent/'2026-10-29-monthly-leaderboard-trophies/verify_monthly.py'
arguments=sys.argv[:];sys.argv=[arg for arg in arguments if arg!='--baseline']
spec=importlib.util.spec_from_file_location('retained_monthly_fixture',previous);lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib);sys.argv=arguments
ROOT=lib.ROOT;database=lib.database;loop=lib.loop;asyncio=lib.asyncio;json=lib.json;logging=lib.logging
Profile=lib.Profile;ImpactLedger=lib.ImpactLedger;LeaderboardSnapshot=lib.LeaderboardSnapshot;AsyncSession=lib.AsyncSession;select=lib.select;delete=lib.delete;event=lib.event;text=lib.text;IntegrityError=lib.IntegrityError
from models import MonthlyLeaderboardArchive,ScheduledJobStatus
leaderboard=lib.leaderboard
if '--baseline' in sys.argv:exec(compile((EVIDENCE/'baseline_leaderboard.py').read_text(encoding='utf-8-sig'),'baseline_leaderboard','exec'),leaderboard.__dict__);leaderboard.datetime=lib.FrozenDateTime
package=types.ModuleType('scheduler');package.__path__=[str(ROOT/'backend/scheduler')];sys.modules['scheduler']=package
if '--baseline' in sys.argv:
    gamification=types.ModuleType('scheduler.gamification');sys.modules['scheduler.gamification']=gamification
    exec(compile((EVIDENCE/'baseline_gamification.py').read_text(encoding='utf-8-sig'),'baseline_gamification','exec'),gamification.__dict__)
else:
    from scheduler import gamification
_original_reset=lib.reset
RESULTS=[];OBSERVATIONS={}
async def initialize():
    await lib.initialize()
    async with database.engine.begin() as conn:
        await conn.run_sync(lambda sync:MonthlyLeaderboardArchive.__table__.create(sync,checkfirst=True));await conn.run_sync(lambda sync:ScheduledJobStatus.__table__.create(sync,checkfirst=True))
        if lib.fixture_url:
            rows=(await conn.execute(text("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='monthly_leaderboard_archives'"))).all();columns={r[0]:(r[1],r[2]) for r in rows};assert columns['completed_at'][0]=='timestamp with time zone' and columns['archived_count'][1]=='NO';OBSERVATIONS['native_marker_schema']={k:list(v) for k,v in columns.items()}
async def reset():
    lib.NOW=lib.RealDateTime(2026,1,1,tzinfo=lib.timezone.utc)
    async with database.AsyncSessionLocal() as db:
        await db.execute(delete(MonthlyLeaderboardArchive));await db.execute(delete(ScheduledJobStatus));await db.commit()
    await _original_reset()
async def state():
    async with database.AsyncSessionLocal() as db:
        markers=(await db.execute(select(MonthlyLeaderboardArchive).order_by(MonthlyLeaderboardArchive.year,MonthlyLeaderboardArchive.month))).scalars().all();snapshots=(await db.execute(select(LeaderboardSnapshot).order_by(LeaderboardSnapshot.year,LeaderboardSnapshot.month,LeaderboardSnapshot.rank,LeaderboardSnapshot.photographer_id,LeaderboardSnapshot.id))).scalars().all();profiles=(await db.execute(select(Profile).order_by(Profile.id))).scalars().all()
        return dict(markers=[dict(year=r.year,month=r.month,count=r.archived_count,completed_at=r.completed_at.isoformat() if r.completed_at else None) for r in markers],snapshots=[dict(id=r.id,year=r.year,month=r.month,photographer_id=r.photographer_id,rank=r.rank,total=r.monthly_total,award=r.earned_grom_guardian) for r in snapshots],badges={p.id:p.badges for p in profiles},ledger_count=len((await db.execute(select(ImpactLedger.id))).all()))
async def complete(raw='[]'):
    people,m,y=await lib.seed(raw);answer=await lib.finalize();assert answer==dict(archived=12,month=m,year=y);await lib.awards(people,m,y,raw);data=await state();assert len(data['markers'])==1 and data['markers'][0]['count']==12 and data['markers'][0]['completed_at'];return people,m,y,answer
async def late_ledger(month,year):
    identity=str(lib.uuid.uuid4())
    async with database.AsyncSessionLocal() as db:
        db.add(Profile(id=identity,user_id=identity,email=identity+'@example.invalid',full_name='Fictional late entry',role=lib.RoleEnum.PHOTOGRAPHER,badges='["late-existing"]'));await db.flush();db.add(ImpactLedger(photographer_id=identity,recipient_type='cause',amount=5000,source_type='fictional_fixture',month=month,year=year));await db.commit()
    return identity
async def first_complete():await complete('["existing-id"]')
async def replay(late=False):
    people,m,y,answer=await complete()
    if late:await late_ledger(m,y)
    before=await state();assert await lib.finalize()==answer;assert await state()==before,'Replay mutated archived rows, badges or completion marker'
async def empty_replay():
    answer=dict(archived=0,month=12,year=2025);assert await lib.finalize()==answer;data=await state();assert len(data['markers'])==1 and data['markers'][0]['count']==0,'Empty period was not recorded';await late_ledger(12,2025);before=await state();assert await lib.finalize()==answer and await state()==before,'Empty completion was reopened by late ledger'
async def expect_review(before,fragment):
    async with database.AsyncSessionLocal() as db:
        try:await leaderboard.monthly_leaderboard_reset(db)
        except ValueError as error:assert fragment in str(error)
        else:raise AssertionError('Inconsistent historical archive must require review')
        assert not db.in_transaction(),'Review error did not roll back'
    assert await state()==before,'Review path mutated historical data'
async def premarker(full):
    people,m,y=await lib.seed('[]')
    async with database.AsyncSessionLocal() as db:
        for index,identity in enumerate(people if full else people[:1],1):db.add(LeaderboardSnapshot(photographer_id=identity,month=m,year=y,monthly_total=1000-(index-1)*30,rank=index,earned_grom_guardian=index<=10))
        await db.commit()
    await expect_review(await state(),'snapshots have no completion record')
async def marker_mismatch(delete_snapshot):
    if delete_snapshot:
        people,m,y,_=await complete()
        async with database.AsyncSessionLocal() as db:
            row=(await db.execute(select(LeaderboardSnapshot).where(LeaderboardSnapshot.photographer_id==people[0]))).scalar_one();await db.delete(row);await db.commit()
    else:
        await lib.seed('[]')
        async with database.AsyncSessionLocal() as db:db.add(MonthlyLeaderboardArchive(year=2025,month=12,archived_count=12,completed_at=lib.NOW));await db.commit()
    await expect_review(await state(),'snapshot count mismatch')
async def other_period_scope():
    people,m,y=await lib.seed('[]')
    async with database.AsyncSessionLocal() as db:db.add(LeaderboardSnapshot(photographer_id=people[0],month=m,year=y-1,monthly_total=777,rank=1,earned_grom_guardian=False));await db.commit()
    assert await lib.finalize()==dict(archived=12,month=m,year=y);before=await state();assert len(before['snapshots'])==13;assert await lib.finalize()==dict(archived=12,month=m,year=y) and await state()==before
async def malformed_rollback():
    await lib.seed('[]',bad_index='not-json');before=await state()
    try:await lib.finalize()
    except ValueError:pass
    else:raise AssertionError('Malformed badges must fail')
    assert await state()==before and not (await state())['markers'],'Failed run left marker/partial archives'
async def rollback_retry(constraint):
    people,m,y=await lib.seed('[]');before=await state()
    class Fault(AsyncSession):
        async def commit(self):
            if not constraint:raise RuntimeError('Synthetic pre-commit failure')
            return await super().commit()
    async with Fault(bind=database.engine,expire_on_commit=False,autoflush=False) as db:
        if constraint:
            def invalidate(session,*args):
                for row in session.new:
                    if isinstance(row,LeaderboardSnapshot):row.month=None;break
            event.listen(db.sync_session,'before_flush',invalidate,once=True)
        try:await leaderboard.monthly_leaderboard_reset(db)
        except (IntegrityError if constraint else RuntimeError):pass
        else:raise AssertionError('Injected failure missing')
        assert not db.in_transaction(),'Failed run did not explicitly roll back'
    assert await state()==before,'Failed run persisted marker or partial work';await lib.finalize();await lib.awards(people,m,y,'[]');assert (await state())['markers'][0]['count']==12
async def distinct_months():
    await complete();lib.NOW=lib.RealDateTime(2026,2,1,tzinfo=lib.timezone.utc);assert await lib.finalize()==dict(archived=12,month=1,year=2026);data=await state();assert [(m['year'],m['month'],m['count']) for m in data['markers']]==[(2025,12,12),(2026,1,12)];assert len(data['snapshots'])==24;before=await state();await lib.finalize();assert await state()==before
async def task_propagates():
    await lib.seed('[]',bad_index='not-json');before=await state()
    try:await gamification.monthly_leaderboard_reset_task()
    except ValueError:pass
    else:raise AssertionError('Monthly task swallowed failure')
    assert await state()==before

def tracked_wrapper():
    tree=ast.parse((ROOT/'backend/scheduler/base.py').read_text(encoding='utf-8-sig'));nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in ('_run_tracked_job','tracked')];assert len(nodes)==2;namespace=dict(asyncio=asyncio,logger=logging.getLogger('fixture-tracked'),_time=time,datetime=lib.FrozenDateTime,timezone=lib.timezone,scheduler=types.SimpleNamespace(get_job=lambda name:None));exec(compile(ast.Module(body=nodes,type_ignores=[]),'actual-tracked-extraction','exec'),namespace);return namespace['tracked']
async def tracked_retry(disabled):
    people,m,y=await lib.seed('[]',bad_index='not-json' if not disabled else None);before=await state();job='monthly_leaderboard_reset'
    if disabled:
        async with database.AsyncSessionLocal() as db:db.add(ScheduledJobStatus(job_name=job,is_enabled=False,last_run_status='unknown'));await db.commit()
    invoke=tracked_wrapper()(job,'Fictional monthly archive','Monthly 00:05 UTC',gamification.monthly_leaderboard_reset_task);await invoke()
    if disabled:
        assert await state()==before
        async with database.AsyncSessionLocal() as db:row=(await db.execute(select(ScheduledJobStatus))).scalar_one();assert row.last_run_status=='unknown' and row.total_runs==0
        return
    async with database.AsyncSessionLocal() as db:row=(await db.execute(select(ScheduledJobStatus))).scalar_one();assert row.last_run_status=='failed' and row.failure_count==row.total_runs==1,'Tracked status missed task failure'
    assert await state()==before
    async with database.AsyncSessionLocal() as db:profile=await db.get(Profile,people[1]);profile.badges='[]';await db.commit()
    await invoke();await lib.awards(people,m,y,'[]');first=await state();await invoke();assert await state()==first
    async with database.AsyncSessionLocal() as db:row=(await db.execute(select(ScheduledJobStatus))).scalar_one();assert row.last_run_status=='success' and row.total_runs==3 and row.failure_count==1 and row.success_count==2 and row.last_run_error is None
    OBSERVATIONS['tracked_retry']=dict(total=3,successes=2,failures=1,replay_unchanged=True)
async def concurrency(rollback_winner):
    people,m,y=await lib.seed('[]');ready=asyncio.Event();release=asyncio.Event();second_attempt=asyncio.Event();second_pid=None;claims=[];receipt=None
    class Held(AsyncSession):
        async def commit(self):
            ready.set();await release.wait()
            if rollback_winner:raise RuntimeError('Synthetic winning transaction failure')
            return await super().commit()
    async def second_run():
        nonlocal second_pid
        async with database.AsyncSessionLocal() as db:second_pid=(await db.execute(text('SELECT pg_backend_pid()'))).scalar_one();return await leaderboard.monthly_leaderboard_reset(db)
    def observe(conn,cursor,statement,parameters,context,many):
        if 'INSERT' in statement.upper() and 'monthly_leaderboard_archives' in statement:
            claims.append(statement)
            if len(claims)==2:second_attempt.set()
    event.listen(database.engine.sync_engine,'before_cursor_execute',observe);first=asyncio.create_task(lib.finalize(Held));second=None
    try:
        await asyncio.wait_for(ready.wait(),5);second=asyncio.create_task(second_run());await asyncio.wait_for(second_attempt.wait(),5);deadline=time.monotonic()+2
        async with database.AsyncSessionLocal() as observer:
            while time.monotonic()<deadline:
                row=(await observer.execute(text('SELECT a.wait_event_type, EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND NOT l.granted) FROM pg_stat_activity a WHERE a.pid=:pid'),dict(pid=second_pid))).one_or_none()
                if row and row[0]=='Lock' and row[1]:receipt=dict(wait_event_type=row[0],ungranted_lock=True);break
                await asyncio.sleep(0.02)
        assert receipt,'Native PostgreSQL unique-claim lock wait absent';release.set();answers=await asyncio.wait_for(asyncio.gather(first,second,return_exceptions=True),10);expected=dict(archived=12,month=m,year=y);assert answers[1]==expected
        if rollback_winner:assert isinstance(answers[0],RuntimeError)
        else:assert answers[0]==expected
        await lib.awards(people,m,y,'[]');data=await state();assert len(data['markers'])==1 and data['markers'][0]['count']==12;assert all('ON CONFLICT (year, month) DO NOTHING' in statement for statement in claims),'Claim conflict target drifted';OBSERVATIONS['concurrency_rollback' if rollback_winner else 'concurrency_commit']=dict(actual_pg_wait=receipt,single_marker=True,single_award_per_winner=True,waiter_completed=True)
    finally:release.set();await asyncio.gather(first,*([second] if second else []),return_exceptions=True);event.remove(database.engine.sync_engine,'before_cursor_execute',observe)
async def check(name,fn):
    try:await reset();await fn();RESULTS.append(dict(name=name,passed=True))
    except Exception as error:RESULTS.append(dict(name=name,passed=False,error_type=type(error).__name__,detail='Database operation failed; parameters omitted' if hasattr(error,'statement') else str(error)[:180]))
async def main():
    try:
        await initialize()
        for name,fn in [('first_completion_marker',first_complete),('stable_replay',lambda:replay(False)),('late_ledger_replay',lambda:replay(True)),('empty_completion_late_ledger',empty_replay),('premarker_partial_requires_review',lambda:premarker(False)),('premarker_full_requires_review',lambda:premarker(True)),('marker_missing_snapshots_requires_review',lambda:marker_mismatch(False)),('deleted_snapshot_requires_review',lambda:marker_mismatch(True)),('other_period_scope',other_period_scope),('malformed_rollback_no_marker',malformed_rollback),('commit_failure_retry',lambda:rollback_retry(False)),('constraint_failure_retry',lambda:rollback_retry(True)),('distinct_month_claims',distinct_months),('task_error_propagates',task_propagates),('tracked_failure_retry_replay',lambda:tracked_retry(False)),('tracked_disabled_skips',lambda:tracked_retry(True))]:await check(name,fn)
        if lib.fixture_url:
            await check('pg_concurrent_winner_commit',lambda:concurrency(False));await check('pg_concurrent_winner_rollback',lambda:concurrency(True))
    finally:await database.engine.dispose()
    passed=sum(r['passed'] for r in RESULTS);print(json.dumps(dict(passed=passed,total=len(RESULTS),baseline='--baseline' in sys.argv,database='isolated PostgreSQL' if lib.fixture_url else 'isolated SQLite',actual_async_session=True,native_types=True,normal_startup=False,scheduler_started=False,external_connections=False,pg_concurrency_exercised=bool(lib.fixture_url),results=RESULTS,observations=OBSERVATIONS),indent=2));return 0 if passed==len(RESULTS) else 1
async def prior_suite():
    await initialize();lib.reset=reset;return await lib.main()
if __name__=='__main__':sys.exit(loop.run_until_complete(prior_suite() if '--prior-suite' in sys.argv else main()))
