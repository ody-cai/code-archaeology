import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine } from '../src/miner.js';
import * as render from '../public/render.js';

const sha = 'a'.repeat(40);
function fixture() {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u);
    let value;
    if (u.pathname === '/repos/test/repo') value = { full_name: 'test/repo', default_branch: 'main', stargazers_count: 0, forks_count: 0, created_at: '2026-09-19T00:00:00Z', language: 'JavaScript' };
    else if (u.pathname === '/repos/test/repo/commits') value = [{ sha }];
    else if (u.pathname === `/repos/test/repo/commits/${sha}`) value = {
      sha, author: { login: 'fixture', type: 'User' }, commit: { message: 'refactor: simplify branch without behavior change', author: { name: 'Fixture', email: 'fixture@example.test', date: '2026-09-19T00:00:00Z' } },
      parents: [], files: [{ filename: 'src/a.js', status: 'modified', additions: 2, deletions: 2 }],
    };
    else throw new Error('Unexpected fixture route');
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}
test('miner actually queries fixed SHA rather than moving default branch', async () => {
  const f = fixture();
  const report = await mine({ repo: 'test/repo', limit: 10, ref: sha, fetchImpl: f.fetchImpl });
  assert.equal(f.calls.find((u) => u.pathname.endsWith('/commits')).searchParams.get('sha'), sha);
  assert.equal(report.hotspots[0].file, 'src/a.js');
  assert.equal(report.hotspots[0].sequence[0].sha, sha.slice(0, 7));
});
test('existing mine default-branch behavior and report rendering remain intact', async () => {
  const f = fixture();
  const report = await mine({ repo: 'test/repo', limit: 10, fetchImpl: f.fetchImpl });
  assert.equal(f.calls.find((u) => u.pathname.endsWith('/commits')).searchParams.get('sha'), 'main');
  for (const fn of ['renderRepoHead', 'renderSignalQuality', 'renderTimeline', 'renderRiskFactors', 'renderHotspots', 'renderExcavation']) {
    const html = render[fn](report);
    assert.ok(html.length > 0, fn);
    assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/, fn);
  }
});
