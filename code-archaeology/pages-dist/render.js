// 渲染层 —— 纯函数：数据进，HTML 出。
// 不做任何网络请求，不持有状态，便于单独调试与替换。
// 所有拼接进 innerHTML 的文本都经过 escapeHtml，避免仓库名/提交信息里的
// 尖括号把页面结构冲掉。

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const d10 = (s) => (s ? String(s).slice(0, 10) : '');
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('zh-CN'));
const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

// 「存活 0 天」自相矛盾 —— 0 天意味着它从未活到能被放弃。
// 用真实时间戳算到分钟：52 分钟就写 52 分钟。
const spanLabel = (from, to) => {
  const ms = new Date(to) - new Date(from);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr} 小时`;
  return `${Math.round(hr / 24)} 天`;
};

/* ── 报告头 ─────────────────────────────────────── */

export function renderRepoHead(report) {
  const r = report.repo;
  const risk = report.risk;
  const age = r.createdAt ? Math.round((Date.now() - new Date(r.createdAt)) / 31536000000) : null;

  return `
  <section class="section">
    <div class="repo-head">
      <div class="repo-title-row">
        <div style="min-width:0">
          <p class="repo-name">${esc(r.full)}</p>
          <p class="repo-desc">${esc(r.description || '（该仓库没有填写简介）')}</p>
          <div class="repo-facts">
            <span>${esc(r.language || '未知语言')}</span>
            <span><b>${num(r.stars)}</b> stars</span>
            <span><b>${num(r.forks)}</b> forks</span>
            <span>建库 <b>${age ?? '—'}</b> 年</span>
            <span>主分支 <b>${esc(r.branch)}</b></span>
            ${r.license ? `<span>许可 <b>${esc(r.license)}</b></span>` : ''}
            ${r.archived ? '<span style="color:var(--danger)">已归档</span>' : ''}
          </div>
        </div>
        <div class="risk-gauge">
          <div class="risk-score">${risk.score}<small>/100</small></div>
          <span class="risk-label risk-${esc(risk.level)}">风险 ${esc(risk.level)}</span>
          <p style="margin:8px 0 0;font-size:11.5px;color:var(--ink-3);font-family:var(--mono)">
            仅基于客观指标
          </p>
        </div>
      </div>
      <div class="repo-facts" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">
        <span>分析窗口 <b>${d10(report.scope.windowFrom)}</b> → <b>${d10(report.scope.windowTo)}</b></span>
        <span>GitHub 调用 <b>${report.cost.apiCalls}</b> 次</span>
        <span>剩余配额 <b>${num(report.cost.rateRemaining)}</b></span>
        <span>${report.cost.token ? '已鉴权 <b>5000</b>/时' : '匿名 <b>60</b>/时'}</span>
      </div>
    </div>
  </section>`;
}

/* ── 信噪比 ─────────────────────────────────────── */

export function renderSignalQuality(report) {
  const s = report.signalQuality;
  const humanPct = s.signalRate;
  const noiseOnlyPct = pctOf(s.noiseOnlyCommits, s.analyzed);
  const botPct = 100 - humanPct - noiseOnlyPct;

  const seg = (cls, pct, label) =>
    pct <= 0
      ? ''
      : `<div class="snr-seg ${cls}" style="width:${pct}%">${pct >= 9 ? `${label} ${pct}%` : ''}</div>`;

  const botList = s.botAuthors.length
    ? s.botAuthors.map((b) => `${esc(b.author)} ×${b.commits}`).join('、')
    : '无';

  return `
  <section class="section">
    <div class="section-head">
      <h2>信噪比<span class="section-en">signal to noise</span></h2>
      <span class="section-note">报告的第一个数字</span>
    </div>
    <div class="section-body">
      <div class="snr-bar">
        ${seg('human', humanPct, '人类决策')}
        ${seg('noise', botPct, '机器人')}
        ${seg('noise', noiseOnlyPct, '纯生成物')}
      </div>
      <div class="snr-legend">
        <span><i class="dot dot-human"></i>包含人类决策痕迹 <b>${s.signalCommits}</b> 次</span>
        <span><i class="dot dot-noise"></i>机器人提交 <b>${s.botCommits}</b> 次</span>
        <span><i class="dot dot-noise"></i>仅改动生成物 <b>${s.noiseOnlyCommits}</b> 次</span>
      </div>
      <p class="big-stat">
        分析了 <b>${s.analyzed}</b> 次提交，其中 <b>${s.botCommits}</b> 次来自机器人（<b>${s.botRate}%</b>）。
        剥离自动化噪音后，真正承载人类决策的只有 <b>${s.signalCommits}</b> 次。
      </p>
      <p class="big-stat" style="font-size:13px;color:var(--ink-3)">
        机器人来源：${botList}
      </p>
    </div>
  </section>`;
}

/* ── 演化时间轴 ─────────────────────────────────── */

export function renderTimeline(report) {
  const tl = report.timeline;
  if (!tl.length) return '';

  const W = 1000;
  const padX = 6;
  const top = 26;
  const plotH = 132;
  const axisY = top + plotH;
  const H = axisY + 42;

  const maxChurn = Math.max(...tl.map((c) => c.churn), 1);
  const slot = (W - padX * 2) / tl.length;
  const barW = Math.max(2, Math.min(16, slot * 0.62));

  const bars = tl
    .map((c, i) => {
      const x = padX + i * slot + (slot - barW) / 2;
      // 用平方根压缩长尾：否则一次巨型提交会把其余全部压成看不见的细线
      const h = Math.max(2, Math.sqrt(c.churn / maxChurn) * plotH);
      const y = axisY - h;
      const cls = c.isRevert ? 'revert' : c.isBot ? 'bot' : c.isSignal ? 'human' : 'noise';
      const fill =
        cls === 'revert' ? '#b91c1c' : cls === 'human' ? '#0f766e' : cls === 'bot' ? '#a8a29e' : '#d5cfc8';
      const label = `${d10(c.date)} ${c.isBot ? '[机器人] ' : ''}${c.message}`;
      return `<g><title>${esc(label)}</title>
        <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}"
              rx="${Math.min(2, barW / 2).toFixed(2)}" fill="${fill}" opacity="0.92"/></g>`;
    })
    .join('');

  // 月份刻度：找每个月第一次出现的位置
  const marks = [];
  const seen = new Set();
  tl.forEach((c, i) => {
    const m = d10(c.date).slice(0, 7);
    if (!seen.has(m)) {
      seen.add(m);
      marks.push({ i, m });
    }
  });
  const tickEvery = Math.ceil(marks.length / 9);
  const ticks = marks
    .filter((_, idx) => idx % tickEvery === 0)
    .map(({ i, m }) => {
      const x = padX + i * slot + slot / 2;
      return `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${axisY}" stroke="#e7e3de" stroke-width="1"/>
        <text x="${x.toFixed(1)}" y="${axisY + 16}" text-anchor="middle" font-size="11"
              font-family="ui-monospace,monospace" fill="#9c9590">${esc(m)}</text>`;
    })
    .join('');

  const humanCount = tl.filter((c) => c.isSignal).length;
  const botCount = tl.filter((c) => c.isBot).length;

  return `
  <section class="section">
    <div class="section-head">
      <h2>提交演化时间轴<span class="section-en">commit timeline</span></h2>
      <span class="section-note">${tl.length} 条提交 · 柱高＝改动量（平方根压缩）</span>
    </div>
    <div class="section-body">
      <div class="timeline-wrap">
        <svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="img"
             aria-label="提交时间轴，绿色为人类决策，灰色为机器人提交，红色为回滚">
          <line x1="0" y1="${axisY}" x2="${W}" y2="${axisY}" stroke="#d5cfc8" stroke-width="1"/>
          ${ticks}
          ${bars}
        </svg>
      </div>
      <div class="tl-legend">
        <span><i class="dot dot-human"></i>人类决策 ${humanCount}</span>
        <span><i class="dot dot-noise"></i>机器人 & 生成物 ${botCount}</span>
        <span><i class="dot" style="background:#b91c1c"></i>回滚 ${tl.filter((c) => c.isRevert).length}</span>
        <span style="color:var(--ink-3)">悬停任意柱子看提交信息</span>
      </div>
    </div>
  </section>`;
}

/* ── 风险因子 ───────────────────────────────────── */

export function renderRiskFactors(report) {
  const factors = report.risk.factors
    .map(
      (f) => `
    <div class="factor">
      <div class="factor-top">
        <span class="factor-name">${esc(f.label)}</span>
        <span class="factor-score">${f.score} / ${f.weight}</span>
      </div>
      <div class="factor-track">
        <div class="factor-fill" style="width:${f.weight ? (f.score / f.weight) * 100 : 0}%"></div>
      </div>
      <p class="factor-raw">${esc(f.raw)} · ${esc(f.detail)}</p>
    </div>`
    )
    .join('');

  return `
  <section class="section">
    <div class="section-head">
      <h2>风险因子拆解<span class="section-en">risk factors</span></h2>
      <span class="section-note">每项都可独立验证</span>
    </div>
    <div class="section-body">${factors}</div>
  </section>`;
}

/* ── 文件热度 ───────────────────────────────────── */

export function renderHotspots(report) {
  const hs = report.hotspots;
  if (!hs.length) return '';
  const max = Math.max(...hs.map((h) => h.churn), 1);

  const rows = hs
    .slice(0, 9)
    .map(
      (h) => `
    <div class="hot-row">
      <div style="min-width:0">
        <div class="hot-file" title="${esc(h.file)}">${esc(h.file)}</div>
        <div class="hot-track"><div class="hot-fill" style="width:${(h.churn / max) * 100}%"></div></div>
      </div>
      <div class="hot-num">${num(h.churn)}·${h.touches}×</div>
    </div>`
    )
    .join('');

  const soloNote = report.soloOwned?.length
    ? `<p class="factor-raw" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
         其中 <b style="color:var(--accent)">${report.soloOwned.length}</b> 个文件在窗口内只有一个人改过 ——
         这些人一旦离开，该处即无人可问。改动量最大的单点归属：
         <span class="sha">${esc(report.soloOwned[0].file)}</span> → ${esc(report.soloOwned[0].owner)}
       </p>`
    : '';

  return `
  <section class="section">
    <div class="section-head">
      <h2>文件改动热度<span class="section-en">churn hotspots</span></h2>
      <span class="section-note">仅统计人类对源码的改动</span>
    </div>
    <div class="section-body">${rows}${soloNote}</div>
  </section>`;
}

/* ── 被放弃的尝试（客观层） ─────────────────────── */

export function renderExcavation(report) {
  const ab = report.abandoned ?? [];
  const th = report.thrash ?? [];

  // 把被否定的判定也亮出来。只展示「我发现了什么」、不展示「我否定了什么」的报告，
  // 读者无法复核 —— 而这两类原本都会被按行数判定的旧版本一起报成「被放弃」。
  const rej = report.abandonedRejected ?? [];
  const gr = report.globalReverts ?? [];
  const refutedNotes = [
    rej.length
      ? `另有 <b>${rej.length}</b> 处行数达标但未通过内容核实：拆除侧删掉的行与新增侧几乎不重合，判为「实现被重写」而非方案被放弃。`
      : '',
    gr.length
      ? `另有 <b>${gr.length}</b> 处属于整仓回滚的连带删除，原因与「放弃方案」不同，单独排除。`
      : '',
  ].filter(Boolean);

  const refuted = refutedNotes.length
    ? `<div class="quote-block" style="margin-top:18px">
         ${refutedNotes.map((l) => `<p style="margin:0 0 6px">${l}</p>`).join('')}
         <p style="margin:6px 0 0;color:var(--ink-3);font-size:11.5px">判定依据：拆除侧的删除行有多少曾出现在新增侧，重合率低于 50% 即判为改写（阈值取自实测分布）。</p>
       </div>`
    : '';

  const abCards = ab.length
    ? ab
        .slice(0, 6)
        .map(
          (a) => `
    <div class="item-card flag">
      <p class="item-title">
        <span class="item-file">${esc(a.file)}</span>
        <span class="chip chip-warn">存在 ${spanLabel(a.addDate, a.removeDate)}</span>
      </p>
      <div class="survival">
        <div class="survival-node">
          <b>+${num(a.addLines)} 行</b>
          <span>${d10(a.addDate)}</span>
        </div>
        <div class="survival-link"><i>${spanLabel(a.addDate, a.removeDate)}后被拆除</i></div>
        <div class="survival-node">
          <b>−${num(a.removeLines)} 行</b>
          <span>${d10(a.removeDate)}</span>
        </div>
      </div>
      <p class="item-body">加入：<span class="sha">${esc(a.addSha)}</span> ${esc(a.addMessage)}</p>
      <p class="item-body">拆除：<span class="sha">${esc(a.removeSha)}</span> ${esc(a.removeMessage)}</p>
      ${
        a.verified
          ? `<p class="item-body" style="color:var(--ink-3);font-size:11.5px">内容核实：拆除的 ${a.comparableLines} 行中有 ${a.overlappedLines} 行来自新增侧（重合 ${Math.round((a.overlapRate ?? 0) * 100)}%，阈值 50%）</p>`
          : `<p class="item-body" style="color:var(--ink-3);font-size:11.5px">未能核实：该文件 diff 过大，GitHub 未返回 patch，保留为待核实线索</p>`
      }
    </div>`
        )
        .join('')
    : '<div class="empty-note">该窗口内没有检出「先进后出」的改动模式</div>';

  const thCards = th.length
    ? th
        .slice(0, 6)
        .map(
          (t) => `
    <div class="item-card">
      <p class="item-title">
        <span class="item-file">${esc(t.file)}</span>
        <span class="chip chip-danger">打转 ${t.spinRatio}×</span>
      </p>
      <p class="item-body">
        被改了 <b>${t.touches}</b> 次，累计改动 <b>${num(t.churn)}</b> 行，
        但净变化只有 <b>${t.net > 0 ? '+' : ''}${num(t.net)}</b> 行 ——
        改了又改回，说明方案被反复推翻。
      </p>
      <div class="chips">
        ${t.authors.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}
      </div>
    </div>`
        )
        .join('')
    : '<div class="empty-note">没有检出「原地打转」的文件</div>';

  return `
  <section class="section">
    <div class="section-head">
      <h2>地层里的证据<span class="section-en">excavated evidence</span></h2>
      <span class="section-note">纯计算 · 不涉及模型推断</span>
    </div>
    <div class="section-body">
      <div class="grid-2">
        <div>
          <h3 style="margin:0 0 14px;font-size:13.5px;font-weight:500">
            被放弃的尝试
            <span style="color:var(--ink-3);font-weight:400">短时间加入又拆除 · 已通过内容核实</span>
          </h3>
          ${abCards}
        </div>
        <div>
          <h3 style="margin:0 0 14px;font-size:13.5px;font-weight:500">
            原地打转
            <span style="color:var(--ink-3);font-weight:400">改动量大但净变化小</span>
          </h3>
          ${thCards}
        </div>
      </div>
      ${refuted}
    </div>
  </section>`;
}

/* ── 叙事层 ─────────────────────────────────────── */

export function renderNarrative(analysis, report) {
  if (!analysis?.available) return degradationNotice(analysis, report);

  const n = analysis.narrative;
  const model = analysis.modelStatus?.models?.narrator ?? '';

  const paragraphs = String(n.narrative || '')
    .split(/\n{2,}|\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join('');

  const points = (n.turningPoints ?? []).length
    ? n.turningPoints.map((t) => turningCard(t)).join('')
    : '<div class="empty-note">模型没有识别出明显的转折点</div>';

  const meta = analysis.modelStatus;
  const modeNote = meta
    ? `本次动用 ${meta.distinctModels} 个不同模型 · ${esc(meta.mode)}`
    : '';

  return `
  <section class="section">
    <div class="section-head">
      <h2>决策史还原<span class="section-en">decision history</span>
        <span class="model-tag">${esc(model)}</span>
      </h2>
      <span class="section-note">${esc(modeNote)}</span>
    </div>
    <div class="section-body">
      ${n.headline ? `<p class="headline">${esc(n.headline)}</p>` : ''}
      <div class="narrative">${paragraphs}</div>
      <h3 style="margin:24px 0 14px;font-size:13.5px;font-weight:500">关键转折点</h3>
      ${points}
      ${
        n.currentState
          ? `<div class="quote-block" style="margin-top:20px">
               <p><b>为什么长成现在这样：</b>${esc(n.currentState)}</p>
             </div>`
          : ''
      }
    </div>
  </section>`;
}

function turningCard(t) {
  const status = t.evidenceAudit?.status ?? 'ungrounded';
  const label =
    status === 'grounded' ? '证据成立' : status === 'fabricated' ? '引用了不存在的提交' : '未引用证据';
  return `
  <div class="item-card${status === 'fabricated' ? ' flag' : ''}">
    <p class="item-title">
      <span>${esc(t.title)}</span>
      <span class="evidence-tag ${esc(status)}">${esc(label)}</span>
    </p>
    <p class="item-body"><b>${d10(t.date)}</b> · <span class="sha">${esc(t.sha)}</span></p>
    <p class="item-body"><b>改动：</b>${esc(t.what)}</p>
    <p class="item-body"><b>原因：</b>${esc(t.why)}</p>
    <div class="chips">
      ${(t.evidence ?? []).map((e) => `<span class="chip chip-human">${esc(e)}</span>`).join('')}
    </div>
  </div>`;
}

/* ── 假设层 ─────────────────────────────────────── */

export function renderHypotheses(analysis) {
  if (!analysis?.available) return '';
  const h = analysis.hypotheses;
  if (!h || h.skipped) return '';

  const cards = (h.hypotheses ?? []).length
    ? h.hypotheses
        .map((x) => {
          const conf = x.confidence === '高' ? 'ok' : x.confidence === '中' ? 'warn' : 'danger';
          const status = x.evidenceAudit?.status ?? 'ungrounded';
          return `
      <div class="item-card flag">
        <p class="item-title">
          <span class="item-file">${esc(x.file)}</span>
          <span>
            <span class="chip chip-${conf}">置信度 ${esc(x.confidence)}</span>
            <span class="evidence-tag ${esc(status)}">${
              status === 'grounded' ? '证据成立' : status === 'fabricated' ? '编造证据' : '无证据'
            }</span>
          </span>
        </p>
        <p class="item-body"><b>当年想做什么：</b>${esc(x.attempted)}</p>
        <p class="item-body"><b>为什么放弃：</b>${esc(x.whyAbandoned)}</p>
        ${x.usualPattern ? `<p class="item-body" style="color:var(--ink-3)"><b>这类模式的通常含义：</b>${esc(x.usualPattern)}</p>` : ''}
        <div class="chips">
          <span class="chip">${esc(x.addSha)}</span>
          <span class="chip">${esc(x.removeSha)}</span>
        </div>
      </div>`;
        })
        .join('')
    : '<div class="empty-note">没有可推断的案例</div>';

  return `
  <section class="section">
    <div class="section-head">
      <h2>被放弃方案的推断<span class="section-en">abandoned attempts</span>
        <span class="model-tag">${esc(analysis.modelStatus?.models?.hypothesizer ?? '')}</span>
      </h2>
      <span class="section-note">最可能出错的一层，故标注置信度</span>
    </div>
    <div class="section-body">
      ${h.overallPattern ? `<p class="headline">${esc(h.overallPattern)}</p>` : ''}
      ${cards}
    </div>
  </section>`;
}

/* ── 裁决层 ─────────────────────────────────────── */

export function renderAppraisal(analysis) {
  if (!analysis?.available) return '';
  const a = analysis.appraisal;
  if (!a) return '';

  const advice = (a.adviceForNewcomer ?? []).length
    ? `<ul class="todo-list">${a.adviceForNewcomer
        .map((x, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><span>${esc(x)}</span></li>`)
        .join('')}</ul>`
    : '<div class="empty-note">无</div>';

  const questions = (a.interviewQuestions ?? []).length
    ? `<ul class="todo-list">${a.interviewQuestions
        .map((x, i) => `<li><span class="num">Q${i + 1}</span><span>${esc(x)}</span></li>`)
        .join('')}</ul>`
    : '<div class="empty-note">无</div>';

  const doubts = (a.doubts ?? []).length
    ? (a.doubts ?? [])
        .map(
          (d) => `
      <div class="item-card">
        <p class="item-body"><b>被质疑：</b>${esc(d.claim)}</p>
        <p class="item-body"><b>问题：</b>${esc(d.concern)}</p>
      </div>`
        )
        .join('')
    : '<div class="empty-note">审稿人没有提出异议</div>';

  const drivers = (a.riskDrivers ?? []).length
    ? (a.riskDrivers ?? [])
        .map(
          (d) => `
      <div class="item-card">
        <p class="item-title"><span>${esc(d.title)}</span>
          <span class="evidence-tag ${esc(d.evidenceAudit?.status ?? 'ungrounded')}">${
            d.evidenceAudit?.status === 'grounded' ? '证据成立' : '证据不足'
          }</span>
        </p>
        <p class="item-body">${esc(d.detail)}</p>
        <div class="chips">${(d.evidence ?? []).map((e) => `<span class="chip chip-human">${esc(e)}</span>`).join('')}</div>
      </div>`
        )
        .join('')
    : '';

  return `
  <section class="section">
    <div class="section-head">
      <h2>审稿人裁决<span class="section-en">review &amp; verdict</span>
        <span class="model-tag">${esc(analysis.modelStatus?.models?.appraiser ?? '')}</span>
      </h2>
      <span class="section-note">职责是质疑前两层</span>
    </div>
    <div class="section-body">
      ${a.verdict ? `<div class="quote-block"><p>${esc(a.verdict)}</p></div>` : ''}
      ${drivers}
      <div class="grid-2" style="margin-top:20px">
        <div>
          <h3 style="margin:0 0 10px;font-size:13.5px;font-weight:500">给接手者的建议</h3>
          ${advice}
        </div>
        <div>
          <h3 style="margin:0 0 10px;font-size:13.5px;font-weight:500">
            该去问原作者的问题
            <span style="color:var(--ink-3);font-weight:400">考古无法回答的部分</span>
          </h3>
          ${questions}
        </div>
      </div>
      <h3 style="margin:24px 0 10px;font-size:13.5px;font-weight:500">
        审稿人对前两层的质疑
      </h3>
      ${doubts}
    </div>
  </section>`;
}

/* ── 证据接地报告 ───────────────────────────────── */

export function renderEvidenceAudit(analysis) {
  if (!analysis?.available) return '';
  const e = analysis.evidenceAudit;
  if (!e?.overall) return '';

  const claims = e.overall.claims;
  const fabricated = e.overall.fabricated;
  const invalid = e.overall.invalidCitations;
  const grounded = e.narrative.grounded + e.hypothesis.grounded;

  return `
  <section class="section">
    <div class="section-head">
      <h2>证据接地报告<span class="section-en">evidence grounding</span></h2>
      <span class="section-note">程序校验 · 不依赖模型自评</span>
    </div>
    <div class="section-body">
      <div class="audit-grid">
        <div class="audit-cell">
          <p class="k">推断条目</p>
          <p class="v">${claims}</p>
        </div>
        <div class="audit-cell good">
          <p class="k">证据成立</p>
          <p class="v">${grounded}</p>
        </div>
        <div class="audit-cell ${fabricated ? 'bad' : 'good'}">
          <p class="k">编造引用</p>
          <p class="v">${fabricated}</p>
        </div>
        <div class="audit-cell ${invalid ? 'bad' : 'good'}">
          <p class="k">无效提交号</p>
          <p class="v">${invalid}</p>
        </div>
      </div>
      <p class="big-stat">
        模型产出的每一条推断都被要求引用具体提交。程序拿这些提交号与真实拉取到的提交列表
        做集合比对：<b>${claims}</b> 条推断共引用 <b>${e.narrative.citations + e.hypothesis.citations}</b> 个提交号，
        其中 <b>${invalid}</b> 个在仓库里<b>不存在</b>。
        ${fabricated === 0 ? '本次未检出编造。' : `有 <b>${fabricated}</b> 条推断引用了不存在的提交。`}
      </p>
      <p class="big-stat" style="font-size:13px;color:var(--ink-3)">
        这一步的意义在于：幻觉判定不靠另一个模型的主观判断，而是一次可复现的集合运算。
      </p>
    </div>
  </section>`;
}

/* ── 降级提示 ───────────────────────────────────── */

export function degradationNotice(analysis, report) {
  const degradations = analysis?.degradations ?? [];
  const hasModel = analysis?.available;

  return `
  <section class="section">
    <div class="section-head">
      <h2>模型分析层<span class="section-en">analysis layer</span></h2>
      <span class="section-note">${hasModel ? '已降级' : '不可用'}</span>
    </div>
    <div class="section-body">
      <div class="empty-note" style="text-align:left">
        <p style="margin:0 0 10px">
          模型分析层当前不可用，但<b>上面的客观指标部分完全不受影响</b> ——
          它们全部由程序对真实提交数据计算得出，不依赖任何模型。
        </p>
        <p style="margin:0;font-family:var(--mono);font-size:12px;color:var(--ink-3)">
          ${esc((analysis?.reason ?? degradations.map((d) => `${d.stage}: ${d.error}`).join('；')) || '未配置模型')}
        </p>
        ${
          report
            ? `<p style="margin:10px 0 0;font-size:12.5px">
                 已完成的客观分析：${report.timeline.length} 条提交 · ${report.hotspots.length} 个热文件 ·
                 ${report.abandoned.length} 处被放弃的尝试
               </p>`
            : ''
        }
      </div>
    </div>
  </section>`;
}
