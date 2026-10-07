const fs = require('fs'), path = require('path'), http = require('http');
const req = require('module').createRequire(path.resolve('frontend/package.json'));
const webpack = req('webpack');
const output = path.join(__dirname, 'mask-cost-bundle');
const compiler = webpack({ mode: 'development', devtool: false,
  entry: path.join(__dirname, 'mask-cost-entry.js'), output: { path: output, filename: 'probe.js' },
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
        response.end('<!doctype html><meta charset="utf-8"><title>Offline failed mask cost</title><h1>Mask refresh false-return control</h1><p>Actual engine/painter, native Canvas, synthetic geometry and map readiness. No GPU upload or live backend. Ten same-view attempts each for not-ready and ready/empty-water controls.</p><button id="run">Run mask failure cost</button><pre id="report">Ready</pre><script src="/probe.js"></script>');
      } else { response.statusCode = 404; response.end('Not found'); }
    });
    server.listen(0, '127.0.0.1', () => console.log('Offline mask probe: http://127.0.0.1:' + server.address().port));
  });
});
