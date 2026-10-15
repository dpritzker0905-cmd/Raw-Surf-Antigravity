const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../..','evidence');
const types={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{const rel=new URL(req.url,'http://x').pathname;const file=path.resolve(root,'.'+(rel==='/'?'/REVIEW.html':rel));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(path.join(root,'review-server.json'),JSON.stringify({pid:process.pid,url:'http://127.0.0.1:'+server.address().port})));
