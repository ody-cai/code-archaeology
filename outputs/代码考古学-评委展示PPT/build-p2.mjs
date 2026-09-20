// 生成 P06–P12：PART 1 收尾 + PART 2 真实运行数据
import { writeFileSync } from 'node:fs';
import { FACTS, OC, TF, ST, TOOL, C, SERIF, SANS, PAGE, esc, bi, foot, head, slide, bars, factorRow } from './tokens.mjs';

const OUT = './slides';
const ASSETS = process.cwd() + '/assets';

const SRC_OC = `第三方仓库来源 / Third-party source：openclaw/openclaw（TypeScript · ${OC.repo.stars.toLocaleString('en-US')} stars）· GitHub REST API v3 · 采集窗口 ${OC.capture.windowFrom} → ${OC.capture.windowTo}（UTC）`;
const SRC_TF = `第三方仓库来源 / Third-party source：ody-cai/topfo（HTML · ${TF.repo.stars} stars）· GitHub REST API v3 · 采集窗口 ${TF.capture.windowFrom} → ${TF.capture.windowTo}（UTC）`;
const SRC_OPENCLAW_TEST = `测试范围声明 / Scope：本次全部实测严格限定为 openclaw/openclaw 与 ody-cai/topfo 两个公开仓库，未对任何第三个仓库运行测试。`;

const hhmm = (m) => `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
const pages = {};

/* ══════════════════ P06 · 价值、场景与边界 ══════════════════ */
const sceneCard = (no, zh, en, body, enBody, foot_) => `
        <Box style={{ flex: 1, padding: '14px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38', flexDirection: 'column' }}>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#4CB8A6', letterSpacing: 1.2 }}>${no}</Text>
          <Text style={{ fontSize: 15.5, fontWeight: 'bold', color: '#EDF1F5', marginTop: 6 }}>${zh}</Text>
          <Text style={{ fontSize: 10.5, color: '#8892A0', marginTop: 3 }}>${en}</Text>
          <Text style={{ fontSize: 12.5, lineHeight: 1.55, color: '#A8B2BE', marginTop: 9 }}>${body}</Text>
          <Text style={{ fontSize: 10, lineHeight: 1.4, color: '#6B7684', marginTop: 4 }}>${enBody}</Text>
          <Box style={{ marginTop: 'auto', paddingTop: 9, borderTop: '1px solid #2C3542' }}>
            <Text style={{ fontSize: 10.5, lineHeight: 1.4, color: '#4CB8A6' }}>${foot_}</Text>
          </Box>
        </Box>`;

pages['06_value'] = slide(`
${head('价值：三个真实场景，一台可追踪的仪表', 'Value: three real scenarios — and an instrument, not a one-off report')}
    <Box style={{ height: 500 }}>
      <Box style={{ flexDirection: 'row', gap: 16, height: 302 }}>
${sceneCard('场景 01 · 技术尽调', '并购与投资前的代码尽调', 'Technical due diligence', `公开仓库可直接输入 owner/name，几秒内拿到风险分、五类风险因子拆解、文件热度与被放弃的尝试清单。不需要读完代码，就能定位「哪里已经没人能解释为什么」，并把问题交回给人。`, 'Paste a public owner/name and get a risk score, risk factor breakdown and the list of abandoned attempts in seconds.', '对应评分点：风险可量化、结论可复核 / Quantified, reviewable risk finding')}
${sceneCard('场景 02 · 团队交接', '新人接手前的交接清单', 'Handover checklist', `输出不只是分数，还包括「给接手者的建议」和「该去问原作者的问题清单」。这两项由审稿模型基于客观指标生成，问题直接指向证据不足处，而不是泛泛的注意事项。`, 'Beyond a score, it emits advice for newcomers and a list of questions to ask the original author, each tied to the evidence.', `实测 openclaw 产出 ${OC.analysis.interviewQuestions.length} 条待问原作者的问题 / ${OC.analysis.interviewQuestions.length} questions emitted`)}
${sceneCard('场景 03 · 架构复盘', '把走过的路摊开看', 'Architecture retro', `把「被放弃的尝试」与「原地打转」两类证据并排摊开：哪些功能加了又删、哪些文件反复推翻但净变化为零。这类信息只存在于历史里，代码终态永远看不到。`, 'Abandoned attempts and thrashing files side by side — information that exists only in history, never in the final code.', `实测 topfo：${TF.abandoned.verifiedCount} 处被放弃 · ${TF.thrash.count} 个文件原地打转 / ${TF.thrash.count} thrashing files`)}
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 186, marginTop: 12 }}>
        <Box style={{ flex: 1, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, color: '#E3A33E', fontWeight: 'bold' }}>从一次性报告，变成流水线里的一道闸门 / From report to gate</Text>
          <Text style={{ fontSize: 11.5, lineHeight: 1.55, color: '#A8B2BE', marginTop: 8 }}>
            命令行形态支持 --fail-on-risk 指定阈值：风险分高于阈值时以<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>退出码 2</span> 结束，可直接用于阻断合并请求。三个月后再跑一次同一个仓库，就能看出知识可追溯率有没有变好。
          </Text>
          <Text style={{ fontSize: 10, lineHeight: 1.45, color: '#6B7684', marginTop: 6 }}>
            Exit code 2 above a configurable threshold makes it a merge gate. Re-run the same repo months later and watch knowledge traceability move.
          </Text>
        </Box>
        <Box style={{ flex: 1, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid rgba(227,163,62,0.35)' }}>
          <Text style={{ fontSize: 12, color: '#E3A33E', fontWeight: 'bold' }}>已知边界（主动写在 PPT 里）/ Known boundaries</Text>
          <Text style={{ fontSize: 11.5, lineHeight: 1.55, color: '#A8B2BE', marginTop: 8 }}>
            · 当前依赖 GitHub REST API，因此读不到私有仓库的完整历史，单次窗口上限 100 次提交。<br />
            · 刻意不读 PR 与 issue —— 这是 24 小时内的取舍：优先保住「不幻觉」，而不是扩大证据面。<br />
            · 下一步：改用本地 git log，零 API 成本、完整历史、且不接触对方任何凭据。
          </Text>
          <Text style={{ fontSize: 10, lineHeight: 1.45, color: '#6B7684', marginTop: 6 }}>
            Public repos only, 100-commit window. PR/issue reading was deliberately deferred to protect accuracy. Next step: local git log.
          </Text>
        </Box>
      </Box>
    </Box>
${foot(6, '本页场景为产品设计说明；其中引用的数字（问题清单条数、被放弃处数、打转文件数）均为本次两仓库实测。 / Scenarios are by design; the figures quoted are measured on the two repositories tested.')}`);

/* ══════════════════ P07 · 测试方法与可复现性 ══════════════════ */
const codeLine = (s, hi) => { const col = hi ? '#E3A33E' : '#A8B2BE'; return `<Text style={{ fontSize: 11, lineHeight: 1.75, color: '${col}' }}>${s}</Text>`; };
const cell = (s, w, c = '#A8B2BE', sz = 10.5, al = 'left') =>
  `<Text style={{ width: ${w}, fontSize: ${sz}, color: '${c}', textAlign: '${al}' }}>${s}</Text>`;

pages['07_method'] = slide(`
${head('测试方法与可复现性', 'Method and reproducibility')}
    <Box style={{ height: 500 }}>
      <Box style={{ height: 62, padding: '10px 18px', background: 'rgba(76,184,166,0.10)', border: '1px solid rgba(76,184,166,0.40)', borderRadius: 10, justifyContent: 'center' }}>
        <Text style={{ fontSize: 13.5, fontWeight: 'bold', color: '#4CB8A6' }}>
          测试范围：严格限定为 openclaw/openclaw 与 ody-cai/topfo 两个公开仓库，仅此两个，未测试任何第三个仓库。
        </Text>
        <Text style={{ fontSize: 10.5, color: '#8892A0', marginTop: 4 }}>
          Scope: strictly openclaw/openclaw and ody-cai/topfo — these two public repositories only. No third repository was tested.
        </Text>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 240, marginTop: 14 }}>
        <Box style={{ flex: 1.05, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>复现命令 / Reproduce</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>在本项目根目录依次执行，结果与本 PPT 一致。</Text>
          <Box style={{ marginTop: 8 }}>
            ${codeLine('# 纯计算层：信噪分离与硬指标')}
            ${codeLine('node bin/ca.mjs mine --repo=openclaw/openclaw --limit=60 --json')}
            ${codeLine('node bin/ca.mjs mine --repo=ody-cai/topfo     --limit=60 --json')}
            ${codeLine('# 完整三模型流水线 + 证据接地校验', true)}
            ${codeLine('node bin/ca.mjs excavate --repo=ody-cai/topfo --limit=60 --json')}
            ${codeLine('node --test tests/*.test.mjs   # 单元测试')}
            ${codeLine('node bin/ca.mjs capabilities   # 列出全部接口')}
          </Box>
        </Box>

        <Box style={{ flex: 1, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>采集口径 / Capture</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>全部数字来自 GitHub REST API v3 现场拉取，无一条预置。</Text>
          <Box style={{ marginTop: 9 }}>
            <Box style={{ flexDirection: 'row', height: 22, borderBottom: '1px solid #2C3542' }}>
              ${cell('仓库 / Repository', 168, '#8892A0', 10)}
              ${cell('提交数', 46, '#8892A0', 10, 'right')}
              ${cell('API 调用', 58, '#8892A0', 10, 'right')}
              ${cell('纯计算', 52, '#8892A0', 10, 'right')}
              ${cell('全流程', 52, '#8892A0', 10, 'right')}
            </Box>
            <Box style={{ flexDirection: 'row', marginTop: 7 }}>
              ${cell('openclaw/openclaw', 168, '#EDF1F5')}
              ${cell(String(OC.capture.limit), 46, '#EDF1F5', 10.5, 'right')}
              ${cell(String(OC.capture.apiCalls), 58, '#EDF1F5', 10.5, 'right')}
              ${cell(OC.wallClock.mineSec + 's', 52, '#4CB8A6', 10.5, 'right')}
              ${cell(OC.wallClock.excavateSec + 's', 52, '#4CB8A6', 10.5, 'right')}
            </Box>
            <Box style={{ flexDirection: 'row', marginTop: 6 }}>
              ${cell('ody-cai/topfo', 168, '#EDF1F5')}
              ${cell(String(TF.hygiene.total), 46, '#EDF1F5', 10.5, 'right')}
              ${cell(String(TF.capture.apiCalls), 58, '#EDF1F5', 10.5, 'right')}
              ${cell(TF.wallClock.mineSec + 's', 52, '#4CB8A6', 10.5, 'right')}
              ${cell(TF.wallClock.excavateSec + 's', 52, '#4CB8A6', 10.5, 'right')}
            </Box>
          </Box>
          <Text style={{ fontSize: 10, lineHeight: 1.5, color: '#6B7684', marginTop: 10 }}>
            窗口 openclaw：${OC.capture.windowFrom} → ${OC.capture.windowTo}（${OC.capture.windowSpanText}）
            <br />窗口 topfo：${TF.capture.windowFrom} → ${TF.capture.windowTo}（${TF.rhythm.spanDays} 天）
            <br />耗时为本机 /usr/bin/time 实测墙钟；窗口会随时间滚动，重跑得到的窗口可能不同，方法与字段完全一致。
          </Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 170, marginTop: 14 }}>
        <Box style={{ flex: 1, padding: '12px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 11.5, fontWeight: 'bold', color: '#4CB8A6' }}>多模型分工 / Model assignment</Text>
          <Text style={{ fontSize: 11, lineHeight: 1.6, color: '#A8B2BE', marginTop: 6 }}>
            叙事者 ${OC.analysis.models.narrator} · 假设者 ${OC.analysis.models.hypothesizer} · 审稿人 ${OC.analysis.models.appraiser}
            <br />${OC.analysis.distinctModels} 个模型 · ${OC.analysis.mode} · 统一走 OpenAI 兼容协议
            <br />三者是<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>串行有依赖</span>而非并行投票：假设者读叙事者的输出，审稿人读前两者输出加程序给出的客观指标，因此它能说出「这条结论引用了不存在的提交」，而不是含糊地说「可能不准」。
          </Text>
          <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: '#6B7684', marginTop: 5 }}>
            Sequential dependency, not parallel voting — the appraiser sees the program's evidence check before judging.
          </Text>
        </Box>
        <Box style={{ flex: 1, padding: '12px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 11.5, color: '#E3A33E', fontWeight: 'bold' }}>零预置数据 / No prefabricated data</Text>
          <Text style={{ fontSize: 11, lineHeight: 1.6, color: '#A8B2BE', marginTop: 6 }}>
            {/* 诚实声明：API 失败就降级，不填假数据 */}
            无合成 fixture 出现在演示路径上。任一上游不可用时会显式降级并把降级原因写入输出（本次两仓库 ${OC.analysis.degradations.length + TF.analysis.degradations.length} 次降级），而不是补一个看起来合理的数字。
            <br />运行环境：Node.js ESM · macOS · GitHub API 已鉴权；两个仓库合计消耗 ${OC.capture.apiCalls + TF.capture.apiCalls} 次 API 调用。
          </Text>
          <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: '#6B7684', marginTop: 5 }}>
            No synthetic fixtures on the demo path; degradations are reported instead of papered over. This run used ${OC.capture.apiCalls + TF.capture.apiCalls} API calls in total.
          </Text>
        </Box>
      </Box>
    </Box>
${foot(7, SRC_OPENCLAW_TEST)}`);

/* ══════════════════ P08 · openclaw 实测 ══════════════════ */
const stat = (v, l, en, c = '#EDF1F5', sz = 22) => `
        <Box style={{ flex: 1 }}>
          <Text style={{ fontSize: ${sz}, fontWeight: 'bold', color: '${c}', fontFamily: "${SERIF}" }}>${v}</Text>
          <Text style={{ fontSize: 10.5, color: '#EDF1F5', marginTop: 3 }}>${l}</Text>
          <Text style={{ fontSize: 9.5, color: '#8892A0', marginTop: 1 }}>${en}</Text>
        </Box>`;

pages['08_test_openclaw'] = slide(`
${head('实测 A · openclaw/openclaw', 'Measured A · openclaw/openclaw', `<Text style={{ fontSize: 10.5, color: '#8892A0', textAlign: 'right' }}>TypeScript · ${OC.repo.stars.toLocaleString('en-US')} stars · GitHub REST API v3</Text>`)}
    <Box style={{ height: 500 }}>
      <Box style={{ flexDirection: 'row', gap: 16, height: 268, alignItems: 'flex-start' }}>
        <Box style={{ width: 468, padding: 8, background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Image src="${ASSETS}/openclaw-top.png" style={{ width: 452, height: 223 }} />
        </Box>
        <Box style={{ flex: 1, padding: '14px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>本次实测关键数字 / Key measurements</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>窗口 ${OC.capture.windowFrom} → ${OC.capture.windowTo}（UTC，共 ${OC.capture.windowSpanText}）</Text>
          <Box style={{ flexDirection: 'row', marginTop: 12 }}>
            ${stat(String(OC.signal.analyzed), '次提交已分析', 'commits analysed', '#EDF1F5', 20)}
            ${stat(OC.signal.signalRate + '%', '人类决策占比', 'human signal', '#4CB8A6', 20)}
            ${stat(OC.risk.score + '/100', '风险分（低）', 'risk score', '#4CB8A6', 20)}
          </Box>
          <Box style={{ flexDirection: 'row', marginTop: 14 }}>
            ${stat(String(OC.signal.botCommits), '次机器人提交（' + OC.signal.botRate + '%）', 'bot commits', '#EDF1F5', 20)}
            ${stat(OC.signal.commitsPerHour + '', '次提交 / 小时', 'commits per hour', '#E3A33E', 20)}
            ${stat(String(OC.concentration.authorCount), '位作者', 'distinct authors', '#EDF1F5', 20)}
          </Box>
          <Text style={{ fontSize: 10, lineHeight: 1.5, color: '#6B7684', marginTop: 'auto' }}>
            机器人来源：${OC.signal.botAuthors.map((b) => b.author + ' ×' + b.commits).join('、')}；平均每 ${OC.signal.minutesPerCommit} 分钟一次提交，活跃天数 ${OC.rhythm.activeDays} 天。
            <br />界面示例按钮（chalk / axios 等）仅为快捷输入，本次未对其中任何仓库运行测试。
          </Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 218, marginTop: 14 }}>
        <Box style={{ flex: 1, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>风险因子拆解 / Risk factors</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>总分 ${OC.risk.score} / 100 · ${OC.risk.level}</Text>
          <Box style={{ marginTop: 12 }}>
            ${OC.risk.factors.map((f) => factorRow(f, '#E3A33E')).join('')}
          </Box>
        </Box>
        <Box style={{ flex: 1, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>其他可核查指标 / Other verifiable metrics</Text>
          <Text style={{ fontSize: 11, lineHeight: 1.6, color: '#A8B2BE', marginTop: 8 }}>
            · 提交信息卫生：${OC.hygiene.total} 条提交中 ${OC.hygiene.vagueCount} 条无信息量（含糊率 ${OC.hygiene.vagueRate}%），平均信息长度 ${OC.hygiene.avgMsgLen} 字符<br />
            · 显式回滚提交：${OC.hygiene.revertCount} 次　·　单点归属文件：${OC.soloOwned.count} 个<br />
            · 改动热度最高：${OC.hotspots[0].file}<br />
            　（churn ${OC.hotspots[0].churn}，净变化 ${OC.hotspots[0].net}，提交 ${OC.hotspots[0].lastSha}）<br />
            · 知识集中度：${OC.concentration.topAuthor} 一人 ${OC.concentration.topAuthorCommits} 次提交（${OC.concentration.topAuthorSharePct}%）、${OC.concentration.topAuthorChurn.toLocaleString('en-US')} 行改动、${OC.concentration.topAuthorFiles} 个文件
          </Text>
          <Text style={{ fontSize: 9.5, lineHeight: 1.45, color: '#6B7684', marginTop: 'auto' }}>
            All figures above are computed locally from the API response; the UI screenshot is a separate live run on the same day.
          </Text>
        </Box>
      </Box>
    </Box>
${foot(8, SRC_OC)}`);

/* ══════════════════ P09 · topfo 实测 ══════════════════ */
pages['09_test_topfo'] = slide(`
${head('实测 B · ody-cai/topfo', 'Measured B · ody-cai/topfo', `<Text style={{ fontSize: 10.5, color: '#8892A0', textAlign: 'right' }}>HTML · ${TF.repo.stars} stars · ${TF.rhythm.spanDays} 天跨度 · GitHub REST API v3</Text>`)}
    <Box style={{ height: 500 }}>
      <Box style={{ flexDirection: 'row', gap: 16, height: 268, alignItems: 'flex-start' }}>
        <Box style={{ width: 468, padding: 8, background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Image src="${ASSETS}/topfo-top.png" style={{ width: 452, height: 223 }} />
        </Box>
        <Box style={{ flex: 1, padding: '14px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>本次实测关键数字 / Key measurements</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>窗口 ${TF.capture.windowFrom} → ${TF.capture.windowTo}（UTC，共 ${TF.rhythm.spanDays} 天；活跃 ${TF.rhythm.activeDays} 天）</Text>
          <Box style={{ flexDirection: 'row', marginTop: 12 }}>
            ${stat(String(TF.signal.analyzed), '次提交已分析', 'commits analysed', '#EDF1F5', 20)}
            ${stat(TF.risk.score + '/100', '风险分（中）', 'risk score', '#E3A33E', 20)}
            ${stat(ovCount(TF), '处被放弃的尝试', 'abandoned attempts', '#E3A33E', 20)}
          </Box>
          <Box style={{ flexDirection: 'row', marginTop: 14 }}>
            ${stat(String(TF.hygiene.vagueCount), '条含糊提交', 'vague messages', '#4CB8A6', 20)}
            ${stat(String(TF.thrash.count), '个文件原地打转', 'thrashing files', '#E3A33E', 20)}
            ${stat(TF.rhythm.longestGapDays + ' 天', '最长沉寂期', 'longest dormant gap', '#E3A33E', 20)}
          </Box>
          <Text style={{ fontSize: 10, lineHeight: 1.5, color: '#6B7684', marginTop: 'auto' }}>
            机器人提交 ${TF.signal.botCommits} 次（${TF.signal.botRate}%）；平均每 ${TF.rhythm.avgDaysPerCommit} 天一次提交；沉寂期 ${TF.rhythm.longestGapFrom} → ${TF.rhythm.longestGapTo}。
          </Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 218, marginTop: 14 }}>
        <Box style={{ flex: 1, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>风险因子拆解 / Risk factors</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>总分 ${TF.risk.score} / 100 · ${TF.risk.level}</Text>
          <Box style={{ marginTop: 12 }}>
            ${TF.risk.factors.map((f) => factorRow(f, '#E3A33E')).join('')}
          </Box>
        </Box>
        <Box style={{ flex: 1, padding: '13px 16px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>其他可核查指标 / Other verifiable metrics</Text>
          <Text style={{ fontSize: 11, lineHeight: 1.75, color: '#A8B2BE', marginTop: 8 }}>
            · 提交信息卫生：${TF.hygiene.total} 条提交中 ${TF.hygiene.vagueCount} 条无信息量（含糊率 ${TF.hygiene.vagueRate}%），平均信息长度 ${TF.hygiene.avgMsgLen} 字符<br />
            · 显式回滚提交：${TF.hygiene.revertCount} 次<br />
            · 改动热度前三：${TF.hotspots[0].file}（churn ${TF.hotspots[0].churn.toLocaleString('en-US')}）、<br />
            　　${TF.hotspots[1].file}（churn ${TF.hotspots[1].churn.toLocaleString('en-US')}）、${TF.hotspots[2].file}（churn ${TF.hotspots[2].churn.toLocaleString('en-US')}，${TF.hotspots[2].touches} 次改动）<br />
            · 单点归属文件：${TF.soloOwned.count} 个<br />
            · 知识集中度：${TF.concentration.topAuthor} 一人 ${TF.concentration.topAuthorCommits} 次提交（${TF.concentration.topAuthorSharePct}%）、${TF.concentration.topAuthorChurn.toLocaleString('en-US')} 行改动、${TF.concentration.topAuthorFiles} 个文件
          </Text>
        </Box>
      </Box>
    </Box>
${foot(9, SRC_TF)}`);

function ovCount(t) {
  return String(t.abandoned.verifiedCount);
}

for (const [name, dsl] of Object.entries(pages)) {
  writeFileSync(`${OUT}/${name}.slide`, dsl + '\n', 'utf8');
  console.log('wrote', name, dsl.length);
}
