const request=async(method,url,body,options={})=>{const params=new URLSearchParams(options.params||{});const target=url+(params.size?(url.includes('?')?'&':'?')+params:'');
window.fixture.requests.push({method,url:target});
const response=await fetch('/api'+target,{method,headers:{'Content-Type':'application/json',...(window.fixture.user?{'X-Fixture-User':window.fixture.user.id}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const data=await response.json();if(!response.ok){const e=new Error('Synthetic HTTP '+response.status);e.response={status:response.status,data};throw e;}return {data};};
export default {get:(url,options)=>request('GET',url,undefined,options),post:(url,body)=>request('POST',url,body),put:(url,body)=>request('PUT',url,body)};
