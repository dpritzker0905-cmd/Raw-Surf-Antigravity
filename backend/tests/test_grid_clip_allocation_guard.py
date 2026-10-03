import copy,math,builtins
import pytest
from services.weather_pipeline import route_helpers as H
from tests.test_grid_clip_to_data_extent import make_product

class UnsafeAllocation(AssertionError): pass
class LoopTrap(float):
    def __iadd__(self,other):raise UnsafeAllocation("nonfinite longitude normalization loop")
    def __isub__(self,other):raise UnsafeAllocation("nonfinite longitude normalization loop")

@pytest.fixture
def bounded(monkeypatch):
    counts={'ranges':[],'placeholders':0}
    def limited_range(*args):
        r=builtins.range(*args);counts['ranges'].append(len(r))
        if len(r)>2000:raise UnsafeAllocation('unbounded axis reached materialization')
        return r
    monkeypatch.setattr(H,'range',limited_range,raising=False)
    # A cross-product hazard can have individually small axes. Stop after a few placeholder writes.
    real=H.GridVector
    def limited_vector(*args,**kwargs):
        counts['placeholders']+=1
        if counts['placeholders']>8:raise UnsafeAllocation('unbounded rectangular fill reached materialization')
        return real(*args,**kwargs)
    monkeypatch.setattr(H,'GridVector',limited_vector)
    return counts

@pytest.mark.parametrize('res,window',[(.0001,(-180,-80,180,85)),(.0001,(170,-10,-170,10)),(.25,(-180,-80,180,85)),(.0001,(-1,0,1,2))])
def test_oversized_lattice_is_refused_before_materialization(bounded,res,window):
    with pytest.raises(ValueError):H.clip_lattice(-80,-180,res,*window)
    assert bounded=={'ranges':[],'placeholders':0}

@pytest.mark.parametrize('res',[0,-1,float('nan'),float('inf'),5e-324])
def test_invalid_resolution_is_refused_before_materialization(bounded,res):
    with pytest.raises(ValueError):H.clip_lattice(0,0,res,-1,-1,1,1)
    assert bounded=={'ranges':[],'placeholders':0}

@pytest.mark.parametrize('index',range(6))
def test_nonfinite_geometry_is_refused_before_materialization(bounded,index):
    args=[0,LoopTrap(0),1,-1,-1,1,1];indices=[0,1,3,4,5,6];args[indices[index]]=LoopTrap(float('inf'))
    with pytest.raises(ValueError):H.clip_lattice(*args)
    assert bounded=={'ranges':[],'placeholders':0}

@pytest.mark.parametrize('resolution',[None,.0001,float('inf'),float('nan'),5e-324])
def test_bad_product_clip_is_empty_diagnosed_and_does_not_mutate_cache(monkeypatch,bounded,resolution):
    p=make_product(west=-1,east=1,south=0,north=2,res=1)
    p.resolution=resolution
    if resolution is None:p.grid.vectors[1]=p.grid.vectors[1].model_copy(update={'lat':.0001})
    p.grid.diagnostics={'stored_marker':'unchanged'}
    before=p.model_dump_json()
    out=H.filter_grid_to_bbox(p,'-1,0,1,2')
    assert out.grid.vectors==[] and out.grid.cols==out.grid.rows==0
    assert out.grid.diagnostics['clip_rejected']=='unsafe_lattice'
    assert out.partial_coverage is True
    # nan does not compare equal in independently materialized dicts; compare its fixed JSON spelling.
    assert p.model_dump_json()==before
    assert bounded['placeholders']==0
    assert max(bounded['ranges'] or [0])<=len(p.grid.vectors)

@pytest.mark.parametrize('bbox',['-1,0,1,2','0,0,1,1','10,10,11,11'])
def test_valid_and_empty_clips_preserve_output_and_shared_vectors(monkeypatch,bbox):
    p=make_product(west=-1,east=1,south=0,north=2,res=1);before=p.model_dump_json()
    out=H.filter_grid_to_bbox(p,bbox)
    assert len(out.grid.vectors)==out.grid.cols*out.grid.rows
    assert p.model_dump_json()==before
    assert 'clip_rejected' not in (out.grid.diagnostics or {})
    for v in out.grid.vectors:assert v in p.grid.vectors

@pytest.mark.parametrize('longitude',[1e308,-1e308])
def test_finite_out_of_range_reference_cannot_spin(bounded,longitude):
    with pytest.raises(ValueError):H.clip_lattice(0,LoopTrap(longitude),1,-1,-1,1,1)
    assert bounded=={'ranges':[],'placeholders':0}

def test_finite_out_of_range_window_cannot_spin(bounded):
    with pytest.raises(ValueError):H.clip_lattice(0,LoopTrap(0),1,1e308,-1,1,1)
    assert bounded=={'ranges':[],'placeholders':0}

def test_exact_shared_serve_budget_is_allowed(monkeypatch):
    from services.weather_pipeline import viewport_helper
    monkeypatch.setattr(viewport_helper,'_MAX_SERVEABLE_GRID_VECTORS',9)
    assert H.clip_lattice(0,0,1,0,0,2,2)==([0,1,2],[0,1,2])

def test_small_axes_cross_product_above_shared_serve_budget_is_refused(monkeypatch,bounded):
    from services.weather_pipeline import viewport_helper
    monkeypatch.setattr(viewport_helper,'_MAX_SERVEABLE_GRID_VECTORS',8)
    with pytest.raises(ValueError):H.clip_lattice(0,0,1,0,0,2,2)
    assert bounded=={'ranges':[],'placeholders':0}
