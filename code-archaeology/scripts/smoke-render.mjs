// 渲染层冒烟测试 —— 两个阶段，分别堵住两类不同的问题。
//
// 阶段一 · 合成数据渲染：快，不依赖模型，验证每个渲染函数不抛错、
//   不产生空输出、不让 NaN/undefined 漏进 HTML。
//
// 阶段二 · 真实 API 契约：走完整 HTTP 路径（router → 参数校验 → 端点 → 编排），
//   再用与 app.js 完全相同的提取逻辑喂给渲染层。
//
//   为什么要单独做阶段二：曾经 /api/excavate 返回的是外壳
//   { mined, report, analysis, degraded }，而前端直接把外壳当 analysis 用，
//   导致 available 永远 undefined，页面永远显示降级提示。
//   阶段一只用合成数据，结构是我自己捏的，所以完全测不到这个 bug。
//   教训：渲染层的测试必须喂真实来源的数据，否则测的是我自己的想象。
//
// 用法：node scripts/smoke-render.mjs [owner/repo] [limit]

import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../public/render.js';
import { mine } from '../src/miner.js';
import { handle } from '../src/api/router.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function getToken() {
  try {
    const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return out.match(/^password=(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

async function loadEnv() {
  const env = { ...process.env };
  try {
    const txt = await readFile(path.join(ROOT, '.dev.vars'), 'utf8');
    for (const line of txt.split('\n')) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (v) env[m[1]] = v;
    }
  } catch {
    /* 无 .dev.vars */
  }
  if (!env.GITHUB_TOKEN) env.GITHUB_TOKEN = getToken();
  return env;
}

const repo = process.argv[2] || 'chalk/chalk';
const limit = Number(process.argv[3] || 30);
const env = await loadEnv();

let failures = 0;
const fail = (msg) => {
  console.log(`    ✗ ${msg}`);
  failures++;
};

/* ══ 阶段一：合成数据渲染 ══════════════════════════════ */

console.log(`\n═══ 阶段一 · 合成数据渲染 ═══\n`);
const report = await mine({ repo, limit, token: env.GITHUB_TOKEN });

// 合成分析层 —— 结构必须恒定，不能受被分析仓库的偶然特征影响。
//
// 这里原本写成 `report.abandoned.length ? 完整结构 : {available:false}`，
// 后果是：仓库没有「被放弃的尝试」时（如 axios），叙事/假设/裁决/接地四个区块
// 全部走降级路径而被误报成「空输出」；而仓库恰好有假阳性条目时，夹具反而"通过"。
// 也就是说，假阳性曾经掩盖了夹具自身的缺陷 —— 判定修准之后它才暴露出来。
// 合成数据要测的是「渲染层面对完整结构能不能正常工作」，那就无条件给它完整结构。
const stubCase = report.abandoned[0] ?? {
  file: 'src/stub.js',
  addSha: report.timeline[0]?.sha ?? '0f1e2d3',
  removeSha: report.timeline.at(-1)?.sha ?? '4a5b6c7',
};

const stubAnalysis = {
  available: true,
  modelStatus: { models: { narrator: 'stub', hypothesizer: 'stub', appraiser: 'stub' }, distinctModels: 3, mode: '多模型分工' },
  narrative: {
    headline: '占位标题',
    narrative: '第一段。\n\n第二段。',
    currentState: '占位结论',
    turningPoints: [
      {
        sha: report.timeline[0]?.sha,
        date: report.timeline[0]?.date,
        title: '占位转折点',
        what: 'A',
        why: 'B',
        evidence: [report.timeline[0]?.sha],
        evidenceAudit: { status: 'grounded' },
      },
    ],
  },
  hypotheses: {
    skipped: false,
    overallPattern: '占位模式',
    hypotheses: [
      {
        file: stubCase.file,
        addSha: stubCase.addSha,
        removeSha: stubCase.removeSha,
        attempted: 'A',
        whyAbandoned: 'B',
        usualPattern: 'C',
        confidence: '低',
        evidence: [stubCase.addSha],
        evidenceAudit: { status: 'grounded' },
      },
    ],
  },
  appraisal: {
    verdict: '占位裁决',
    riskLevel: report.risk.level,
    riskDrivers: [{ title: '占位风险', detail: 'D', evidence: [report.timeline[0]?.sha], evidenceAudit: { status: 'grounded' } }],
    adviceForNewcomer: ['建议一', '建议二'],
    doubts: [{ claim: 'C', concern: 'D' }],
    interviewQuestions: ['问题一'],
  },
  evidenceAudit: {
    overall: { claims: 3, fabricated: 0, invalidCitations: 0 },
    narrative: { grounded: 1, citations: 1 },
    hypothesis: { grounded: 1, citations: 1 },
  },
  degradations: [],
};

const stubDegraded = { available: false, reason: '合成降级用例', degradations: [{ stage: 'narrator', error: 'fixture' }] };

const synthetic = {
  仓库头: () => R.renderRepoHead(report),
  信噪比: () => R.renderSignalQuality(report),
  时间轴: () => R.renderTimeline(report),
  风险因子: () => R.renderRiskFactors(report),
  文件热度: () => R.renderHotspots(report),
  地层证据: () => R.renderExcavation(report),
  叙事层: () => R.renderNarrative(stubAnalysis, null),
  假设层: () => R.renderHypotheses(stubAnalysis),
  裁决层: () => R.renderAppraisal(stubAnalysis),
  证据接地: () => R.renderEvidenceAudit(stubAnalysis),
  降级提示: () => R.degradationNotice(stubDegraded, report),
  降级叙事: () => R.renderNarrative(stubDegraded, report),
};

let syntheticBad = 0;
for (const [name, fn] of Object.entries(synthetic)) {
  let html = '';
  try {
    html = fn();
  } catch (e) {
    console.log(`  ${name.padEnd(10)} ✗ 抛错：${e.message}`);
    syntheticBad++;
    continue;
  }
  const dirty = (html.match(/undefined|NaN|\[object Object\]/g) || []).length;
  const empty = html.length === 0;
  const flag = empty ? '⚠ 空输出' : dirty ? `⚠ ${dirty} 处脏值` : '✓';
  if (empty || dirty) syntheticBad++;
  console.log(`  ${name.padEnd(10)} ${String(html.length).padStart(6)} 字符  ${flag}`);
}
if (syntheticBad) fail(`${syntheticBad} 个区块渲染异常`);

// renderAppraisal 的降级契约是「什么都不输出」—— 降级提示由叙事层统一给出，
// 两处都渲染会让同一页出现两遍同样的红框。这条断言不能放进上面的循环里，
// 因为该循环把「空输出」一律视为失败，而这里空输出才是正确行为。
if (R.renderAppraisal(stubDegraded) !== '') {
  fail('renderAppraisal 在降级时应当返回空，否则会与叙事层的降级提示重复');
}

/* ══ 阶段二：真实 API 契约 ══════════════════════════════ */

console.log(`\n═══ 阶段二 · 真实 API 契约（走完整 HTTP 路径）═══\n`);

if (!env.LLM_API_KEY) {
  console.log('  ⚠ 未配置模型，跳过 —— 阶段二是唯一能覆盖「外壳/内层结构错位」的测试\n');
} else {
  const t0 = Date.now();
  const res = await handle(
    new Request('http://smoke.local/api/excavate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ report }),
    }),
    env
  );
  const body = await res.json();
  const ms = Date.now() - t0;

  console.log(`  HTTP ${res.status} · ${(ms / 1000).toFixed(1)}s`);

  if (res.status !== 200 || body.error) {
    fail(`接口返回错误：${body.error ?? res.status} ${body.message ?? ''}`);
  } else {
    const payload = body.data;

    // 契约断言：外壳必须具备这四个字段
    if (!('mined' in payload)) fail('返回外壳缺少 mined 字段');
    if (!payload.report) fail('返回外壳缺少 report 字段');
    if (!payload.analysis) fail('返回外壳缺少 analysis 字段');
    if (!('degraded' in payload)) fail('返回外壳缺少 degraded 字段');

    const analysis = payload.analysis;

    // 关键断言：analysis 自身必须有布尔型 available。
    // 这条就是当初那个 bug 的检测点 —— 外壳没有 available，内层才有。
    if (typeof analysis?.available !== 'boolean') {
      fail(`analysis.available 不是布尔值（实际 ${typeof analysis?.available}）—— 可能又把外壳当内层用了`);
    }

    if (analysis.available) {
      if (!analysis.modelStatus?.distinctModels) fail('analysis.modelStatus.distinctModels 缺失');
      if (!analysis.evidenceAudit?.overall) fail('analysis.evidenceAudit.overall 缺失');

      // 「被放弃的尝试」的可复核性契约：被否定的判定和整仓回滚必须一并交付。
      // 只给「发现了什么」而不给「否定了什么」，报告就无法被复核。
      if (!Array.isArray(payload.report.abandonedRejected)) {
        fail('report.abandonedRejected 缺失或不是数组 —— 被否定的判定没有随报告交付');
      }
      if (!Array.isArray(payload.report.globalReverts)) {
        fail('report.globalReverts 缺失或不是数组 —— 整仓回滚没有单独区分');
      }
      for (const a of payload.report.abandoned ?? []) {
        if (typeof a.verified !== 'boolean') {
          fail(`被放弃条目 ${a.file} 缺少 verified 标志 —— 无法判断是否经过内容核实`);
        }
      }

      // 用与 app.js 完全相同的提取逻辑渲染，然后检查是否误落降级分支
      const html = [
        R.renderNarrative(analysis, null),
        R.renderHypotheses(analysis),
        R.renderAppraisal(analysis),
        R.renderEvidenceAudit(analysis),
      ].join('');

      const hypCount = analysis.hypotheses.hypotheses.length;
      console.log(`  模型分析渲染 ${html.length} 字符 · 动用 ${analysis.modelStatus.distinctModels} 个模型`);
      console.log(
        `  叙事 ${analysis.narrative.turningPoints.length} 个转折点 · 假设 ${hypCount} 条` +
          `${analysis.hypotheses.skipped ? '（窗口内无可推断案例，按设计跳过）' : ''} · ` +
          `编造 ${analysis.evidenceAudit.overall.fabricated} 条`
      );

      // 「跳过」与「空产出」是两回事：前者是设计，后者是结构坏了。
      // 没有这条区分，一个仓库恰好没有可推断案例时，测试会以一个看起来像失败的数字收场。
      if (!analysis.hypotheses.skipped && hypCount === 0) {
        fail('假设层既未标记跳过、也没有产出任何条目 —— 结构可能被破坏');
      }

      if (html.includes('模型分析层当前不可用')) {
        fail('明明 available 为真，却渲染出了降级提示 —— 提取逻辑与渲染层的契约不一致');
      }
      if (html.includes('未配置模型')) {
        fail('页面出现了兜底文案「未配置模型」—— 说明 reason 与 degradations 都为空，降级路径被误触发');
      }
      const dirty = (html.match(/undefined|NaN|\[object Object\]/g) || []).length;
      if (dirty) fail(`模型分析区块有 ${dirty} 处脏值`);
      if (!html.includes('证据接地报告') && analysis.evidenceAudit?.overall) {
        fail('证据接地报告区块未渲染');
      }
    } else {
      console.log(`  ⚠ 模型层返回降级：${analysis.reason}`);
      console.log(`    降级记录：${JSON.stringify(analysis.degradations)}`);
    }
  }
}

/* ══ 结论 ═══════════════════════════════════════════ */

console.log(
  failures === 0
    ? `\n  ✓ 两阶段全部通过：渲染无脏值，且 API 外壳与渲染层的契约一致\n`
    : `\n  ✗ 共 ${failures} 项失败\n`
);
process.exit(failures ? 1 : 0);
