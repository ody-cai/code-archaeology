import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePatch } from '../src/refactor/patch.js';
import { safePath, safeRepo, bounded, assertNoSecrets } from '../src/refactor/safety.js';

const file = 'src/a.js';
const source = 'const a = 1;\nexport { a };\n';
const diff = '--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n export { a };\n';
const apply = (patch, text = source) => validatePatch({ diff: patch, source: text, file });

test('exact single-file diff applies without evaluating source', () => {
  assert.deepEqual(apply(diff), { source: 'const a = 2;\nexport { a };\n', changedLines: 2, hunks: 1 });
});
test('supports standard git header, exact-context multi-hunks, insertion and deletion', () => {
  assert.equal(apply('diff --git a/src/a.js b/src/a.js\n' + diff).changedLines, 2);
  assert.equal(apply('--- a/src/a.js\n+++ b/src/a.js\n@@ -0,0 +1 @@\n+// header\n').source, '// header\n' + source);
  assert.equal(apply('--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +0,0 @@\n-const a = 1;\n').source, 'export { a };\n');
  const p = '--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-a\n+A\n@@ -3 +3 @@\n-c\n+C\n';
  assert.equal(apply(p, 'a\nb\nc\n').source, 'A\nb\nC\n');
});
test('100 changed lines allowed; 101/102 rejected', () => {
  const before = Array.from({ length: 50 }, (_, i) => `let a${i}=1;`);
  const after = before.map((s) => s.replace('=1', '=2'));
  const p = `--- a/${file}\n+++ b/${file}\n@@ -1,50 +1,50 @@\n${before.map((s) => '-' + s).join('\n')}\n${after.map((s) => '+' + s).join('\n')}\n`;
  assert.equal(apply(p, before.join('\n') + '\n').changedLines, 100);
  assert.throws(() => apply(p.replace('+1,50', '+1,51') + '+// extra\n', before.join('\n') + '\n'), { code: 'patch_too_large' });
});
for (const [name, bad] of Object.entries({
  wrongContext: diff.replace('-const a = 1;', '-const a = 9;'),
  wrongPath: diff.replace('+++ b/src/a.js', '+++ b/src/b.js'),
  traversal: diff.replace('+++ b/src/a.js', '+++ b/../a.js'),
  absolute: diff.replace('+++ b/src/a.js', '+++ /tmp/a.js'),
  counts: diff.replace('-1,2', '-1,3'),
  overlap: diff + '@@ -1 +1 @@\n-const a = 1;\n+const a = 4;\n',
  secondFile: diff + '--- a/src/b.js\n+++ b/src/b.js\n@@ -1 +1 @@\n-x\n+y\n',
  binary: 'GIT binary patch\n',
  mode: 'old mode 100644\nnew mode 120000\n' + diff,
  noNewline: diff + '\\ No newline at end of file\n',
  crlf: diff.replaceAll('\n', '\r\n'),
  nul: diff + '\0',
  noChange: '--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,2 @@\n const a = 1;\n export { a };\n',
  sameResult: diff.replace('+const a = 2;', '+const a = 1;'),
})) test(`reject malformed/unsafe patch: ${name}`, () => assert.throws(() => apply(bad)));

for (const value of ['../a.js', '/a.js', 'a/../b.js', 'a//b.js', 'a\\b.js', '.github/a.js', 'a/.hidden.js', 'package.json', 'node_modules/a.js', 'src/secrets.js', 'dist/a.js', 'src/a.min.js', 'a.js?x', 'a%2fb.js']) {
  test(`reject unsafe path: ${value}`, () => assert.throws(() => safePath(value)));
}
test('reject non-text, oversized, or non-LF source', () => {
  for (const text of ['', 'a', 'a\r\n', 'a\0\n', 'a'.repeat(64001) + '\n']) assert.throws(() => apply(diff, text));
});
test('repository parser refuses URLs and endpoint injection', () => {
  assert.equal(safeRepo('Owner/Repo'), 'owner/repo');
  for (const repo of ['https://github.com/a/b', 'a/b?x', 'a/b/c', '../b', 'a/b.git', 'a/%2f']) assert.throws(() => safeRepo(repo));
});
test('known credentials and recognizable token formats are rejected', () => {
  assert.throws(() => assertNoSecrets('const key="not-a-real-secret";', ['not-a-real-secret']), { code: 'sensitive_content' });
  assert.throws(() => assertNoSecrets('gho_' + 'x'.repeat(20)), { code: 'sensitive_content' });
  assert.doesNotThrow(() => assertNoSecrets(source));
});
test('deadline rejects even an upstream which ignores AbortSignal', async () => {
  await assert.rejects(bounded(() => new Promise(() => {}), 1, 'fixture_timeout'), { code: 'fixture_timeout', status: 504 });
});
