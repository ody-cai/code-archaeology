import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDiffLines,
  contentOverlap,
  classifyAbandonment,
  isGlobalRevert,
  OVERLAP_THRESHOLD,
} from '../src/core/overlap.js';

// 以下 patch 取自 2026-09-19 用 GitHub API 逐条核对的四个真实案例，
// 行内容为真实 diff 行。把它们固化下来，是为了防止「按行数判定」的旧逻辑回来 ——
// 那版会把括号里这三条假阳性一起报成「被放弃的尝试」。

const patch = (...lines) => lines.join('\n');

// 案例一 · chalk/chalk source/index.js —— 假阳性
// 4c304dd(+19「Add extended underline styles」) → 5729845(-35「Improve performance」)
// 5729845 是 4c304dd 的直接子提交，下划线样式至今仍在 main 上。
// 实测重合率 14%。
const CHALK_ADD = patch(
  '@@ -110,6 +110,9 @@',
  '+for (const style of underlineStyles) {',
  '+	styles[style] = createStyler(styleAnsi, styleClose, this[STYLER]);',
  '+}',
  '+const {level} = this;',
  '+return function (...arguments_) {',
  '+const styler = createStyler(getModelAnsi(model, levelMapping[level], type, ...arguments_), close, this[STYLER]);'
);

const CHALK_REMOVE = patch(
  '@@ -100,20 +100,18 @@',
  '-const escapeStringRegexp = require("escape-string-regexp");',
  '-const ansiStyles = require("ansi-styles");',
  '-const {stdout} = require("supports-color");',
  '-const {level} = this;',
  '-return function (...arguments_) {',
  '-const styler = createStyler(getModelAnsi(model, levelMapping[level], type, ...arguments_), close, this[STYLER]);',
  '-return styler(arguments_);',
  '-};',
  '-const open = `\\u001B[${code}m`;',
  '-const close = `\\u001B[${code + 10}m`;',
  '-return this._styler(open, close, arguments_);',
  '-const proto = Object.create(null);',
  '-const styleObject = new Chalk({level: 1});',
  '-const model = getModelAnsi(type, level, model);',
  '-const closed = openAll + closeAll;',
  '-const string = arguments_.join(" ");',
  '-const hasStyle = string.length > 0;',
  '-const levelMapping = ["ansi", "ansi", "ansi256", "ansi16m"];',
  '-const applyOptions = (object, options = {}) => {};',
  '-const result = this._generator(...arguments_);',
  '-const enabled = supportsColor.stdout !== false;',
  '-const templates = this._styles.slice();'
);

// 案例二 · oa-system src/app/api/email/send/route.ts —— 真阳性
// b86cce0(「feat: 集成邮件发送功能（Resend）」) → 7c78ec0(「fix: 清理不需要的邮件相关代码和依赖」)
// 间隔 52 分钟，整个功能被原样拆掉。实测重合率 100%。
const EMAIL_ADD = patch(
  '@@ -0,0 +1,6 @@',
  "+import { NextRequest, NextResponse } from 'next/server';",
  "+import { Resend } from 'resend';",
  '+',
  '+const resend = new Resend(process.env.RESEND_API_KEY);',
  '+',
  '+export async function POST(request: NextRequest) {'
);

const EMAIL_REMOVE = patch(
  '@@ -1,6 +0,0 @@',
  "-import { NextRequest, NextResponse } from 'next/server';",
  "-import { Resend } from 'resend';",
  '-',
  '-const resend = new Resend(process.env.RESEND_API_KEY);',
  '-',
  '-export async function POST(request: NextRequest) {'
);

test('extractDiffLines 区分增删并忽略文件头', () => {
  const parsed = extractDiffLines(patch('--- a/x.js', '+++ b/x.js', '@@ -1 +1 @@', '-old line here', '+new line here'));
  assert.deepEqual(parsed, { added: ['new line here'], removed: ['old line here'] });
});

test('extractDiffLines 对空输入返回 null 而不是抛错', () => {
  assert.equal(extractDiffLines(''), null);
  assert.equal(extractDiffLines(null), null);
  assert.equal(extractDiffLines(undefined), null);
});

test('真阳性：删除行原样来自新增行 → 重合率 100%', () => {
  const ov = contentOverlap(EMAIL_ADD, EMAIL_REMOVE);
  assert.equal(ov.verifiable, true);
  assert.equal(ov.rate, 1);
  assert.equal(classifyAbandonment(ov.rate).abandoned, true);
});

test('假阳性：删除行来自重写后的代码 → 重合率远低于阈值', () => {
  const ov = contentOverlap(CHALK_ADD, CHALK_REMOVE);
  assert.equal(ov.verifiable, true);
  assert.ok(ov.rate < OVERLAP_THRESHOLD, `chalk 案例重合率应低于阈值，实得 ${ov.rate}`);
  const verdict = classifyAbandonment(ov.rate);
  assert.equal(verdict.abandoned, false);
  assert.match(verdict.note, /重写/);
});

test('过短的行不参与比对，避免「}」这类噪音制造假重合', () => {
  const a = patch('+}', '+);', '+const alpha = computeAlpha();');
  const b = patch('-}', '-);', '-const beta = computeBeta();');
  const ov = contentOverlap(a, b);
  // 「}」「);」被过滤，两侧各只剩一条有效行，且互不相同
  assert.equal(ov.comparable, 1);
  assert.equal(ov.hits, 0);
  assert.equal(ov.rate, 0);
});

test('拿不到 patch 时不判定为假阳性，保留为待核实线索', () => {
  const ov = contentOverlap(null, CHALK_REMOVE);
  assert.equal(ov.verifiable, false);
  assert.equal(ov.rate, null);
  // 关键：不可核实 ≠ 假阳性。宁可保留可疑条目，也不丢掉真阳性。
  assert.equal(classifyAbandonment(ov.rate).abandoned, true);
});

test('classifyAbandonment 在阈值两侧行为相反', () => {
  assert.equal(classifyAbandonment(0.49).abandoned, false);
  assert.equal(classifyAbandonment(0.5).abandoned, true);
  assert.equal(classifyAbandonment(0.51).abandoned, true);
});

test('isGlobalRevert 识别整仓回滚，且不误伤普通提交信息', () => {
  // 真实案例：oa-system 109fd2c
  assert.equal(isGlobalRevert("Restored to 'acd42d064de80515a359f70e6816d9b346c474ce'"), true);
  assert.equal(isGlobalRevert('Restore to abc1234'), true);
  assert.equal(isGlobalRevert('restored to 4c304dd'), true);
  // 反例：正常提交信息不该被当成回滚
  assert.equal(isGlobalRevert('fix: 清理不需要的邮件相关代码和依赖'), false);
  assert.equal(isGlobalRevert('revert: 撤销上一次改动'), false);
  assert.equal(isGlobalRevert('Improve performance'), false);
  assert.equal(isGlobalRevert(''), false);
  assert.equal(isGlobalRevert(undefined), false);
});
