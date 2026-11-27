/** @jest-environment node */
const { devServer } = require('../../craco.config');

test('CRA middleware stays behind the server guards and sees current compiler stats', () => {
  const before = jest.fn();
  const after = jest.fn();
  const config = devServer({
    allowedHosts: 'all',
    headers: { 'Access-Control-Allow-Origin': '*' },
    https: false,
    devMiddleware: { publicPath: '/surf' },
    onBeforeSetupMiddleware: before,
    onAfterSetupMiddleware: after,
  });
  expect(config).toMatchObject({
    allowedHosts: 'auto', server: 'http', devMiddleware: { publicPath: '/surf/' },
  });
  expect(config.headers).toBeUndefined();
  const guards = [{ name: 'host-header-check' }, { name: 'cross-origin-header-check' }];
  const assets = { name: 'webpack-dev-middleware' };
  const server = { stopCallback: jest.fn() };
  const middleware = config.setupMiddlewares([...guards, assets], server);
  const beforeServer = before.mock.calls[0][0];
  expect(middleware).toEqual([...guards, beforeServer.app, assets, after.mock.calls[0][0].app]);
  server.stats = { hash: 'new-build' };
  expect(beforeServer._stats).toBe(server.stats);
  server.close();
  expect(server.stopCallback).toHaveBeenCalledTimes(1);
});
