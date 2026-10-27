// Offline readback of the actual marine GLSL colour function, independent of the JS legend.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const readSource = file => process.argv.includes('--baseline')
  ? require('child_process').execFileSync('git',['show','131d5d9e:frontend/src/components/map/'+file],{cwd:root}).toString()
  : fs.readFileSync(path.join(root,'src/components/map',file),'utf8');
const shaderFile = readSource('WebGLMarineShaders.js');
const context = vm.createContext({window:{__RAW_DISABLE_MARINE_WAVE_PALETTE__:process.argv.includes('--legacy')}});
const paletteFile=path.join(root,'src/components/map/marineWavePalette.js');
if(fs.existsSync(paletteFile))vm.runInContext(fs.readFileSync(paletteFile,'utf8').replace(/export /g,''),context);
const shader = shaderFile.slice(shaderFile.indexOf('float getNonlinearT('), shaderFile.indexOf('// Surf-quality RATING colormap:'))
  .replace('${MARINE_WAVE_PALETTE_GLSL}',fs.existsSync(paletteFile)?vm.runInContext('MARINE_WAVE_PALETTE_GLSL',context):'')
  .replace('${MARINE_WAVE_PALETTE_CALL_GLSL}',fs.existsSync(paletteFile)?vm.runInContext('MARINE_WAVE_PALETTE_CALL_GLSL',context):'');
const js = readSource('colorScales.js').replace(/^import .*;\r?\n/gm,'').replace(/export /g, '');
vm.runInContext(js, context);
const heatmap = shaderFile.match(/export const HEATMAP_FS = `([\s\S]*?)`;/)[1]
  .replace('${MARINE_WAVE_PALETTE_GLSL}',vm.runInContext('MARINE_WAVE_PALETTE_GLSL',context))
  .replace('${MARINE_WAVE_PALETTE_CALL_GLSL}',vm.runInContext('MARINE_WAVE_PALETTE_CALL_GLSL',context));
const heights = [0, .15, .3, .6, .9, 1.2, 1.8, 2.4, 3, 3.6, 4.2, 5, 6.1, 8, 10];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 760 } });
    await page.setContent('<html><body style="margin:20px;background:#181a1e;color:white;font:16px system-ui"><h1>Marine wave-height ramp — source GPU pixels</h1><p>Calibrated heights in metres. Original theme families; dark is the immutable reference.</p><div id="rows"></div></body></html>');
    const result = await page.evaluate(({ shader, heights, heatmap }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1;
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false });
      const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, 'precision mediump float; uniform float h;uniform float theme;uniform float surf;uniform float gradient;' + shader + '\nvoid main(){float height=gradient>0.5?(gl_FragCoord.x/1024.0)*10.0:h;gl_FragColor=vec4(getThemedWaveColor(height,theme,surf),1.);}'));
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program)); gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const uniform = (name, value) => gl.uniform1f(gl.getUniformLocation(program, name), value);
      const rgb = () => { gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); const b = new Uint8Array(4); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b); return Array.from(b.slice(0,3)); };
      const rows = [];
      for (const [theme, value] of [['beach',2],['light',1],['dark',0]]) {
        uniform('theme',value); uniform('surf',0); uniform('gradient',0);
        const samples = heights.map(h => { uniform('h',h); return { h, rgb: rgb() }; });
        const sweep = Array.from({ length:1001 }, (_,i) => { uniform('h',i/100); return { h:i/100,rgb:rgb() }; });
        uniform('surf',1); const surf = heights.map(h => { uniform('h',h); return { h,rgb:rgb() }; });
        uniform('surf',0);uniform('gradient',1);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        const row=document.createElement('section');row.innerHTML='<h2>'+theme+'</h2>';const bar=document.createElement('img');bar.src=canvas.toDataURL();bar.style='width:100%;height:55px;image-rendering:auto';row.append(bar);
        const chips=document.createElement('div');chips.style='display:flex';samples.forEach(s=>{const chip=document.createElement('div');chip.style='flex:1;text-align:center';chip.innerHTML='<div style="height:45px;background:rgb('+s.rgb.join(',')+')"></div><small>'+s.h+' m</small>';chips.append(chip);});row.append(chips);document.getElementById('rows').append(row);
        rows.push({theme,samples,sweep,surf});
      }
      // Entire shipped HEATMAP_FS, with actual 8-bit wave encoding and premultiplied alpha over water.
      // Fixed ocean masks isolate palette differences; full-map captures separately exercise real masks.
      const native=gl.createProgram();
      gl.attachShader(native,compile(gl.VERTEX_SHADER,'attribute vec2 p;varying highp vec2 v_mercator_xy;void main(){v_mercator_xy=vec2(0.5);gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(native,compile(gl.FRAGMENT_SHADER,heatmap));gl.linkProgram(native);if(!gl.getProgramParameter(native,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(native));gl.useProgram(native);
      const np=gl.getAttribLocation(native,'p');gl.enableVertexAttribArray(np);gl.vertexAttribPointer(np,2,gl.FLOAT,false,0,0);
      const f=(n,v)=>gl.uniform1f(gl.getUniformLocation(native,n),v),v2=(n,x,y)=>gl.uniform2f(gl.getUniformLocation(native,n),x,y);
      v2('u_dataBounds_min',-180,-80);v2('u_dataBounds_max',180,80);v2('u_maskBounds_min',-180,-80);v2('u_maskBounds_max',180,80);
      const textures=[];
      const texture=(name,bytes)=>{const t=gl.createTexture(),unit=textures.length;textures.push(t);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(bytes));gl.uniform1i(gl.getUniformLocation(native,name),unit);return t;};
      const wave=texture('u_waveTexture',[128,128,0,128]);texture('u_chlorophyllTexture',[0,0,0,255]);texture('u_bathymetryTexture',[128,0,0,255]);texture('u_oceanMaskTexture',[255,255,128,255]);texture('u_overlayMaskTexture',[255,255,128,255]);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      const field=[];const grounds={beach:[159,216,230],light:[207,227,242],dark:[11,29,46]};
      for(const [theme,value]of [['beach',2],['light',1],['dark',0]])for(const opacity of [.65,.75,.8])for(const direction of [0,90,180,270]){
        f('u_theme',value);f('u_opacity',opacity);const rad=direction*Math.PI/180;
        const samples=heights.map(h=>{gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,wave);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([Math.round((Math.sin(rad)*.5+.5)*255),Math.round((Math.cos(rad)*.5+.5)*255),Math.round(h/10*255),128]));gl.clearColor(...grounds[theme].map(c=>c/255),1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);const b=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return {h,decodedHeight:Math.round(h/10*255)/255*10,rgb:Array.from(b.slice(0,3))};});
        field.push({theme,opacity,direction,ground:grounds[theme],samples});
      }
      const info=gl.getExtension('WEBGL_debug_renderer_info'); return {rows,field,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),glError:gl.getError()};
    }, { shader, heights, heatmap });
    for (const r of result.rows) for (const s of [...r.samples,...r.sweep,...r.surf]) s.legend = context.getThemedWaveColorJS(s.h,r.theme,r.surf.includes(s));
    result.at=new Date().toISOString(); result.shaderSha=require('crypto').createHash('sha256').update(shaderFile).digest('hex');
    fs.writeFileSync(path.join(out,'gpu-ramp.json'),JSON.stringify(result));
    await page.screenshot({path:path.join(out,'gpu-ramps.png')});
    fs.writeFileSync(path.join(out,'ramps.html'),await page.content());
    console.log(JSON.stringify({renderer:result.renderer,glError:result.glError,maxLegendError:Math.max(...result.rows.flatMap(r=>r.sweep.map(s=>Math.max(...s.rgb.map((v,i)=>Math.abs(v-s.legend[i]))))))}));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
