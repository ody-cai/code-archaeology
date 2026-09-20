// 生成 P10–P12：被放弃的尝试清单 / 多模型分析层与证据接地 / 工程完备性与自我证伪
import { writeFileSync } from 'node:fs';
import { FACTS, OC, TF, ST, TOOL, C, SERIF, SANS, PAGE, esc, bi, foot, head, slide, bars, factorRow } from './tokens.mjs';

const OUT = './slides';
const ASSETS = process.cwd() + '/assets';

const SRC_TF = `第三方仓库来源 / Third-party source：ody-cai/topfo（HTML · ${TF.repo.stars} stars）· GitHub REST API v3 · 采集窗口 ${TF.capture.windowFrom} → ${TF.capture.windowTo}（UTC）`;
const SRC_OC = `第三方仓库来源 / Third-party source：openclaw/openclaw（TypeScript · ${OC.repo.stars.toLocaleString('en-US')} stars）· GitHub REST API v3 · 采集窗口 ${OC.capture.windowFrom} → ${OC.capture.windowTo}（UTC）`;
const SRC_BOTH = `数据来源 / Sources：上述全部数字来自 openclaw/openclaw 与 ody-cai/topfo 两个公开仓库的 GitHub REST API v3 现场返回，经本地计算得出；未测试任何第三个仓库。`;
const hhmm = (m) => `${Math.floor(m / 60)} 小时 ${String(m % 60).padStart(2, '0')} 分`;

const pages = {};
const th = (s, w, al = 'left') =>
  `<Text style={{ width: ${w}, fontSize: 9.5, color: '#8892A0', textAlign: '${al}' }}>${s}</Text>`;
const td = (s, w, c = '#A8B2BE', sz = 9.5, al = 'left') =>
  `<Text style={{ width: ${w}, fontSize: ${sz}, color: '${c}', textAlign: '${al}' }}>${s}</Text>`;

/* ══════════════════ P10 · 被放弃的尝试 逐条清单 ══════════════════ */
const rows = TF.abandoned.verified
  .map(
    (x, i) => `
          <Box style={{ flexDirection: 'row', alignItems: 'center', height: 41, borderBottom: '1px solid #232C38' }}>
            ${td(String(i + 1), 16, '#6B7684')}
            ${td(x.file, 262, '#EDF1F5')}
            ${td('+' + x.addLines + '  ' + x.addSha, 92, '#4CB8A6')}
            ${td('−' + x.removeLines + '  ' + x.removeSha, 92, '#E3A33E')}
            ${td(hhmm(x.survivedMinutes), 74, '#EDF1F5')}
            ${td(x.overlapPct + '%', 48, '#4CB8A6', 9.5, 'right')}
            ${td('已核实 ✓', 76, '#4CB8A6', 9.5, 'right')}
          </Box>`
  )
  .join('');
const rej = OC.abandoned.rejected[0];

pages['10_abandoned'] = slide(`
${head('「被放弃的尝试」逐条清单', 'Abandoned attempts, item by item')}
    <Box style={{ height: 500 }}>
      <Box style={{ flexDirection: 'row', gap: 16 }}>
        <Box style={{ flex: 1, padding: '12px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>ody-cai/topfo · ${TF.abandoned.verifiedCount} 处已核实 / verified</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>判定规则：拆除侧删除的行中，有 ≥ 50% 曾在新增侧出现过，才计为「被放弃」；否则判为重写。</Text>

          <Box style={{ flexDirection: 'row', height: 24, marginTop: 10, borderBottom: '1px solid #2C3542', alignItems: 'center' }}>
            ${th('#', 16)}${th('文件 / File', 262)}${th('加入 / Added', 92)}${th('拆除 / Removed', 92)}${th('存活 / Lived', 74)}${th('重合 / Overlap', 48, 'right')}${th('判定 / Verdict', 76, 'right')}
          </Box>
${rows}

          <Box style={{ marginTop: 10, padding: '9px 12px', background: 'rgba(227,163,62,0.10)', border: '1px solid rgba(227,163,62,0.35)', borderRadius: 8 }}>
            <Text style={{ fontSize: 10.5, lineHeight: 1.5, color: '#E3A33E', fontWeight: 'bold' }}>
              同一次运行里，openclaw/openclaw 有 1 处候选被程序否定 —— 这是「不编结论」的证据，而不是把假阳性藏起来。
            </Text>
            <Text style={{ fontSize: 10, lineHeight: 1.5, color: '#A8B2BE', marginTop: 4 }}>
              ${rej.file}<br />
              ${rej.addSha} 加入 +${rej.addLines} 行 → ${rej.removeSha} 拆除 −${rej.removeLines} 行；可比 ${rej.comparableLines} 行中重合 ${rej.overlapPct}%，低于阈值 50% → 判定「重写而非放弃」，不计入风险分。
            </Text>
          </Box>
        </Box>

        <Box style={{ width: 424 }}>
          <Box style={{ padding: 8, background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
            <Image src="${ASSETS}/topfo-evidence.png" style={{ width: 408, height: 363 }} />
          </Box>
          <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: '#6B7684', marginTop: 8 }}>
            上图为产品界面中「地层里的证据」区块的真实截图：每一处都写明加入 / 拆除的 commit SHA、行数、存活时长与内容重合率，可逐条回 GitHub 核对。
            <br />Live product screenshot: every entry carries its SHAs, line counts, lifespan and content overlap — verifiable one by one on GitHub.
          </Text>
        </Box>
      </Box>
    </Box>
${foot(10, SRC_TF)}`);

/* ══════════════════ P11 · 多模型分析层与证据接地 ══════════════════ */
const modelCard = (role, model, zh, en, body, enBody, accent) => `
        <Box style={{ flex: 1, padding: '13px 15px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38', flexDirection: 'column' }}>
          <Text style={{ fontSize: 9.5, fontWeight: 'bold', color: '${accent}', letterSpacing: 1.2 }}>${role}</Text>
          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#EDF1F5', marginTop: 5 }}>${model}</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>${en}</Text>
          <Box style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #2C3542' }}>
            <Text style={{ fontSize: 11.5, lineHeight: 1.6, color: '#A8B2BE' }}>${body}</Text>
            <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: '#6B7684', marginTop: 5 }}>${enBody}</Text>
          </Box>
        </Box>`;
const groundItem = (v, l, en, c) => `
          <Box style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: 'bold', color: '${c}', fontFamily: "${SERIF}" }}>${v}</Text>
            <Text style={{ fontSize: 10.5, color: '#EDF1F5', marginTop: 3 }}>${l}</Text>
            <Text style={{ fontSize: 9.5, color: '#8892A0', marginTop: 1 }}>${en}</Text>
          </Box>`;
const tfClaims = TF.analysis.evidenceAudit.overall.claims;
const ocClaims = OC.analysis.evidenceAudit.overall.claims;
const tfCites = TF.analysis.evidenceAudit.narrative.citations + TF.analysis.evidenceAudit.hypothesis.citations;
const ocCites = OC.analysis.evidenceAudit.narrative.citations + OC.analysis.evidenceAudit.hypothesis.citations;
const d0 = TF.analysis.doubts[0];

pages['11_models'] = slide(`
${head('多模型分工，与不依赖模型的证据接地校验', 'Three models in sequence — and grounding checked without any model')}
    <Box style={{ height: 500 }}>
      <Box style={{ flexDirection: 'row', gap: 16, height: 286 }}>
${modelCard(
  '叙事者 / NARRATOR',
  OC.analysis.models.narrator,
  '把提交序列还原成决策史',
  'Renders the commit stream into a decision history',
  `它把两仓库的提交序列各自还原成一条决策史，并为每个转折点标注对应的 commit SHA：openclaw 与 topfo 各识别 ${OC.analysis.turningPoints.length} 个转折点，全部通过下方证据接地校验。其输出的标题与叙述见第 08、09 页的实测数字旁。`,
  `It renders each commit stream into a decision history; every turning point it names must cite a real commit SHA.`,
  C.teal
)}
${modelCard(
  '假设者 / HYPOTHESIZER',
  OC.analysis.models.hypothesizer,
  '推断「先进后出」当年想做什么',
  'Infers what an abandoned change was trying to do',
  `topfo 输出 ${TF.analysis.hypothesisCount} 条推断，逐条标置信度与依据，全部接地；并归纳出「${TF.analysis.overallPattern.split('：')[0]}」这一模式。openclaw 在窗口内没有检出候选，于是<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>直接跳过</span>（skipReason: ${OC.analysis.skipReason ?? 'no_abandoned_attempts'}）—— 宁可不给结论，也不编一个。`,
  'On openclaw the layer skipped itself rather than produce an invented narrative.',
  C.amber
)}
${modelCard(
  '审稿人 / APPRAISER',
  OC.analysis.models.appraiser,
  '复核前两者，并给出裁决与待问清单',
  'Reviews both, issues a verdict and a question list',
  `openclaw 裁决：「${OC.analysis.verdict}」；topfo 裁决：「${TF.analysis.verdict}」。它并不一味附和 —— 本次对假设者提出 ${TF.analysis.doubts.length} 条质疑，指出其「仅凭同一个提交里伴随的语法修复就推断国际化方案未定」属于过度推断。`,
  'The appraiser openly challenged the hypothesizer\'s over-inference — the critique is part of the output.',
  C.teal
)}
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 92, marginTop: 12, padding: '12px 18px', background: '#1D242E', borderRadius: 10, border: '1px solid rgba(76,184,166,0.40)' }}>
        ${groundItem(String(tfClaims + ocClaims), '条推断 · 两仓库合计', 'claims, both repos', '#EDF1F5')}
        ${groundItem(String(tfCites + ocCites), '个 commit SHA 引用', 'commit SHA citations', '#EDF1F5')}
        ${groundItem(String(TF.analysis.evidenceAudit.overall.fabricated + OC.analysis.evidenceAudit.overall.fabricated), '条编造证据', 'fabricated citations', '#4CB8A6')}
        ${groundItem(String(TF.analysis.evidenceAudit.overall.invalidCitations + OC.analysis.evidenceAudit.overall.invalidCitations), '条无效引用', 'invalid citations', '#4CB8A6')}
        ${groundItem('100%', '证据接地率', 'grounding rate', '#4CB8A6')}
      </Box>

      <Box style={{ height: 98, marginTop: 12, padding: '10px 18px', background: 'rgba(227,163,62,0.10)', border: '1px solid rgba(227,163,62,0.35)', borderRadius: 10 }}>
        <Text style={{ fontSize: 11, color: '#E3A33E', fontWeight: 'bold' }}>为什么「编造」可以一次集合运算判定 / Why fabrication is provable, not judged</Text>
        <Text style={{ fontSize: 11.5, lineHeight: 1.5, color: '#EDF1F5', marginTop: 6 }}>
          模型产出的每条结论必须引用一个 commit SHA，而这份 SHA 清单是程序从 GitHub 真实拉回来的。因此「引用了一个不存在的提交」不需要另一个模型来评判 —— 程序对两个集合做一次差集即可判定。这一步 100% 由代码完成，不经过任何模型。
        </Text>
        <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: '#8892A0', marginTop: 5 }}>
          Every claim must cite a SHA drawn from the API response; a citation outside that set is provable fabrication, decided by set difference — no model involved.
        </Text>
      </Box>
    </Box>
${foot(11, [SRC_OC, SRC_TF])}`);

/* ══════════════════ P12 · 工程完备性 / 自我证伪 / 边界与问答 ══════════════════ */
const colCard = (zh, en, body, enBody, accent) => `
        <Box style={{ flex: 1, padding: '14px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 13, fontWeight: 'bold', color: '${accent}' }}>${zh}</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 4 }}>${en}</Text>
          <Text style={{ fontSize: 11.5, lineHeight: 1.62, color: '#A8B2BE', marginTop: 9 }}>${body}</Text>
          <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: '#6B7684', marginTop: 6 }}>${enBody}</Text>
        </Box>`;
const qa = (q, en, a, aEn) => `
        <Box style={{ flex: 1, padding: '10px 14px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 11, color: '#E3A33E', fontWeight: 'bold' }}>${q}</Text>
          <Text style={{ fontSize: 9, color: '#6B7684', marginTop: 2 }}>${en}</Text>
          <Text style={{ fontSize: 10.5, lineHeight: 1.5, color: '#A8B2BE', marginTop: 6 }}>${a}</Text>
          <Text style={{ fontSize: 9, lineHeight: 1.45, color: '#6B7684', marginTop: 4 }}>${aEn}</Text>
        </Box>`;

pages['12_engineering'] = slide(`
${head('工程完备性、一次自我证伪，与已知边界', 'Engineering completeness, one self-falsification, and known boundaries')}
    <Box style={{ height: 500 }}>
      <Box style={{ flexDirection: 'row', gap: 16, height: 296 }}>
${colCard(
  '工程完备性 / Engineering',
  'Everything below was measured on this machine',
  `· 单元测试 <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${ST.tests.pass} / ${ST.tests.total}</span> 通过、${ST.tests.fail} 失败<br />· 自有代码 <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${ST.code.totalLines.toLocaleString('en-US')}</span> 行 / ${ST.code.totalFiles} 个文件（src ${ST.code.srcLines} · public ${ST.code.publicLines} · tests ${ST.code.testsLines} · bin ${ST.code.binLines} · scripts ${ST.code.scriptsLines}）<br />· <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${ST.apiEndpoints}</span> 个 API 端点，其中 4 个可脱离完整流程单独复用<br />· 零构建原生前端 + Cloudflare Workers 原生 fetch，无框架依赖<br />· 同一套路由层既跑云端也跑本地 Node —— 云端不可用时演示行为一致`,
  `Tests ${ST.tests.pass}/${ST.tests.total} passing; ${ST.code.totalLines.toLocaleString('en-US')} lines of own code across ${ST.code.totalFiles} files; ${ST.apiEndpoints} endpoints; zero framework dependencies.`,
  C.teal
)}
${colCard(
  '一次自我证伪 / Self-falsification',
  'The check that rejected its own candidate',
  `「被放弃的尝试」不看净删行数，而看<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>内容重合率</span>：拆除侧删除的行里，必须有 ≥ 50% 曾在新增侧出现过。阈值与判定过程都写在输出里，可被复核。<br />本次两个仓库共产生 <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${TF.abandoned.verifiedCount + OC.abandoned.rejectedCount}</span> 次候选判定：${TF.abandoned.verifiedCount} 次通过（重合 ${TF.abandoned.overlapRange.min}%–${TF.abandoned.overlapRange.max}%），<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${OC.abandoned.rejectedCount} 次被程序否定</span>（重合 0%，判为重写）。被否定的那一条既不进风险分，也不从报告里消失 —— 它留在 abandonedRejected 字段中，界面上一并展示。`,
  'The 50% content-overlap rule is printed in the output. 7 candidates passed, 1 was rejected by the program itself and is still shown.',
  C.amber
)}
${colCard(
  '已知边界与下一步 / Boundaries & next',
  'Stated here rather than left for the Q&A',
  `· 当前依赖 GitHub REST API，因此读不到私有仓库的完整历史，单次窗口上限 100 次提交<br />· 刻意不读 PR 与 issue —— 24 小时内的取舍是优先保住「不幻觉」，而不是扩大证据面<br />· 报告的定位是「信息丢失审计」，不是「重建决策史」：它指认哪里已经没人能说清为什么，判断权交回给人<br />· 下一步：改用本地 git log，零 API 成本、完整历史、且不接触对方任何凭据`,
  'Public repos and a 100-commit window today; local git log is the next step because it costs no API quota and touches no credentials.',
  C.teal
)}
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 192, marginTop: 12 }}>
${qa(
  'Q1 · 你怎么知道你猜的对？',
  'How do you know your inference is right?',
  `我们不猜。系统只承诺可验证的量：信噪比、无痕迹的被放弃改动、知识集中度、沉寂断层。推断层必须标注置信度与依据，证据含糊时强制写明「提交信息未说明原因，以下为基于改动范围的推断」，且每条结论都过 SHA 集合校验。`,
  'We do not guess. Only verifiable quantities are promised; every inference must state its confidence and survive the SHA set check.'
)}
${qa(
  'Q2 · 和 CodeScene / git-of-theseus 有什么区别？',
  'How is this different from existing code-analytics tools?',
  `它们做行为码分析：热点、巴士因子、知识地图。本项目的差异化只有一条 —— 「被放弃的尝试」：代码中不存在、只能从历史里挖出的信息。这条护城河很窄，所以我们把它做扎实：内容级核实 + 唯一性自我证伪。`,
  'Existing tools analyse behaviour in the current code. Our one differentiator is abandoned attempts — information that exists only in history.'
)}
${qa(
  'Q3 · 是不是套用了现成项目？',
  'Is this a repackaged open-source project?',
  `零依赖框架：前端是零构建原生 JS，后端是 Cloudflare Workers 原生 fetch，核心模块（重合率核实、信噪分离、提交信息解析、证据接地校验）全部自研 —— ${ST.code.totalLines.toLocaleString('en-US')} 行自有代码、${ST.tests.total} 个自写测试。`,
  'No framework dependency: zero-build vanilla front-end, native Workers fetch, and every core module written here.'
)}
      </Box>
    </Box>
${foot(12, [`${SRC_BOTH}`, `联系方式 / Contact：蔡奇均 Cai Qijun · cqjody@126.com · 线上 ${TOOL.liveUrl}`])}`);

for (const [name, dsl] of Object.entries(pages)) {
  writeFileSync(`${OUT}/${name}.slide`, dsl + '\n', 'utf8');
  console.log('wrote', name, dsl.length);
}
