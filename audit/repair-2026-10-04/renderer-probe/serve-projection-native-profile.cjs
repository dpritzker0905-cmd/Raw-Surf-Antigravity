const fs = require('fs');
const path = require('path');
const http = require('http');
const req = require('module').createRequire(path.resolve('frontend/package.json'));
const webpack = req('webpack');
const output = path.join(__dirname, 'projection-native-profile-bundle');
const compiler = webpack({ mode: 'development', devtool: false,
  entry: path.join(__dirname, 'projection-native-profile-entry.js'),
  output: { path: output, filename: 'probe.js' },
  resolve: { modules: [path.resolve('frontend/node_modules'), 'node_modules'] },
  module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: { loader: req.resolve('babel-loader'),
    options: { babelrc: false, configFile: false, presets: [req.resolve('@babel/preset-env'),
      [req.resolve('@babel/preset-react'), { runtime: 'automatic' }]] } } }] },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })] });
compiler.run((error, stats) => {
  if (error || stats.hasErrors()) { process.exitCode = 1; console.log(error || stats.toString({ all: false, errors: true })); return; }
  compiler.close(error => {
    if (error) { process.exitCode = 1; console.log(error); return; }
    const server = http.createServer((request, response) => {
      response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'");
      if (request.url === '/probe.js') {
        response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(path.join(output, 'probe.js')));
      } else if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><meta charset="utf-8"><title>Offline marine CPU probe</title><h1>Offline synthetic marine renderer</h1><p>Standalone: 256×128 canvas. MapLibre: selected container size. Both use a 17×17 synthetic field and 60 measured frames. No real forecast, network loading or GPU-completion measurement.</p><label><input id="reverse" type="checkbox">Reverse case order</label><button id="run">Run offline profile</button><label>Map canvas size <select id="size"><option value="512x256">512×256</option><option value="1600x900">1600×900</option></select></label><button id="map-run">Run MapLibre integration</button><button id="gap-run">Run callback gap controls</button><pre id="report">Ready</pre><div id="canvases"></div><script src="/probe.js"></script>');
      } else { response.statusCode = 404; response.end('Not found'); }
    });
    server.listen(0, '127.0.0.1', () => console.log('Offline probe: http://127.0.0.1:' + server.address().port));
  });
});
