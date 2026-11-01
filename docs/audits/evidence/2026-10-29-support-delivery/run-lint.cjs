const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const runtime = createRequire(path.join(process.env.RAW_SUPPORT_TEST_DEPS, '..', 'package.json'));
const { LegacyESLint } = runtime('eslint/use-at-your-own-risk');
(async () => {
  const lint = new LegacyESLint({ cwd: process.cwd(), useEslintrc: false, resolvePluginsRelativeTo: process.env.RAW_SUPPORT_TEST_DEPS,
    baseConfig: { env: { browser: true, es2022: true, node: true, jest: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      plugins: ['react', 'react-hooks'], rules: { 'no-undef': 'error',
        'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrors: 'none' }],
        'react/jsx-uses-react': 'error', 'react/jsx-uses-vars': 'error', 'react-hooks/rules-of-hooks': 'error' } } });
  const result = await lint.lintFiles(['frontend/src/components/support/*.js', 'frontend/src/components/Auth.js',
    'frontend/src/components/admin/AdminSupportDashboard.js', 'frontend/src/components/admin/AdminSupportDashboard.test.js',
    'frontend/src/components/admin/AdminSupportDashboard.metrics.test.js']);
  fs.writeFileSync(path.join(__dirname, 'lint-raw.json'), JSON.stringify(result));
  console.log(JSON.stringify(result.map(file => ({ file: path.relative(process.cwd(), file.filePath), errors: file.errorCount,
    warnings: file.warningCount, messages: file.messages }))));
  process.exitCode = result.some(file => file.errorCount || file.warningCount) ? 1 : 0;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
