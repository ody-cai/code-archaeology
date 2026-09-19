import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine } from '../src/miner.js';
import * as render from '../public/render.js';

const sha = 'a'.repeat(40);
export function historyFetch() {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u);
    let data;
    if (u.pathname === '/repos/owner/repo') data = { full_name: 'owner/repo', default_branch: 'main', created_at: '2025-01-01T00:00:00Z', pushed_at: '2026-01-01T00:00:00Z', stargazers_count: 0, forks_count: 0, open_issues_count: 0, size: 1, language: 'JavaScript', archived: false };
    else if (u.pathname === '/repos/owner/repo/commits') data = [{ sha }];
    else if (u.pathname === `/repos/owner/repo/commits/${sha}`) data = { sha, parents: [], author: { login: 'fixture', type: 'User' }, commit: { author: { name: 'fixture', date: '2026-01-01T00:00:00Z' }, message: 'refactor: simplify helper implementation to reduce duplication' }, files: [{ filename: 'src/a.js', status: 'modified', additions: 2, deletions: 1 }] };
    else throw new Error('Unexpected fixture URL');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

test('miner pins historical commits to requested immutable SHA, retaining old branch behavior', async () => {
  for (const ref of [sha, undefined]) {
    const fixture = historyFetch();
    const report = await mine({ repo: 'owner/repo', limit: 10, ref, fetchImpl: fixture.fetchImpl });
    const query = fixture.calls.find((u) => u.pathname.endsWith('/commits'));
    assert.equal(query.searchParams.get('sha'), ref || 'main');
    assert.equal(report.hotspots[0].file, 'src/a.js');
    assert.equal(report.signalQuality.signalCommits, 1);
  }
});
test('original archaeology rendering works with real miner output under deterministic transport', async () => {
  const report = await mine({ repo: 'owner/repo', limit: 10, ref: sha, fetchImpl: historyFetch().fetchImpl });
  for (const fn of [render.renderRepoHead, render.renderSignalQuality, render.renderTimeline, render.renderRiskFactors, render.renderHotspots, render.renderExcavation]) {
    const html = fn(report);
    assert.ok(html.length > 0);
    assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
  }
});
