"""Synthetic loopback App integration server; never imports backend server or app environment."""
import ast,importlib.util,os,sys,json
from pathlib import Path
from fastapi import APIRouter,Request,FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[3]
os.environ['RAW_SUPPORT_FIXTURE_OUTPUT_DIR']=str(OUT/'.browser-data')
Path(os.environ['RAW_SUPPORT_FIXTURE_OUTPUT_DIR']).mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('synthetic_support',OUT.parent/'2026-10-29-support-delivery/verify-delivery.py')
f=importlib.util.module_from_spec(spec);sys.modules[spec.name]=f;spec.loader.exec_module(f)
f.TICKET='abcdef01-2345-4789-abcd-ef0123456789'
scope=dict(f.scope);scope.update(router=APIRouter(),get_db=f.get_db,get_current_user_id=f.identity)
tree=ast.parse((ROOT/'backend/routes/notifications/notifications.py').read_text())
allowed={'NotificationResponse','get_notifications','get_unread_notification_count','mark_notification_read','mark_all_notifications_read'}
tree.body=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom)) and not (isinstance(n,ast.ImportFrom) and n.module in ['database','core.security','models']) or isinstance(n,(ast.ClassDef,ast.AsyncFunctionDef)) and n.name in allowed]
exec(compile(tree,'actual_notification_handlers','exec'),scope)
f.app.include_router(scope['router']);app=FastAPI();app.mount('/api',f.app)
@app.on_event('startup')
async def startup():await f.seed()
@app.on_event('shutdown')
async def shutdown():await f.engine.dispose()
@app.post('/fixture/reset')
async def reset(request:Request):
 body=await request.json();await f.seed(email=body.get('email',True),push=body.get('push',True))
 return {'owner':f.OWNER,'other':f.OTHER,'staff':f.STAFF,'ticket':f.TICKET,'foreign':f.FOREIGN}
@app.get('/fixture/state')
async def state():
 snap=await f.snapshot();return {k:len(v) for k,v in snap.items()}
@app.post('/fixture/email')
async def email():
 snap=await f.snapshot()
 for row in snap['email_outbox']:await f.outbox.deliver_outbox_entry(row['id'],sender=f.sender,session_factory=f.factory)
 return {'messages':[{'subject':m.subject,'text':m.text,'html':m.html} for m,key in f.sender.messages]}
app.mount('/assets',StaticFiles(directory=OUT/'.browser'),name='assets')
@app.get('/{path:path}')
async def frontend(path:str):return FileResponse(OUT/'.browser/index.html')
if __name__=='__main__':
 import uvicorn
 uvicorn.run(app,host='127.0.0.1',port=int(sys.argv[1]),log_level='warning')
