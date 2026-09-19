import { fail, safePath, encoder } from './safety.js';

// Deliberately narrow unified-diff dialect: exact context, no fuzz, no rename,
// mode changes, binary patches, symlinks, multiple files or missing-newline markers.
export function validatePatch({ diff, source, file }) {
  safePath(file);
  if (typeof source !== 'string' || !source.endsWith('\n') || source.includes('\r') || source.includes('\0') || encoder.encode(source).length > 64000) {
    fail('unsupported_source', '仅支持不超过 64KB、LF 结尾的 UTF-8 文本源码。', 422);
  }
  if (typeof diff !== 'string' || !diff.endsWith('\n') || diff.includes('\r') || diff.includes('\0') || encoder.encode(diff).length > 96000) {
    fail('invalid_patch', '补丁必须是有大小上限的 LF unified diff。', 422);
  }
  const lines = diff.split('\n');
  lines.pop();
  let i = 0;
  if (lines[0] === `diff --git a/${file} b/${file}`) i++;
  if (lines[i++] !== `--- a/${file}` || lines[i++] !== `+++ b/${file}`) {
    fail('unsafe_patch_path', '补丁路径必须严格匹配所选单个源码文件。', 422);
  }
  const original = source.slice(0, -1).split('\n');
  const output = [];
  let cursor = 0, changedLines = 0, hunks = 0;
  while (i < lines.length) {
    const header = lines[i++].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/);
    if (!header) fail('invalid_patch', '补丁包含非法区块或额外文件。', 422);
    const [, os, oc = '1', ns, nc = '1'] = header;
    const oldStart = Number(os), oldCount = Number(oc), newStart = Number(ns), newCount = Number(nc);
    const start = oldCount === 0 ? oldStart : oldStart - 1;
    if (start < cursor || start > original.length || (oldCount > 0 && oldStart < 1)) fail('patch_context_mismatch', '补丁区块位置非法或重叠。', 422);
    output.push(...original.slice(cursor, start));
    cursor = start;
    if ((newCount === 0 ? newStart : newStart - 1) !== output.length) fail('invalid_patch', '补丁新文件区块位置不一致。', 422);
    let consumed = 0, produced = 0;
    while (i < lines.length && !lines[i].startsWith('@@ ')) {
      const line = lines[i++], prefix = line[0], text = line.slice(1);
      if (![' ', '+', '-'].includes(prefix)) fail('invalid_patch', '补丁含不支持的行类型。', 422);
      if (prefix !== '+') {
        if (cursor >= original.length || original[cursor] !== text) fail('patch_context_mismatch', '补丁无法精确应用到固定基础提交源码。', 422);
        cursor++; consumed++;
      }
      if (prefix !== '-') { output.push(text); produced++; }
      if (prefix !== ' ') changedLines++;
      if (changedLines > 100) fail('patch_too_large', '单次新增行数与删除行数之和不得超过 100。', 422);
    }
    if (consumed !== oldCount || produced !== newCount) fail('invalid_patch', '补丁区块行数不一致。', 422);
    hunks++;
  }
  if (!hunks || !changedLines) fail('empty_patch', '没有可审阅的有效改动。', 422);
  output.push(...original.slice(cursor));
  const result = output.length ? output.join('\n') + '\n' : '';
  if (!result || result === source || encoder.encode(result).length > 64000) fail('invalid_patch', '不允许空文件、无效变更或超限结果。', 422);
  return { source: result, changedLines, hunks };
}
