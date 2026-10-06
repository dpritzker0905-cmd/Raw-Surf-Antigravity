// Actual painter with a rectangular Canvas contract fixture; not native Canvas/GPU proof.
import { overlayBasemapWaterOnMask } from './WebGLMarineMaskRenderer';
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

const createElement = document.createElement.bind(document);
beforeEach(() => {
  jest.spyOn(document, 'createElement').mockImplementation((tag, ...args) => tag === 'canvas' ? new Canvas() : createElement(tag, ...args));
  window.__RAW_GPU__ = {};
});
afterEach(() => {
  jest.restoreAllMocks();
  delete window.__RAW_GPU__;
  delete window.__RAW_DISABLE_ISLAND_REASSERT__;
  delete window.__RAW_DISABLE_OPENWATER_PLAUSIBILITY__;
});
function paint(density, complete) {
  const span=512/density;
  const bounds={west:0,east:span,south:0,north:span};
  const water={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[complete?span:span/2,0],[complete?span:span/2,span],[0,span],[0,0]]]}};
  const map={getStyle:()=>({layers:[{id:'water',type:'fill',source:'fixture','source-layer':'water'}]}),
    getSource:()=>({}),isSourceLoaded:()=>true,areTilesLoaded:()=>true,
    queryRenderedFeatures:()=>[water],querySourceFeatures:(_s,o)=>o.sourceLayer==='water'?[water]:[],
    getBounds:()=>({getWest:()=>0,getEast:()=>span,getSouth:()=>0,getNorth:()=>span})};
  const canvas=new Canvas();canvas.width=512;canvas.height=256;
  canvas.ctx.fillStyle='white';canvas.ctx.fillRect(0,0,512,256);
  return overlayBasemapWaterOnMask(canvas,bounds,map);
}
test.each([205,399,400,401,850,1720].flatMap(d=>[false,true].map(full=>[d,full])))(
  'density %s complete=%s qualifies actual missing-tile paint', (density,complete)=>{
    const result=paint(density,complete);
    expect(result.painted).toBe(1);
    expect(result.degraded).toBe(!complete&&density<1200);
  });
test.each([400,850])('density %s detects damage even with island reassert killed', density=>{
  window.__RAW_DISABLE_ISLAND_REASSERT__=true;
  expect(paint(density,false).degraded).toBe(true);
  expect(window.__RAW_GPU__.openWaterVerdict.falseLand).toBeGreaterThan(50);
});
test('plausibility kill switch preserves paint while suppressing the new verdict',()=>{
  window.__RAW_DISABLE_OPENWATER_PLAUSIBILITY__=true;
  expect(paint(850,false).degraded).toBe(false);
});
// Call-site contract for step 3c. The damage detector owns a snapshot below 1200 px/deg, but only
// the independent 400 px/deg gate (and its kill switch) may multiply NE land back: islandReassertGate
// tests the predicate, these tests the painter, which is where the Madeira halo regressed.
test.each([401,850,1199])('density %s: owning a damage snapshot does not re-assert NE land',density=>{
  paint(density,true);
  expect(window.__RAW_GPU__.islandReassert).toMatchObject({applied:false,reason:'fine_basemap'});
});
test.each([68,205,399])('density %s: coarse mask still re-asserts NE land',density=>{
  paint(density,true);
  expect(window.__RAW_GPU__.islandReassert).toMatchObject({applied:true,mode:'multiply'});
});
test.each([205,850])('density %s: kill switch disables the re-assert',density=>{
  window.__RAW_DISABLE_ISLAND_REASSERT__=true;
  paint(density,true);
  expect(window.__RAW_GPU__.islandReassert).toMatchObject({applied:false,reason:'disabled'});
});
