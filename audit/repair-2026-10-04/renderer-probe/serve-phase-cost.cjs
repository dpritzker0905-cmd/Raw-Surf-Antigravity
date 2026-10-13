const fs = require('fs'), path = require('path'), http = require('http');
const req = require('module').createRequire(path.resolve('frontend/package.json'));
const webpack = req('webpack'), output = path.join(__dirname, 'phase-cost-bundle');
const compiler = webpack({ mode: 'development', devtool: false,
  entry: path.join(__dirname, 'phase-cost-entry.js'), output: { path: output, filename: 'probe.js' },
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
        response.end('<!doctype html><meta charset="utf-8"><title>Offline marine CPU phase calibration</title><h1>CPU phase timing calibration</h1><p>Actual custom layer and phase collector, synthetic map and engine; no GPU or backend. Six callback samples per leg: idle versus deliberate 15 ms pre-draw and 25 ms draw CPU stalls. Separate RAF control samples browser scheduling with no engine/map/GPU work, 30 intervals and a 45 s deadline. No live FPS, physical or GPU-completion claim.</p><button id="run">Run CPU phase calibration</button><pre id="report">Ready</pre><button id="raf">Run RAF cadence control</button><pre id="raf-report">Ready</pre><script src="/probe.js"></script>');
      } else { response.statusCode = 404; response.end('Not found'); }
    });
    server.listen(0, '127.0.0.1', () => console.log('Offline phase probe: http://127.0.0.1:' + server.address().port));
  });
});
