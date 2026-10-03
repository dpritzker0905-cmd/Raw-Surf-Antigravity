"""Filename/description changes cannot establish image evidence or account authority."""
import sys, types, asyncio
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from services import ai_identity_matching as matching
from core.security import create_access_token
from database import get_db

@pytest.fixture(autouse=True)
def forbid_heuristic_evidence(monkeypatch):
    import cloudinary_mcp_server as real
    calls=[]
    def classify(*args,**kwargs):
        calls.append('classify');return real.classify_and_tag_surf_photo(*args,**kwargs)
    def cdn(*args,**kwargs):
        calls.append('cdn');return real.generate_cloudinary_url(*args,**kwargs)
    monkeypatch.setitem(sys.modules, 'cloudinary_mcp_server', types.SimpleNamespace(
        classify_and_tag_surf_photo=classify, generate_cloudinary_url=cdn))
    return calls

@pytest.mark.parametrize('filename', ['wave-action.jpg', 'portrait-face.jpg', 'blue-surfboard.jpg', 'unrelated.jpg'])
@pytest.mark.parametrize('description', [None, 'blue surfboard black wetsuit'])
def test_no_filename_or_description_can_create_an_identity_match(filename, description, forbid_heuristic_evidence):
    profile=matching.SurferProfile(board_description=description, wetsuit_description=description)
    result=asyncio.run(matching.analyze_image_for_surfer('https://images.example.invalid/'+filename, profile))
    assert result.is_match is False and result.confidence==0 and result.match_methods==[]
    assert result.details['analysis_status']=='unavailable'
    assert result.details['requires_confirmation'] is True
    assert forbid_heuristic_evidence==[]

def test_fallback_never_turns_failure_into_a_match():
    result=matching._fallback_match()
    assert result.is_match is False and result.confidence==0 and result.match_methods==[]

@pytest.mark.parametrize('urls', [[], ['https://images.example.invalid/wave.jpg', 'https://images.example.invalid/board.jpg']])
def test_batch_preserves_urls_and_unavailability_without_false_matches(urls):
    results=asyncio.run(matching.batch_analyze_session_photos(urls,matching.SurferProfile()))
    assert [r['photo_url'] for r in results]==urls
    assert all(not r['is_match'] and r['confidence']==0 and r['details']['analysis_status']=='unavailable' for r in results)

@pytest.mark.parametrize('description', ['blue surfboard', 'wetsuit', '', 'wave riding'])
def test_board_description_is_not_visual_evidence(description, forbid_heuristic_evidence):
    result=asyncio.run(matching.compare_board_colors('https://images.example.invalid/blue-board.jpg',description))
    assert result['match'] is False and result['confidence']==0
    assert result['analysis_status']=='unavailable' and result['observed'] is None
    assert forbid_heuristic_evidence==[]

@pytest.mark.parametrize('route', ['gallery','single','batch'])
@pytest.mark.parametrize('actor,status', [(None,401),('invalid',401),('other',403),('owner',503)])
def test_account_boundary_and_unavailability_precede_database_and_claim_writes(route, actor, status):
    from routes.gallery import gallery_find_me as gallery
    from routes.surfer_gallery_review_pkg import ai_matching as ai
    app=FastAPI();app.include_router(gallery.router,prefix='/api');app.include_router(ai.router,prefix='/api')
    touched=[]
    class ForbiddenDB:
        async def execute(self,*args,**kwargs):
            touched.append('execute');raise AssertionError('No profile or gallery read before authority/capability')
        def add(self,*args):touched.append('add');raise AssertionError('No synthetic claim')
        async def commit(self):touched.append('commit');raise AssertionError('No scan charge')
    async def db():yield ForbiddenDB()
    app.dependency_overrides[get_db]=db
    headers={} if actor is None else {'Authorization': 'Bearer '+('invalid' if actor=='invalid' else create_access_token({'sub':actor}))}
    if route=='gallery':url='/api/gallery/gallery-id/find-me?user_id=owner';body={'selfie_url':'https://images.example.invalid/selfie.jpg'}
    elif route=='single':url='/api/surfer-gallery/ai-analyze-photo?surfer_id=owner&photo_url=https://images.example.invalid/wave.jpg';body=None
    else:url='/api/surfer-gallery/ai-batch-analyze?surfer_id=owner&session_id=session-id';body=None
    async def request():
        async with AsyncClient(transport=ASGITransport(app=app,raise_app_exceptions=False),base_url='http://test') as c:return await c.post(url,json=body,headers=headers)
    response=asyncio.run(request());assert response.status_code==status
    assert touched==[]
    if status==503:assert 'review' in response.json()['detail'].lower()

def test_find_me_accepts_jwt_only_client_without_legacy_user_query():
    from routes.gallery import gallery_find_me as gallery
    app=FastAPI();app.include_router(gallery.router,prefix='/api')
    async def request():
        async with AsyncClient(transport=ASGITransport(app=app,raise_app_exceptions=False),base_url='http://test') as c:return await c.post('/api/gallery/gallery-id/find-me',json={'selfie_url':'https://images.example.invalid/selfie.jpg'},headers={'Authorization':'Bearer '+create_access_token({'sub':'owner'})})
    response=asyncio.run(request());assert response.status_code==503

@pytest.mark.parametrize('actor,status', [(None,401),('invalid',401),('other',403),('owner',200)])
def test_private_pending_sessions_are_owner_only_and_owner_read_still_works(actor,status):
    from routes.surfer_gallery_review_pkg import ai_matching as ai
    app=FastAPI();app.include_router(ai.router,prefix='/api');touched=[]
    class DB:
        async def execute(self,statement):
            assert 'owner' in statement.compile().params.values()
            touched.append('execute');return types.SimpleNamespace(scalars=lambda:types.SimpleNamespace(all=lambda:[]))
        def add(self,*args):raise AssertionError('Read cannot write claims')
        async def commit(self):raise AssertionError('Read cannot charge scans')
    async def db():yield DB()
    app.dependency_overrides[get_db]=db
    headers={} if actor is None else {'Authorization':'Bearer '+('invalid' if actor=='invalid' else create_access_token({'sub':actor}))}
    async def request():
        async with AsyncClient(transport=ASGITransport(app=app,raise_app_exceptions=False),base_url='http://test') as c:return await c.get('/api/surfer-gallery/ai-sessions?surfer_id=owner',headers=headers)
    response=asyncio.run(request());assert response.status_code==status
    assert touched==(['execute'] if status==200 else [])
    if status==200:assert response.json()=={'sessions':[],'total_pending':0}
