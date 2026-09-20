import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSiteUrl, externalUrl, safeDownloadName, isAllowedDownload, securePreferences, SITE_URL } from '../src/desktop-policy.mjs';

test('网站入口固定为同一个 Pages URL', () => {
  assert.equal(SITE_URL, 'https://code-archaeology.pages.dev/');
  assert.equal(isSiteUrl(SITE_URL), true);
  assert.equal(isSiteUrl('https://code-archaeology.pages.dev.evil.example/'), false);
  assert.equal(isSiteUrl('javascript:alert(1)'), false);
});

test('外部链接只接受无凭据的 HTTP(S)', () => {
  assert.equal(externalUrl('https://github.com/ody-cai/oa-system'), 'https://github.com/ody-cai/oa-system');
  assert.equal(externalUrl('javascript:alert(1)'), null);
  assert.equal(externalUrl('https://user:pass@example.com/'), null);
  assert.equal(externalUrl('file:///etc/passwd'), null);
});

test('下载只能来自网站同源或网站 blob', () => {
  assert.equal(isAllowedDownload('https://code-archaeology.pages.dev/a.diff', SITE_URL), true);
  assert.equal(isAllowedDownload('blob:https://code-archaeology.pages.dev/id', SITE_URL), true);
  assert.equal(isAllowedDownload('https://evil.example/a.diff', SITE_URL), false);
  assert.equal(isAllowedDownload('https://code-archaeology.pages.dev/a.diff', 'https://evil.example/'), false);
});

test('Windows 文件名经过安全清理', () => {
  assert.equal(safeDownloadName('../review.diff'), 'review.diff');
  assert.equal(safeDownloadName('CON'), 'download-CON');
  assert.equal(safeDownloadName('bad<>:"|?*name.diff'), 'bad_______name.diff');
});

test('桌面渲染器保持沙箱和隔离，不开 Node 集成', () => {
  const p = securePreferences();
  assert.equal(p.sandbox, true);
  assert.equal(p.contextIsolation, true);
  assert.equal(p.nodeIntegration, false);
  assert.equal(p.webviewTag, false);
});

test('离线页不伪造分析结果', async () => {
  const html = await readFile(new URL('../assets/offline.html', import.meta.url), 'utf8');
  assert.match(html, /无法连接网站/);
  assert.match(html, /不会显示缓存的分析结果或伪造数据/);
  assert.doesNotMatch(html, /unsplash|placeholder|lorem/i);
});
