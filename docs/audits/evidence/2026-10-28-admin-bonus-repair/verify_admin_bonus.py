"""Actual admin pricing handlers, synthetic admin and disposable SQLite only.
No HTTP/authentication/provider/async PostgreSQL. Socket guards are not an OS firewall.
Run backend venv Python -B; --baseline loads the original tracked handler module.
"""
import os, sys, socket, types, json, subprocess
from pathlib import Path
from copy import deepcopy
from types import SimpleNamespace as NS
keep={k:os.environ[k] for k in ('SYSTEMROOT','WINDIR','TEMP','TMP','PATH') if k in os.environ}
os.environ.clear();os.environ.update(keep)
os.environ.update(PYTHON_DOTENV_DISABLED='1',PYDANTIC_DISABLE_PLUGINS='__all__',TESTING='1',DATABASE_URL='sqlite+aiosqlite:///:memory:')
sys.dont_write_bytecode=True
def blocked(*a,**k):raise RuntimeError('External connection disabled')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=blocked
root=Path(__file__).resolve().parents[4];backend=root/'backend';sys.path.insert(0,str(backend))
import dotenv
dotenv.load_dotenv=lambda *a,**k:False
for name,folder in [('routes',backend/'routes'),('routes.commerce',backend/'routes/commerce')]:
 m=types.ModuleType(name);m.__path__=[str(folder)];sys.modules[name]=m
from sqlalchemy import create_engine,select
from sqlalchemy.orm import Session
from models import Profile,RoleEnum,GlobalPricingConfig
if '--baseline' in sys.argv:
 source=subprocess.check_output(['git','show','HEAD:backend/routes/commerce/pricing_config.py'],cwd=root,text=True,encoding='utf-8')
 routes=types.ModuleType('routes.commerce.pricing_config');routes.__file__=str(backend/'routes/commerce/pricing_config.py');exec(compile(source,routes.__file__,'exec'),routes.__dict__)
else:
 from routes.commerce import pricing_config as routes
engine=create_engine('sqlite:///:memory:')
for model in (Profile,GlobalPricingConfig):model.__table__.create(engine)
session=Session(engine,expire_on_commit=False)
class Adapter:
 async def execute(self,*a,**k):return session.execute(*a,**k)
 def add(self,*a,**k):return session.add(*a,**k)
 async def commit(self):return session.commit()
 async def refresh(self,*a,**k):return session.refresh(*a,**k)
 async def rollback(self):return session.rollback()
db=Adapter();admin=NS(id='synthetic-admin')
def drive(co):
 try:v=co.send(None)
 except StopIteration as done:return done.value
 else:co.close();raise AssertionError(f'Unexpected asynchronous I/O {v}')
checks=0
try:
 session.add(Profile(id=admin.id,user_id=admin.id,email='admin@example.invalid',role=RoleEnum.SURFER,full_name='Synthetic admin'));session.commit()
 expected={'10':0,'25':0,'50':5,'100':15}
 initial=drive(routes.admin_get_pricing_config(admin,db))
 assert initial.get('credit_package_bonuses')==expected,initial.get('credit_package_bonuses')
 assert session.query(GlobalPricingConfig).count()==0
 checks+=1;print('PASS defaults read without seeding')
 original_defaults=deepcopy(routes.DEFAULT_PRICING_DATA)
 data=routes.PricingConfigUpdate(credit_package_bonuses={'50':0,'100':20})
 first=drive(routes.admin_update_pricing_config(admin,data,db));first_config=session.execute(select(GlobalPricingConfig).where(GlobalPricingConfig.version==1)).scalar_one()
 assert first['credit_package_bonuses']=={'10':0,'25':0,'50':0,'100':20}
 assert drive(routes.admin_get_pricing_config(admin,db))['credit_package_bonuses']==first['credit_package_bonuses']
 checks+=1;print('PASS explicit zero and partial map readback')
 first_pricing=deepcopy(first_config.pricing_data)
 second=drive(routes.admin_update_pricing_config(admin,routes.PricingConfigUpdate(surfer={'tiers':{'tier_2':{'price':17}}}),db))
 assert second['credit_package_bonuses']==first['credit_package_bonuses']
 assert first_config.pricing_data==first_pricing and routes.DEFAULT_PRICING_DATA==original_defaults
 assert second['pricing']['surfer']['tiers']['tier_2']['price']==17
 checks+=1;print('PASS unrelated save preserves bonus and old snapshot/defaults')
 reset=drive(routes.admin_reset_pricing_config(admin,db))
 assert reset['credit_package_bonuses']==expected and reset['pricing']==original_defaults
 assert first_config.credit_package_bonuses=={'10':0,'25':0,'50':0,'100':20}
 checks+=1;print('PASS reset restores defaults without historical mutation')
 history=drive(routes.admin_get_pricing_history(admin,10,db))['history']
 assert len(history)==3 and history[0]['credit_package_bonuses']==expected
 audit=drive(routes.get_pricing_audit_log(admin,50,db))['audit_log']
 changes=[c for row in audit for c in row['changes'] if c['type']=='credit_bonus_change']
 assert any(c['package_amount']=='50' and c['old_bonus']==0 and c['new_bonus']==5 for c in changes)
 checks+=1;print('PASS version history and bonus audit details')
 with Session(engine) as readback:
  active=readback.execute(select(GlobalPricingConfig).where(GlobalPricingConfig.is_active==True)).scalar_one()
  assert active.credit_package_bonuses==expected
  assert readback.execute(select(GlobalPricingConfig).where(GlobalPricingConfig.version==1)).scalar_one().credit_package_bonuses['50']==0
 checks+=1;print('PASS persisted independent-session snapshots')
 print(f'{checks}/6 admin bonus cases passed')
finally:session.close();engine.dispose()
