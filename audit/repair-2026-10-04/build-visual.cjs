// Offline isolated preview: the actual components and actual app CSS, no API client.
const path = require('path');
const fs = require('fs');
const frontend = path.resolve(__dirname, '../../frontend');
const resolve = name => require.resolve(name, { paths: [frontend] });
const webpack = require(resolve('webpack'));
const postcss = require(resolve('postcss'));
const tailwind = require(resolve('tailwindcss'));
const autoprefixer = require(resolve('autoprefixer'));
const out = path.join(__dirname, 'visual');
const forecast = process.argv.includes('--forecast');
fs.mkdirSync(out, { recursive: true });
process.env.NODE_ENV = 'production';
process.chdir(frontend);
webpack({ mode: 'production', entry: path.join(__dirname, forecast ? 'forecast-visual-entry.jsx' : 'visual-entry.jsx'),
  output: { path: out, filename: 'preview.js' }, devtool: false,
  // A wrapped object remains an expression inside concise arrow functions during concatenation.
  plugins: [new webpack.DefinePlugin({ 'process.env': '(' + JSON.stringify({ NODE_ENV: 'production', ...(forecast ? {
    REACT_APP_FORECAST_STATE_IDENTITY: 'true', REACT_APP_MARINE_VALUE_VALIDITY: 'true', REACT_APP_GFS_EXACT_PLAYBACK: 'true',
  } : {}) }) + ')' }), ...(forecast ? [
    new webpack.NormalModuleReplacementPlugin(/contexts[/\\]AuthContext(?:\.js)?$/, path.join(__dirname, 'forecast-visual-auth.js')),
    new webpack.NormalModuleReplacementPlugin(/lib[/\\]apiClient(?:\.js)?$/, path.join(__dirname, 'forecast-visual-api.js')),
  ] : [])],
  resolve: { modules: [path.join(frontend, 'node_modules')], extensions: ['.js', '.jsx'] },
  module: { rules: [{ test: /\.(js|jsx)$/, exclude: /node_modules/,
    use: { loader: resolve('babel-loader'), options: { presets: [[resolve('babel-preset-react-app'), { runtime: 'automatic' }]] } } }] },
}, async (err, stats) => {
  if (err || stats.hasErrors()) { console.error(err || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  // Exclude remote font imports: this preview stays independent of external services.
  let css = fs.readFileSync(path.join(frontend, 'src/index.css'), 'utf8').replace(/^@import.*$/gm, '');
  const result = await postcss([tailwind(require(path.join(frontend, 'tailwind.config.js'))), autoprefixer]).process(css, { from: undefined });
  fs.writeFileSync(path.join(out, 'preview.css'), result.css);
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local repair preview</title><link rel="stylesheet" href="preview.css"></head><body><div id="root"></div><script src="preview.js"></script></body></html>');
  console.log('Offline visual preview built');
});
