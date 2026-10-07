// Public engine seam with actual feature selection/painter and a rectangular Canvas contract.
// Native Canvas allocation/cost is measured separately; this fixture is not GPU/physical proof.
import WebGLMarineEngine from './WebGLMarineEngine';
import { renderMaskToCanvas } from './WebGLMarineMaskRenderer';
jest.mock('./maskCoastSDF', () => ({ writeCoastDistanceField: () => false }));
jest.mock('./WebGLMarineMaskRenderer', () => ({
  ...jest.requireActual('./WebGLMarineMaskRenderer'),
  renderMaskToCanvas: jest.fn(),
}));
class Canvas {
  constructor(){this._w=1;this._h=1;this.reset();}
  reset(){this.px=new Uint8ClampedArray(this._w*this._h*4);this.ctx=new Context(this);}
  set width(v){this._w=v;this.reset();}get width(){return this._w;}
  set height(v){this._h=v;this.reset();}get height(){return this._h;}
  getContext(){return this.ctx;}
}
class Context {
  constructor(c){this.c=c;this.fillStyle='#000000';this.globalCompositeOperation='source-over';this.imageSmoothingEnabled=true;this.path=[];this.stack=[];}
  save(){this.stack.push([this.fillStyle,this.globalCompositeOperation,this.imageSmoothingEnabled]);}
  restore(){[this.fillStyle,this.globalCompositeOperation,this.imageSmoothingEnabled]=this.stack.pop();}
  beginPath(){this.path=[];}moveTo(x,y){this.path.push([x,y]);}lineTo(x,y){this.path.push([x,y]);}closePath(){}clip(){}
  rect(x,y,w,h){this.path.push([x,y],[x+w,y+h]);}
  fill(){if(!this.path.length)return;const xs=this.path.map(p=>p[0]),ys=this.path.map(p=>p[1]);this.fillRect(Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));}
  stroke(){} // wetland case excluded from this fixture: no stroke/curve rasterization claim.
  fillRect(x,y,w,h){const v=/white|fff/i.test(this.fillStyle)?255:0;for(let iy=Math.max(0,Math.ceil(y));iy<Math.min(this.c.height,Math.ceil(y+h));iy++)for(let ix=Math.max(0,Math.ceil(x));ix<Math.min(this.c.width,Math.ceil(x+w));ix++){const i=(iy*this.c.width+ix)*4;this.c.px.set([v,v,v,255],i);}}
  drawImage(src,...a){let sx=0,sy=0,sw=src.width,sh=src.height,dx=0,dy=0,dw=src.width,dh=src.height;if(a.length===2)[dx,dy]=a;else if(a.length===4)[dx,dy,dw,dh]=a;else [sx,sy,sw,sh,dx,dy,dw,dh]=a;
    for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const tx=Math.floor(dx+x),ty=Math.floor(dy+y);if(tx<0||ty<0||tx>=this.c.width||ty>=this.c.height)continue;const ix=Math.min(src.width-1,Math.max(0,Math.floor(sx+x*sw/dw))),iy=Math.min(src.height-1,Math.max(0,Math.floor(sy+y*sh/dh))),si=(iy*src.width+ix)*4,di=(ty*this.c.width+tx)*4;if(!src.px[si+3])continue;for(let k=0;k<3;k++){const v=src.px[si+k];this.c.px[di+k]=this.globalCompositeOperation==='multiply'?Math.round(this.c.px[di+k]*v/255):this.globalCompositeOperation==='darken'?Math.min(this.c.px[di+k],v):v;}this.c.px[di+3]=255;}}
  getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4);for(let iy=0;iy<h;iy++)for(let ix=0;ix<w;ix++){let si=((y+iy)*this.c.width+x+ix)*4;data.set(this.c.px.subarray(si,si+4),(iy*w+ix)*4);}return {width:w,height:h,data};}
  putImageData(img,x,y){for(let iy=0;iy<img.height;iy++)for(let ix=0;ix<img.width;ix++)this.c.px.set(img.data.subarray((iy*img.width+ix)*4,(iy*img.width+ix+1)*4),((y+iy)*this.c.width+x+ix)*4);}
}


const originalElement = document.createElement.bind(document);
const methods = ['regional', 'overlay', 'wide'];
function fixture(kind, ready = true) {
  const resident = {}, foreign = {};
  let bound = foreign, flip = false, features = [];
  const gl = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_FLIP_Y_WEBGL: 3,
    getParameter: value => value === 2 ? bound : flip,
    bindTexture: (_target, value) => { bound = value; },
    pixelStorei: (_target, value) => { flip = value; }, createTexture: () => ({}),
    texParameteri: jest.fn(), texImage2D: jest.fn() };
  const engine = Object.create(WebGLMarineEngine.prototype);
  Object.assign(engine, { _cachedMaskGeoJSON: { type: 'FeatureCollection', features: [] },
    _cachedMaskBounds: kind === 'wide' ? { west: -180, east: 180, south: -80, north: 80 }
      : { west: 0, east: 4, south: 0, north: 4 },
    _cachedMaskTex: resident, _waveData: { u_oceanMaskTexture: resident } });
  const map = { getZoom: () => 7,
    getStyle: () => ({ layers: [{ id: 'water', type: 'fill', source: 'fixture', 'source-layer': 'water' }] }),
    getSource: () => ({}), isSourceLoaded: () => ready, areTilesLoaded: () => ready,
    queryRenderedFeatures: jest.fn(() => features),
    querySourceFeatures: jest.fn((_source, options) => options.sourceLayer === 'water' ? features : []),
    getBounds: () => ({ getWest: () => 1, getEast: () => 2, getSouth: () => 1, getNorth: () => 2 }) };
  const water = { type: 'Feature', properties: { class: 'ocean' }, geometry: { type: 'Polygon',
    coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] } };
  return { gl, map, engine, resident, foreign,
    addWater: () => { features = [water]; },
    state: () => ({ bound, flip }),
    refresh: () => kind === 'overlay' ? engine.refreshViewportOverlayMask(gl, map)
      : engine.refreshMaskWithBasemapWater(gl, map) };
}
beforeEach(() => {
  renderMaskToCanvas.mockImplementation(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 128, 64);
    return canvas;
  });
  jest.spyOn(document, 'createElement').mockImplementation((tag, ...args) =>
    tag === 'canvas' ? new Canvas() : originalElement(tag, ...args));
  window.__RAW_DISABLE_SHELTERED_WATER__ = true;
});
afterEach(() => { jest.restoreAllMocks(); delete window.__RAW_DISABLE_SHELTERED_WATER__; });

test.each(methods)('%s: repeated empty-water attempts allocate no mask canvas', kind => {
  const f = fixture(kind);
  for (let i = 0; i < 10; i++) expect(f.refresh()).toBe(false);
  expect(renderMaskToCanvas).not.toHaveBeenCalled();
  expect(f.gl.texImage2D).not.toHaveBeenCalled();
  expect(f.engine._cachedMaskTex).toBe(f.resident);
  expect(f.state()).toEqual({ bound: f.foreign, flip: false });
});
test.each(methods)('%s: not-ready skips remain cheap and never query water', kind => {
  const f = fixture(kind, false); f.addWater();
  expect(f.refresh()).toBe(false);
  expect(renderMaskToCanvas).not.toHaveBeenCalled();
  expect(f.map.queryRenderedFeatures).not.toHaveBeenCalled();
  expect(f.map.querySourceFeatures).not.toHaveBeenCalled();
});
test.each(methods)('%s: water becoming available paints on the very next attempt', kind => {
  const f = fixture(kind); expect(f.refresh()).toBe(false); f.addWater();
  expect(f.refresh()).toBe(true);
  expect(renderMaskToCanvas).toHaveBeenCalledTimes(1);
  expect(f.gl.texImage2D).toHaveBeenCalledTimes(1);
  expect(f.state()).toEqual({ bound: f.foreign, flip: false });
});
test.each(methods)('%s: finest rendered water is queried once and source parents do not replace it', kind => {
  const f = fixture(kind); f.addWater(); expect(f.refresh()).toBe(true);
  expect(f.map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
  expect(f.map.querySourceFeatures.mock.calls.filter(([, options]) => options.sourceLayer === 'water')).toHaveLength(0);
  expect(kind === 'regional' ? f.engine._regionalPatchState.degraded : f.engine._overlayPaintDegraded).toBe(false);
});
test.each(methods)('%s: source fallback stays degraded and can heal on the next attempt', kind => {
  const f = fixture(kind); f.addWater();
  f.map.queryRenderedFeatures.mockImplementationOnce(() => []);
  expect(f.refresh()).toBe(true);
  expect(kind === 'regional' ? f.engine._regionalPatchState.degraded : f.engine._overlayPaintDegraded).toBe(true);
  expect(f.refresh()).toBe(true);
  expect(f.map.queryRenderedFeatures).toHaveBeenCalledTimes(2);
  expect(kind === 'regional' ? f.engine._regionalPatchState.degraded : f.engine._overlayPaintDegraded).toBe(false);
});
test.each(methods)('%s: failed feature queries cannot trigger canvas allocation', kind => {
  const f = fixture(kind);
  f.map.queryRenderedFeatures.mockImplementation(() => { throw new Error('rendered unavailable'); });
  f.map.querySourceFeatures.mockImplementation(() => { throw new Error('source unavailable'); });
  expect(f.refresh()).toBe(false);
  expect(renderMaskToCanvas).not.toHaveBeenCalled();
  expect(f.gl.texImage2D).not.toHaveBeenCalled();
});
