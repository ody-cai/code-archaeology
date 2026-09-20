// 把 final/ 下四份真实产物抽成单一事实源 FACTS.json。
// PPT 里出现的每一个数字都必须来自这里，禁止手写。
// 用法：node extract-facts.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const D = './final/';
const read = (f) => JSON.parse(readFileSync(D + f, 'utf8'));

const mine = { openclaw: read('openclaw-mine.json'), topfo: read('topfo-mine.json') };
const exc = { openclaw: read('openclaw-excavate.json'), topfo: read('topfo-excavate.json') };

// 工程自检数据由 collect-selftest.sh 实测产出，不手写
const selfTest = JSON.parse(readFileSync('./final/selftest.json', 'utf8'));

// 墙钟耗时（/usr/bin/time -p real），与上面命令一一对应
const WALL = {
  openclawMineSec: 6.95,
  topfoMineSec: 4.30,
  openclawExcavateSec: 13.19,
  topfoExcavateSec: 38.35,
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => {
  const t = new Date(d);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}Z`;
};
const dur = (a, b) => {
  const ms = new Date(b) - new Date(a);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { ms, h, m, s, text: `${h}h ${pad(m)}m ${pad(s)}s` };
};

function build(key) {
  const m = mine[key];
  const e = exc[key];
  const r = e.report;                       // excavate 自带的 mine 结果
  const a = e.analysis;
  const top = m.authors[0];
  const span = dur(m.scope.windowFrom, m.scope.windowTo);
  const gap = m.rhythm.longestGap;
  const rc = m.abandoned.map((x) => Math.round(x.overlapRate * 100));
  return {
    repo: {
      full: m.repo.full,
      language: m.repo.language,
      stars: m.repo.stars,
      description: m.repo.description ?? null,
    },
    // ── 采集口径 ──
    capture: {
      limit: m.scope.limit,
      windowFromRaw: m.scope.windowFrom,
      windowToRaw: m.scope.windowTo,
      windowFrom: iso(m.scope.windowFrom),
      windowTo: iso(m.scope.windowTo),
      windowSpanText: span.text,
      windowSpanMinutes: Math.round(span.ms / 60000),
      apiCalls: m.cost.apiCalls,
      tokenUsed: m.cost.token,
      rateRemaining: m.cost.rateRemaining,
      fetchedAt: m.cost.fetchedAt,
      excavateApiCalls: r.cost.apiCalls,
      excavateFetchedAt: r.cost.fetchedAt,
    },
    wallClock: {
      mineSec: WALL[key + 'MineSec'],
      excavateSec: WALL[key + 'ExcavateSec'],
    },
    // ── 信噪分离 ──
    signal: {
      analyzed: m.signalQuality.analyzed,
      botCommits: m.signalQuality.botCommits,
      botRate: m.signalQuality.botRate,
      signalCommits: m.signalQuality.signalCommits,
      signalRate: m.signalQuality.signalRate,
      botAuthors: m.signalQuality.botAuthors,
      commitsPerHour:
        span.ms > 0 ? Number((m.signalQuality.analyzed / (span.ms / 3600000)).toFixed(1)) : null,
      minutesPerCommit: span.ms > 0 ? Number((span.ms / 60000 / m.signalQuality.analyzed).toFixed(1)) : null,
    },
    // ── 提交信息卫生 ──
    hygiene: {
      total: m.hygiene.total,
      vagueCount: m.hygiene.vagueCount,
      vagueRate: m.hygiene.vagueRate,
      revertCount: m.hygiene.revertCount,
      avgMsgLen: m.hygiene.avgMsgLen,
    },
    // ── 知识集中度 ──
    concentration: {
      topAuthor: top.author,
      topAuthorCommits: top.commits,
      topAuthorChurn: top.churn,
      topAuthorFiles: top.fileCount,
      topAuthorSharePct: Number(((top.commits / m.hygiene.total) * 100).toFixed(0)),
      authorCount: m.authors.length,
      authors: m.authors.map((x) => ({ author: x.author, commits: x.commits, churn: x.churn, files: x.fileCount })),
    },
    // ── 节奏 ──
    rhythm: {
      weeks: m.rhythm.weeks,
      activeDays: m.rhythm.activeDays,
      spanDays: m.rhythm.spanDays,
      avgDaysPerCommit: Number((m.rhythm.spanDays / m.hygiene.total).toFixed(1)),
      longestGapDays: gap.days,
      longestGapFrom: gap.from ? iso(gap.from) : null,
      longestGapTo: gap.to ? iso(gap.to) : null,
      afterGapSha: m.rhythm.afterGapCommit ? m.rhythm.afterGapCommit.sha : null,
      afterGapDate: m.rhythm.afterGapCommit ? iso(m.rhythm.afterGapCommit.date) : null,
    },
    // ── 风险分 ──
    risk: {
      score: m.risk.score,
      level: m.risk.level,
      factors: m.risk.factors.map((f) => ({ key: f.key, label: f.label, raw: f.raw, score: f.score, weight: f.weight })),
    },
    // ── 热点 ──
    hotspots: m.hotspots.slice(0, 8).map((h) => ({
      file: h.file,
      churn: h.churn,
      touches: h.touches,
      net: h.net,
      authors: h.authors,
      lastSha: h.sequence?.[h.sequence.length - 1]?.sha ?? null,
    })),
    // ── 被放弃的尝试 ──
    abandoned: {
      verifiedCount: m.abandoned.length,
      rejectedCount: (m.abandonedRejected || []).length,
      globalRevertCount: (m.globalReverts || []).length,
      verified: m.abandoned.map((x) => {
        const mins = Math.round((new Date(x.removeDate) - new Date(x.addDate)) / 60000);
        return {
          file: x.file,
          addSha: x.addSha,
          addDate: iso(x.addDate),
          addLines: x.addLines,
          addMessage: x.addMessage,
          removeSha: x.removeSha,
          removeDate: iso(x.removeDate),
          removeLines: x.removeLines,
          removeMessage: x.removeMessage,
          survivedMinutes: mins,
          survivedText: mins < 60 ? `${mins} 分钟` : `${Math.floor(mins / 60)} 小时 ${mins % 60} 分`,
          overlapPct: Math.round(x.overlapRate * 100),
          overlappedLines: x.overlappedLines,
          comparableLines: x.comparableLines,
          verifyNote: x.verifyNote,
        };
      }),
      overlapRange: rc.length ? { min: Math.min(...rc), max: Math.max(...rc) } : null,
      rejected: (m.abandonedRejected || []).map((x) => ({
        file: x.file,
        addSha: x.addSha,
        removeSha: x.removeSha,
        addLines: x.addLines,
        removeLines: x.removeLines,
        overlapPct: Math.round((x.overlapRate ?? 0) * 100),
        comparableLines: x.comparableLines,
        verifyNote: x.verifyNote,
      })),
    },
    // ── 原地打转 ──
    thrash: {
      count: (m.thrash || []).length,
      top: (m.thrash || []).slice(0, 4).map((t) => ({ file: t.file, touches: t.touches, churn: t.churn, spinRatio: t.spinRatio })),
    },
    // ── 独狼文件 ──
    soloOwned: { count: m.soloOwned.length, top: m.soloOwned.slice(0, 3) },
    // ── 多模型分析层 ──
    analysis: {
      available: a.available,
      mode: a.modelStatus.mode,
      distinctModels: a.modelStatus.distinctModels,
      models: a.modelStatus.models,
      narrativeHeadline: a.narrative?.headline ?? null,
      narrativeText: a.narrative?.narrative ?? null,
      turningPoints: (a.narrative?.turningPoints ?? []).map((t) => ({
        sha: t.sha,
        date: t.date,
        title: t.title,
        what: t.what,
        why: t.why,
        status: t.evidenceAudit?.status,
      })),
      hypothesesSkipped: a.hypotheses?.skipped ?? null,
      skipReason: a.hypotheses?.skipReason ?? null,
      hypothesisCount: (a.hypotheses?.hypotheses ?? []).length,
      overallPattern: a.hypotheses?.overallPattern ?? null,
      verdict: a.appraisal?.verdict ?? null,
      riskLevel: a.appraisal?.riskLevel ?? null,
      advice: a.appraisal?.adviceForNewcomer ?? [],
      doubts: a.appraisal?.doubts ?? [],
      interviewQuestions: a.appraisal?.interviewQuestions ?? [],
      evidenceAudit: a.evidenceAudit,
      degradations: a.degradations ?? [],
    },
  };
}

const FACTS = {
  generatedAt: new Date().toISOString(),
  tool: {
    name: '代码考古学 / Code Archaeology',
    version: '0.1.0',
    liveUrl: 'https://code-archaeology.odycai.workers.dev',
    latestWorkerVersion: 'ad70fdf1-12d3-4b63-af33-e00d78f04a78',
    latestDeployAt: '2026-09-19T08:00:15Z',
    selfTest,
  },
  scopeStatement: {
    zh: '本次实测的测试范围严格限定为两个公开仓库：openclaw/openclaw 与 ody-cai/topfo。未对任何第三个仓库运行测试。',
    en: 'Test scope is strictly limited to two public repositories: openclaw/openclaw and ody-cai/topfo. No third repository was tested.',
  },
  openclaw: build('openclaw'),
  topfo: build('topfo'),
};

writeFileSync('./FACTS.json', JSON.stringify(FACTS, null, 2));
console.log('已写出 FACTS.json');
