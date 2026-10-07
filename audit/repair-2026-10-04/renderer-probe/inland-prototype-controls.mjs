import assert from 'node:assert/strict';
import {classifyInlandWater as baseline} from './water-profile-inland-baseline.mjs';
import {classifyInlandWater as candidate,resetOfflineDistanceCache} from './water-profile-inland.mjs';
let seed=42,cases=0;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
function compare(water,ne,w,h,radius) {
  const expected=baseline(water,ne,w,h,radius),actual=candidate(water,ne,w,h,radius);
  assert.deepEqual(actual,expected);cases++;
}
for(const[w,h] of [[1,1],[1,19],[21,1],[8,8],[17,9],[63,31]]) {
  resetOfflineDistanceCache();const size=w*h;
  for(let i=0;i<160;i++) {
    const ne=Uint8Array.from({length:size},()=>random()%5===0?1:0);
    const water=Uint8Array.from({length:size},()=>random()%3===0?1:0);
    for(const radius of [-1,0,1,2,10,100,0x3fffffff,NaN,Infinity]) compare(water,ne,w,h,radius);
    ne[random()%size]^=1;compare(water,ne,w,h,2);
    water[random()%size]^=1;compare(water,ne,w,h,2);
  }
  for(const value of [0,1,2,255]) {
    const ne=new Uint8Array(size).fill(value),water=new Uint8Array(size).fill(1);
    compare(water,ne,w,h,1);compare(water,ne.slice(),w,h,2);
    ne[0]^=1;compare(water,ne,w,h,1);
  }
}
compare([1,1,1,1],[0,0,0,1],2,2,0); // Generic arrays bypass reuse.
console.log(JSON.stringify({cases,passed:true,oracle:'unchanged exact source',servedSourceChanged:false}));
