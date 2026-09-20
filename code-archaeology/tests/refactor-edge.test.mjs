// Actual workerd fetch-init regression; upstream replies are mocked, never public writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('workerd: GitHub adapter accepts manual, reads success, rejects redirects without forwarding credentials', { timeout: 30000 }, async () => {
  const { outputFiles } = await build({
    stdin: { contents: `import { createGitHub } from './src/refactor/github.js';
      export default { async fetch(request) {
        try {
          const gh = createGitHub({ token: 'fixture-token-not-real' });
          const data = await gh.request(new URL(request.url).pathname);
          return Response.json({ data });
        } catch (e) { return Response.json({ code: e.code }, { status: e.status || 500 }); }
      } };`, resolveDir: root, sourcefile: 'edge-regression.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  const statuses = [301, 302, 303, 307, 308];
  let forwarded = 0;
  const outboundService = async (request) => {
    const url = new URL(request.url);
    if (url.origin !== 'https://api.github.com') {
      forwarded++;
      return Response.json({ forwarded: true });
    }
    if (url.pathname === '/success') return Response.json({ success: true });
    const status = Number(url.pathname.split('-').at(-1));
    assert.ok(statuses.includes(status));
    return new Response('not-json', { status, headers: { location: 'https://redirect.invalid/blocked' } });
  };
  const mf = new Miniflare({ modules: true, script: outputFiles[0].text, compatibilityDate: '2024-11-01',
    host: '127.0.0.1', port: 0, outboundService });
  try {
    const success = await mf.dispatchFetch('http://localhost/success');
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { data: { success: true } });
    for (const status of statuses) {
      const res = await mf.dispatchFetch(`http://localhost/redirect-${status}`);
      assert.equal(res.status, 421);
      assert.deepEqual(await res.json(), { code: 'unsafe_redirect' });
    }
    assert.equal(forwarded, 0, 'No redirected request may receive credentials');
  } finally {
    await mf.dispose();
  }
});
