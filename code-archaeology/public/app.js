// 主控层 —— 负责流程编排与状态，渲染全部委托给 render.js。
//
// 流程设计成两步，是刻意的：
//   第一步只调用纯计算接口，5 秒左右就能出硬指标 —— 演示时观众先看到真数据；
//   第二步再把上一步的完整报告交给多模型流水线，叠加叙事与推断。
// 这样做还有个好处：模型层没配好时，第一步照样成立，演示不会开天窗。

import {
  renderRepoHead,
  renderSignalQuality,
  renderTimeline,
  renderRiskFactors,
  renderHotspots,
  renderExcavation,
  renderNarrative,
  renderHypotheses,
  renderAppraisal,
  renderEvidenceAudit,
  esc,
} from './render.js';
import { mountRefactor } from './refactor.js';

const $ = (id) => document.getElementById(id);

const el = {
  form: $('digForm'),
  repo: $('repo'),
  limit: $('limit'),
  btn: $('digBtn'),
  progress: $('progress'),
  progressTitle: $('progressTitle'),
  progressSub: $('progressSub'),
  progressTimer: $('progressTimer'),
  progressSteps: $('progressSteps'),
  errorBox: $('errorBox'),
  errorTitle: $('errorTitle'),
  errorMsg: $('errorMsg'),
  errorHint: $('errorHint'),
  report: $('report'),
  modelInfo: $('modelInfo'),
  modelDot: $('modelDot'),
};

// 与实际请求阶段一一对应，不用假计时器凑动画
const STEPS = [
  { id: 'meta', label: '读取仓库元信息' },
  { id: 'commits', label: '拉取提交列表' },
  { id: 'diffs', label: '逐条解析改动内容' },
  { id: 'mine', label: '信噪分离 · 重建文件变更史' },
  { id: 'narrator', label: '叙事者还原决策史' },
  { id: 'hypothesizer', label: '假设者推断被放弃的方案' },
  { id: 'verify', label: '程序校验证据接地' },
  { id: 'appraiser', label: '审稿人复核并裁决' },
];

let timer = null;
let t0 = 0;
let refactorCtl = null;

function startTimer() {
  t0 = Date.now();
  el.progressTimer.textContent = '0.0s';
  clearInterval(timer);
  timer = setInterval(() => {
    el.progressTimer.textContent = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  }, 100);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

function buildSteps() {
  el.progressSteps.innerHTML = STEPS.map(
    (s) => `<li data-step="${s.id}">${esc(s.label)}</li>`
  ).join('');
}

function setStep(stepId, state) {
  const li = el.progressSteps.querySelector(`[data-step="${stepId}"]`);
  if (li) li.className = state;
}

function markThrough(lastStepId, state = 'done') {
  const idx = STEPS.findIndex((s) => s.id === lastStepId);
  STEPS.forEach((s, i) => {
    if (i <= idx) setStep(s.id, state);
  });
}

function showError(title, msg, hint = '') {
  el.errorTitle.textContent = title;
  el.errorMsg.textContent = msg;
  el.errorHint.textContent = hint;
  el.errorBox.hidden = false;
  stopTimer();
  el.progress.hidden = true;
}

function clearError() {
  el.errorBox.hidden = true;
}

async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(path, location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`服务返回了非 JSON 响应（HTTP ${res.status}）`);
  }

  if (!res.ok || payload.error) {
    const err = new Error(payload.message || `请求失败（HTTP ${res.status}）`);
    err.payload = payload;
    err.status = res.status;
    throw err;
  }
  return payload.data;
}

/* ── 健康检查：把模型状态显示在顶部 ─────────────── */

async function checkHealth() {
  try {
    const h = await api('/api/health');
    if (h.model.configured) {
      const models = [...new Set(Object.values(h.model.models))];
      el.modelDot.className = 'badge-dot on';
      el.modelInfo.textContent = `${h.model.mode}\n${models.length} 个模型 · ${h.model.provider}`;
    } else {
      el.modelDot.className = 'badge-dot off';
      el.modelInfo.textContent = '未配置 · 仅客观指标可用';
    }
  } catch {
    el.modelDot.className = 'badge-dot off';
    el.modelInfo.textContent = '服务不可达';
  }
}

/* ── 主流程 ─────────────────────────────────────── */

async function dig(repo, limit) {
  clearError();
  // 重考古：先销毁上一轮的重构面板（清理监听、取消在途请求、复位 URL）
  if (refactorCtl) {
    refactorCtl.destroy();
    refactorCtl = null;
  }
  el.report.hidden = true;
  el.report.innerHTML = '';
  el.progress.hidden = false;
  el.btn.disabled = true;
  buildSteps();
  el.progressTitle.textContent = `正在考古 ${repo}`;
  el.progressSub.textContent = '连接 GitHub API…';
  startTimer();

  let report = null;

  // ── 第一步：纯计算挖掘 ──────────────────────────
  try {
    setStep('meta', 'active');
    setStep('commits', 'active');
    setStep('diffs', 'active');
    el.progressSub.textContent = `拉取最近 ${limit} 次提交及其改动…`;

    report = await api('/api/mine', { query: { repo, limit } });

    markThrough('mine', 'done');
    setStep('narrator', 'active');

    const s = report.signalQuality;
    el.progressSub.textContent =
      `已解析 ${s.analyzed} 次提交 · 人类决策 ${s.signalCommits} 次 · 机器人 ${s.botCount ?? s.botCommits} 次`;
  } catch (e) {
    el.progressTitle.textContent = '挖掘失败';
    const hint =
      e.status === 404
        ? '确认仓库是公开的，且 owner/name 拼写正确'
        : e.status === 403
          ? 'GitHub 速率受限，稍后再试，或配置服务端 Token'
          : '可以换个仓库再试';
    showError('无法读取该仓库的历史', e.message, hint);
    el.btn.disabled = false;
    return;
  }

  // 客观指标立即渲染 —— 不等模型，观众先看到真数据
  renderReportShell(report);

  // 在报告末尾「分析区」旁挂载安全重构入口（与考古报告同生命周期）
  const zone = document.getElementById('refactorZone');
  if (zone) {
    refactorCtl = mountRefactor(zone, { repo, limit, path: undefined });
  }

  el.progressSub.textContent = '客观指标已就绪，交给多模型流水线…';

  // ── 第二步：多模型考古（可降级） ────────────────
  let analysis = null;
  try {
    // 注意：/api/excavate 返回的是外壳 { mined, report, analysis, degraded }，
    // 真正要渲染的是里面的 analysis。曾经直接把外壳当 analysis 用，
    // 导致 available 永远为 undefined，页面永远显示降级提示。
    const payload = await api('/api/excavate', { method: 'POST', body: { report } });
    analysis = payload?.analysis ?? {
      available: false,
      reason: payload?.degraded ? '模型层返回了降级结果' : '服务未返回分析结果',
      degradations: [],
    };
    markThrough('appraiser', 'done');
    el.progressTitle.textContent = '考古完成';
    el.progressSub.textContent = analysis.available
      ? `完成 · 动用 ${analysis.modelStatus.distinctModels} 个模型 · ` +
        `证据校验 ${analysis.evidenceAudit.overall.claims} 条推断`
      : '模型层不可用，已交付客观指标部分';
  } catch (e) {
    // 模型层失败不影响已渲染的客观指标 —— 这是刻意的降级设计
    el.progressTitle.textContent = '模型层失败，客观指标已交付';
    el.progressSub.textContent = e.message;
    analysis = { available: false, reason: e.message, degradations: [{ stage: 'request', error: e.message }] };
  } finally {
    stopTimer();
    setTimeout(() => {
      el.progress.hidden = true;
    }, 1600);
  }

  renderAnalysis(analysis);
  el.btn.disabled = false;

  const target = report ? el.report : el.errorBox;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReportShell(report) {
  el.report.hidden = false;
  el.report.innerHTML = [
    renderRepoHead(report),
    renderSignalQuality(report),
    renderTimeline(report),
    `<div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:26px;align-items:start">
      <div>${renderRiskFactors(report)}</div>
      <div>${renderHotspots(report)}</div>
     </div>`,
    renderExcavation(report),
    '<div id="analysisZone"></div>',
    '<div id="refactorZone"></div>',
  ].join('');
}

function renderAnalysis(analysis) {
  const zone = document.getElementById('analysisZone');
  if (zone) {
    zone.innerHTML = [
      renderNarrative(analysis, null),
      renderHypotheses(analysis),
      renderAppraisal(analysis),
      renderEvidenceAudit(analysis),
    ].join('');
  }
}

/* ── 事件绑定 ───────────────────────────────────── */

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const repo = el.repo.value.trim();
  if (!repo) return;
  dig(repo, el.limit.value);
});

document.querySelectorAll('.sample').forEach((b) => {
  b.addEventListener('click', () => {
    el.repo.value = b.dataset.repo;
    dig(b.dataset.repo, el.limit.value);
  });
});

checkHealth();
