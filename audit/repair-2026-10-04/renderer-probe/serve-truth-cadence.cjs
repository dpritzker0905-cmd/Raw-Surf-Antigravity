const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const req = require('module').createRequire(path.resolve('frontend/package.json'));
const webpack = req('webpack');
const output = path.join(__dirname, 'truth-cadence-bundle');
fs.mkdirSync(output, { recursive: true });
const original = execFileSync('git', ['show', '1993cc39294a75436218d426b13a359cdb57a356:frontend/src/components/map/useLayerTruthDiff.js'], { encoding: 'utf8' });
fs.writeFileSync(path.join(output, 'before.js'), original.replace("'./marineEmptyGrace'", "'../../../../frontend/src/components/map/marineEmptyGrace'"));
const compiler = webpack({ mode: 'development', devtool: false,
  entry: path.join(__dirname, 'truth-cadence-entry.js'), output: { path: output, filename: 'probe.js' },
  resolve: { modules: [path.resolve('frontend/node_modules'), 'node_modules'] },
  module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: { loader: req.resolve('babel-loader'),
    options: { babelrc: false, configFile: false, presets: [req.resolve('@babel/preset-env'),
      [req.resolve('@babel/preset-react'), { runtime: 'automatic' }]] } } }] },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })] });
compiler.run((error, stats) => {
  if (error || stats.hasErrors()) { console.log(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  compiler.close(error => {
    if (error) { console.log(error); process.exitCode = 1; return; }
    const server = http.createServer((request, response) => {
      response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'");
      if (request.url === '/probe.js') {
        response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(path.join(output, 'probe.js')));
      } else if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><meta charset="utf-8"><title>Offline truth inspection cadence</title><h1>MapLibre truth listener regression</h1><p>Actual React hook + MapLibre custom-layer repaint. 120 frames per case, 100 background layers, no forecast or live service requests. CPU call duration is not GPU completion.</p><label><input id="reverse" type="checkbox">Reverse case order</label><button id="run">Run before/after cadence</button><pre id="report">Ready</pre><div id="maps"></div><script src="/probe.js"></script>');
      } else { response.statusCode = 404; response.end('Not found'); }
    });
    server.listen(0, '127.0.0.1', () => console.log('Offline truth probe: http://127.0.0.1:' + server.address().port));
  });
});
