import { overlayBasemapWaterOnMask } from './water-profile-renderer';
import { makeMaskProjector } from '../../../frontend/src/components/map/marineMaskProjection';
import { resetOfflineDistanceCache } from './water-profile-inland.mjs';

document.getElementById('run').addEventListener('click', () => {
  const result={backendRequests:0,gpuCompletionMeasured:false,servedSourceChanged:false,
    instrumentedActualPainter:true,syntheticCoast:true,samplesPerLeg:3,cases:[],
    start:{hidden:document.hidden,focused:document.hasFocus()}};
  try {
    for(const width of [512,2048]) for(const vertices of [2,5000]) {
      let expectedPixels=null;
      for(const cached of [false,true]) {
      window.__OFFLINE_DISABLE_INLAND_CACHE__=!cached;resetOfflineDistanceCache();
      const bounds={west:0,east:8,south:0,north:4};
      const ring=[];
      for(let i=0;i<vertices;i++) {const y=4*i/(vertices-1);ring.push([4+(vertices===2?0:0.2*Math.sin(y*30)),y]);}
      ring.push([8,4],[8,0],ring[0]);
      const feature={type:'Feature',properties:{class:'ocean'},geometry:{type:'Polygon',coordinates:[ring]}};
      const map={getBounds:()=>({getWest:()=>0,getEast:()=>8,getSouth:()=>0,getNorth:()=>4}),
        querySourceFeatures:()=>[],getStyle:()=>({layers:[]})};
      const prepared={waterSource:'fixture',feats:[feature],usedSourceFallback:false};
      const base=document.createElement('canvas');base.width=width;base.height=width/2;
      const ctx=base.getContext('2d',{willReadFrequently:true});ctx.fillStyle='black';ctx.fillRect(0,0,base.width,base.height);
      const project=makeMaskProjector(bounds,base.width,base.height);ctx.fillStyle='white';ctx.beginPath();
      ring.forEach((pt,i)=>{const[x,y]=project(pt[0],pt[1]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.closePath();ctx.fill();
      const canvas=document.createElement('canvas');canvas.width=base.width;canvas.height=base.height;
      const paint=()=>{canvas.getContext('2d',{willReadFrequently:true}).drawImage(base,0,0);
        const start=performance.now();const applied=overlayBasemapWaterOnMask(canvas,bounds,map,prepared);
        return {totalMs:performance.now()-start,applied};};
      window.__RAW_GPU__={};window.__OFFLINE_MASK_STAGES__={};paint();
      window.__OFFLINE_MASK_STAGES__={};const paints=[];
      let mismatches=0;
      for(let i=0;i<3;i++) {
        paints.push(paint());
        const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
        if(expectedPixels===null)expectedPixels=pixels.slice();
        else for(let n=0;n<pixels.length;n++)if(pixels[n]!==expectedPixels[n])mismatches++;
      }
      if(mismatches)throw new Error('Full RGBA parity mismatch: '+mismatches);
      result.cases.push({width,vertices,cached,fullRgbaParity:true,paints,stages:window.__OFFLINE_MASK_STAGES__,
        shelterCache:window.__RAW_GPU__.shelterCache,damage:window.__RAW_GPU__.openWaterVerdict});
      }
    }
    result.completed=true;
  }catch(e){result.completed=false;result.error=e.message;}
  result.end={hidden:document.hidden,focused:document.hasFocus()};
  document.getElementById('report').textContent=JSON.stringify(result,null,2);
});
