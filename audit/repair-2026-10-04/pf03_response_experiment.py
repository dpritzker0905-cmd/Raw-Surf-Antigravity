"""Offline experiment only: actual route/framework and model serializers, synthetic builder."""
import asyncio
import faulthandler
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from time import perf_counter
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import Response
from services.weather_pipeline.schemas import GridVector


def finite_compatible(value):
    """Narrow experiment guard; unsupported shape uses the legacy serializer."""
    if value is None or isinstance(value, (str, bool, int)): return True
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError('Nonfinite JSON value')
        return True
    if isinstance(value, GridVector): return finite_compatible(value.__dict__)
    if isinstance(value, dict):
        return all(isinstance(k, str) and finite_compatible(v) for k,v in value.items())
    if isinstance(value, (list, tuple)): return all(finite_compatible(v) for v in value)
    return False


def guarded_response(payload, adapter):
    return Response(adapter.dump_json(payload),media_type='application/json') if finite_compatible(payload) else payload


def test_actual_route_response_cost_and_direct_serializer_parity():
    faulthandler.cancel_dump_traceback_later()
    from routes.weather import router
    base=datetime(2026,10,4,tzinfo=timezone.utc)
    def vectors_at(hour):
        return [GridVector(lat=20 + n//40 * 0.01, lng=-81 + n%40 * 0.01,
            speed=1.25 + n%71 * 0.031 + hour*0.001, direction=(n+hour)%360, period=None if n%17==0 else 8.4,
            is_valid=n%11!=0, dir_confidence=0.0 if n%13==0 else None) for n in range(1600)]
    payload = {'model':'GFS','domain':'marine','layer':'waves','frame_count':48,
        'frames':[{'hour_offset':n*3,'valid_time':(base+timedelta(hours=n*3)).strftime('%Y-%m-%dT%H:%M:%SZ'),'vectors':vectors_at(n*3),
            'cols':40,'rows':40,'is_estimated':False,'estimate_basis':None,'rating_mode':False,
            'bounds':{'west':-81,'east':-80.6,'south':20,'north':20.4},'provider':'fixture'} for n in range(48)]}
    expected=jsonable_encoder(payload)
    adapter=TypeAdapter(dict)
    receipts=[]
    async def run():
        for direct in [False,True]:
            for level in [9,1]:
                app=FastAPI(); app.include_router(router)
                app.add_middleware(GZipMiddleware,minimum_size=500,compresslevel=level)
                encoding=[]
                async def synthetic_builder(*args,**kwargs):
                    if not direct:return payload
                    start=perf_counter()
                    response=guarded_response(payload,adapter); encoding.append((perf_counter()-start)*1000)
                    return response
                timings=[]; wire=[]
                with patch('services.weather_pipeline.grid_series_helper.build_grid_series',synthetic_builder):
                    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://offline.invalid') as client:
                        for _ in range(5):
                            start=perf_counter()
                            response=await client.get('/weather/grid_series',params={'model':'GFS','layer':'waves','bbox':'-81,20,-80.6,20.4','hours':'0'},headers={'Accept-Encoding':'gzip'})
                            timings.append((perf_counter()-start)*1000)
                            assert response.status_code==200
                            assert response.headers['content-encoding']=='gzip'
                            assert response.json()==expected # all masks, omitted extras, zero/None and quantities
                            wire.append(int(response.headers['content-length']))
                receipts.append({'direct_pydantic':direct,'gzip_level':level,'trials':5,'http_ms':timings,
                    'median_ms':median(timings),'wire_bytes':wire,'encode_ms':encoding,'decoded_parity':True})
    asyncio.run(run())
    # The proposed direct serializer silently turns NaN into null whereas the actual
    # standard JSONResponse refuses it. It needs an explicit finite-value contract;
    # timing wins alone do not qualify a source change.
    from starlette.responses import JSONResponse
    import pytest
    with pytest.raises(ValueError):JSONResponse(jsonable_encoder({'speed':float('nan')}))
    assert json.loads(adapter.dump_json({'speed':float('nan')}))=={'speed':None}
    for bad in [float('nan'),float('inf'),-float('inf')]:
        with pytest.raises(ValueError): finite_compatible({'nested':[GridVector(lat=0,lng=0,speed=bad)]})
    assert not finite_compatible({'timestamp':base}) # preserve datetime string formatting via legacy fallback
    out=Path(__file__).parent/'visual/pf03-guarded-second.json'
    out.write_text(json.dumps({'vectors':76800,'frames':48,'scope':'actual route/framework/model serializers; synthetic builder; offline experiment only',
        'arms':receipts,'nonfinite_direct_parity':False,'guarded_nonfinite_refused':True,
        'distinct_vectors':True,'runtime_source_changed':False},indent=2)+'\n',encoding='utf-8')
    print(json.dumps([{'direct':r['direct_pydantic'],'gzip':r['gzip_level'],'median_ms':round(r['median_ms'],2),'wire':r['wire_bytes'][0]} for r in receipts]))


def test_guarded_route_legacy_fallback_and_nonfinite_error():
    from routes.weather import router
    import pytest
    app=FastAPI(); app.include_router(router)
    adapter=TypeAdapter(dict)
    async def run():
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://offline.invalid') as client:
            for value in [datetime(2026,10,4,tzinfo=timezone.utc),b'NaN as text',{'a','b'}]:
                payload={'metadata':value,'height':0,'period':None}
                async def build(*args,**kwargs):return guarded_response(payload,adapter)
                with patch('services.weather_pipeline.grid_series_helper.build_grid_series',build):
                    response=await client.get('/weather/grid_series',params={'model':'GFS','layer':'waves','bbox':'-81,20,-80,21','hours':'0'})
                    assert response.status_code==200
                    assert response.json()==jsonable_encoder(payload)
            for value in [float('nan'),float('inf'),-float('inf')]:
                payload={'frames':[{'vectors':[GridVector(lat=20,lng=-81,speed=value)]}]}
                with patch('services.weather_pipeline.grid_series_helper.build_grid_series',build):
                    with pytest.raises(ValueError):
                        await client.get('/weather/grid_series',params={'model':'GFS','layer':'waves','bbox':'-81,20,-80,21','hours':'0'})
    asyncio.run(run())
