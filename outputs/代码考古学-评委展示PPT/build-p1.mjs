// 生成 P01–P05：封面 + 阅读指南 + PART 1 项目概述
import { writeFileSync } from 'node:fs';
import { FACTS, OC, TF, ST, TOOL, C, SERIF, SANS, PAGE, esc, bi, foot, head, slide, bars, factorRow } from './tokens.mjs';

const OUT = './slides';

const SRC_OC = `第三方仓库来源 / Third-party source：openclaw/openclaw（TypeScript · ${OC.repo.stars.toLocaleString('en-US')} stars）· GitHub REST API v3 · 采集窗口 ${OC.capture.windowFrom} → ${OC.capture.windowTo}（UTC）`;
const SRC_TF = `第三方仓库来源 / Third-party source：ody-cai/topfo（HTML · ${TF.repo.stars} stars）· GitHub REST API v3 · 采集窗口 ${TF.capture.windowFrom} → ${TF.capture.windowTo}（UTC）`;
const SRC_BOTH = `数据来源 / Sources：openclaw/openclaw 与 ody-cai/topfo 均为第三方公开仓库，经 GitHub REST API v3 现场拉取；自检数据来自本机实测，复现命令见第 07 页。`;

const pages = {};

/* ══════════════════ P01 · 封面 ══════════════════ */
pages['01_cover'] = slide(`
    <Box style={{ position: 'absolute', top: -190, right: -150, width: 580, height: 580, borderRadius: 290, background: 'radial-gradient(circle, rgba(227,163,62,0.16) 0%, rgba(227,163,62,0) 70%)' }} />
    <Box style={{ position: 'absolute', bottom: -220, left: -140, width: 540, height: 540, borderRadius: 270, background: 'radial-gradient(circle, rgba(76,184,166,0.12) 0%, rgba(76,184,166,0) 70%)' }} />

    <Box style={{ flexDirection: 'row', width: '1160px', height: '596px', alignItems: 'center', gap: 44 }}>

      <Box style={{ width: 668 }}>
        <Text style={{ fontSize: 17, fontWeight: 'bold', letterSpacing: 5, color: '#E3A33E' }}>CODE ARCHAEOLOGY</Text>
        <Text style={{ fontSize: 68, fontWeight: 'bold', lineHeight: 1.08, color: '#EDF1F5', letterSpacing: 4, marginTop: 14, fontFamily: "${SERIF}" }}>代码考古学</Text>
        <Text style={{ fontSize: 15, color: '#8892A0', letterSpacing: 0.5, marginTop: 10 }}>An information-loss audit for codebases — built on commit history, not on guesses.</Text>

        <Box style={{ width: 92, height: 3, background: '#E3A33E', marginTop: 22 }} />

        <Text style={{ fontSize: 22, lineHeight: 1.5, color: '#EDF1F5', marginTop: 20 }}>
          我们不告诉你「为什么」，<br />只告诉你<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>「哪里已经没人能说清为什么」</span>。
        </Text>
        <Text style={{ fontSize: 13, lineHeight: 1.5, color: '#8892A0', marginTop: 10 }}>
          We don't tell you why — we tell you where nobody can explain why anymore.
        </Text>

        <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 22 }}>
          <Box style={{ width: 30, height: 2, background: '#4CB8A6' }} />
          <Text style={{ fontSize: 14, color: '#EDF1F5' }}>BAYTECH 2026 国际湾区创科节 · AI 应用与工程赛道</Text>
        </Box>
        <Text style={{ fontSize: 12, color: '#8892A0', marginTop: 6 }}>蔡奇均 / Cai Qijun（ody-cai）· 深圳 · 联系邮箱 cqjody@126.com</Text>

        <Box style={{ marginTop: 20, padding: '12px 16px', background: '#1D242E', borderLeft: '3px solid #4CB8A6', borderRadius: 8 }}>
          <Text style={{ fontSize: 12, lineHeight: 1.5, color: '#EDF1F5' }}>
            本 PPT 为<span style={{ color: '#4CB8A6', fontWeight: 'bold' }}>完全自解释材料</span>：不依赖现场讲解，评委会从头读到尾即可掌握项目全貌。全篇中英双语，全部数据来自两个公开仓库的现场实测并可本机复现。
          </Text>
          <Text style={{ fontSize: 10.5, lineHeight: 1.45, color: '#8892A0', marginTop: 5 }}>
            This deck is fully self-contained: no live narration is required. Every figure is bilingual and was measured live on two public repositories, reproducible on any machine.
          </Text>
        </Box>
      </Box>

      <Box style={{ width: 448 }}>
        <svg width={448} height={392} viewBox='0 0 448 392'>
          <rect x='0' y='0' width='448' height='32' fill='#1D242E' />
          <rect x='0' y='32' width='448' height='48' fill='#232C38' />
          <rect x='0' y='80' width='448' height='30' fill='#1D242E' />
          <rect x='0' y='110' width='448' height='58' fill='#E3A33E' />
          <rect x='0' y='168' width='448' height='36' fill='#232C38' />
          <rect x='0' y='204' width='448' height='52' fill='#1D242E' />
          <rect x='0' y='256' width='448' height='30' fill='#232C38' />
          <rect x='0' y='286' width='448' height='56' fill='#1D242E' />
          <rect x='0' y='342' width='448' height='38' fill='#232C38' />
          <line x1='0' y1='32' x2='448' y2='32' stroke='#10141A' strokeWidth='2' />
          <line x1='0' y1='80' x2='448' y2='80' stroke='#10141A' strokeWidth='2' />
          <line x1='0' y1='168' x2='448' y2='168' stroke='#10141A' strokeWidth='2' />
          <line x1='0' y1='204' x2='448' y2='204' stroke='#10141A' strokeWidth='2' />
          <line x1='0' y1='256' x2='448' y2='256' stroke='#10141A' strokeWidth='2' />
          <line x1='0' y1='286' x2='448' y2='286' stroke='#10141A' strokeWidth='2' />
          <line x1='0' y1='342' x2='448' y2='342' stroke='#10141A' strokeWidth='2' />
          <rect x='60' y='14' width='52' height='4' fill='#3A4553' />
          <rect x='204' y='50' width='88' height='5' fill='#3A4553' />
          <rect x='96' y='92' width='40' height='4' fill='#3A4553' />
          <rect x='312' y='182' width='64' height='4' fill='#3A4553' />
          <rect x='72' y='224' width='96' height='5' fill='#3A4553' />
          <rect x='258' y='268' width='52' height='4' fill='#3A4553' />
          <rect x='114' y='308' width='74' height='5' fill='#3A4553' />
          <rect x='298' y='358' width='58' height='4' fill='#3A4553' />
          <rect x='56' y='126' width='34' height='7' fill='#10141A' opacity='0.55' />
          <rect x='108' y='142' width='58' height='7' fill='#10141A' opacity='0.55' />
          <rect x='184' y='126' width='44' height='7' fill='#10141A' opacity='0.55' />
          <rect x='248' y='146' width='70' height='7' fill='#10141A' opacity='0.55' />
          <rect x='336' y='128' width='48' height='7' fill='#10141A' opacity='0.55' />
          <line x1='448' y1='139' x2='432' y2='139' stroke='#E3A33E' strokeWidth='3' />
          <circle cx='432' cy='139' r='5' fill='#10141A' />
        </svg>
        <Box style={{ flexDirection: 'row', gap: 22, marginTop: 14, alignItems: 'center' }}>
          <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Box style={{ width: 20, height: 11, background: '#E3A33E', borderRadius: 2 }} />
            <Text style={{ fontSize: 12, color: '#EDF1F5' }}>人类决策痕迹</Text>
          </Box>
          <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Box style={{ width: 20, height: 11, background: '#232C38', border: '1px solid #3A4553', borderRadius: 2 }} />
            <Text style={{ fontSize: 12, color: '#8892A0' }}>机器人沉积物</Text>
          </Box>
        </Box>
        <Text style={{ fontSize: 10.5, lineHeight: 1.4, color: '#6B7684', marginTop: 8 }}>
          地层隐喻：自动化提交掩埋人类决策，只有剥离沉积物才能读到意图 / Strata metaphor: automation buries human decisions.
        </Text>
      </Box>
    </Box>

    <Box style={{ height: 30, justifyContent: 'flex-end' }}>
      <Text style={{ fontSize: 10.5, color: '#6B7684', textAlign: 'right' }}>${SRC_BOTH}</Text>
    </Box>
    <Box style={{ height: 42, marginTop: 6, paddingTop: 8, borderTop: '1px solid #232C38', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 12, color: '#8892A0' }}>版本 v${TOOL.version} · 线上地址 ${TOOL.liveUrl}</Text>
      <Text style={{ fontSize: 12, color: '#8892A0' }}>01 / ${PAGE}</Text>
    </Box>`);

/* ══════════════════ P02 · 阅读指南 + 目录 ══════════════════ */
const toc1 = [
  ['03', '问题：读代码看不到的三类信息', 'The problem: three things code never shows'],
  ['04', '方案：三段流水线', 'The solution: a three-stage pipeline'],
  ['05', '产品形态与核心用途', 'Product forms and core uses'],
  ['06', '价值、场景与已知边界', 'Value, scenarios and known boundaries'],
];
const toc2 = [
  ['07', '测试方法与可复现性', 'Method and reproducibility'],
  ['08', `实测 A：openclaw/openclaw`, 'Measured A: openclaw/openclaw'],
  ['09', `实测 B：ody-cai/topfo`, 'Measured B: ody-cai/topfo'],
  ['10', '「被放弃的尝试」逐条清单', 'Abandoned attempts, item by item'],
  ['11', '多模型分析层与证据接地', 'Multi-model layer and evidence grounding'],
  ['12', '工程完备性、自我证伪与问答', 'Engineering, self-falsification, Q&A'],
];
const tocCol = (title, en, items, accent) => `
      <Box style={{ flex: 1, padding: '14px 18px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
        <Text style={{ fontSize: 13, fontWeight: 'bold', color: '${accent}', letterSpacing: 1 }}>${title}</Text>
        <Text style={{ fontSize: 10.5, color: '#8892A0', marginTop: 4 }}>${en}</Text>
        ${items
          .map(
            ([n, zh, e]) => `
        <Box style={{ flexDirection: 'row', marginTop: 11, alignItems: 'flex-start' }}>
          <Text style={{ width: 26, fontSize: 12, color: '${accent}', fontWeight: 'bold' }}>P${n}</Text>
          <Box style={{ flex: 1 }}>
            <Text style={{ fontSize: 12.5, lineHeight: 1.35, color: '#EDF1F5' }}>${zh}</Text>
            <Text style={{ fontSize: 10, lineHeight: 1.3, color: '#8892A0', marginTop: 2 }}>${e}</Text>
          </Box>
        </Box>`
          )
          .join('')}
      </Box>`;

pages['02_guide'] = slide(`
${head('本 PPT 怎么读 · 全篇自解释', 'How to read this deck — fully self-contained', `<Text style={{ fontSize: 11, color: '#8892A0', textAlign: 'right' }}>共 ${PAGE} 页 · 中英双语 · 数据全部现场实测</Text>`)}
    <Box style={{ height: 500, marginTop: 0 }}>
      <Box style={{ height: 88, padding: '12px 18px', background: '#1D242E', borderLeft: '3px solid #4CB8A6', borderRadius: 10, justifyContent: 'center' }}>
        ${bi(
          '阅读方式：第 03–06 页是第一部分「项目概述」，回答「为什么做、做成什么、有什么用」；第 07–12 页是第二部分「真实运行数据」，把所有结论落到两个公开仓库的现场实测上。每页页脚均标注数据来源与页码。',
          'Reading order: pages 03–06 form Part 1 (project overview: why, what, and what it is for). Pages 07–12 form Part 2 (real runtime data): every claim is anchored to live measurements on two public repositories. Each page footer carries its data source and page number.',
          { zs: 13, es: 10.5, lh: 1.5 }
        )}
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 392, marginTop: 16 }}>
        ${tocCol('PART 1 · 项目概述', 'Project overview', toc1, C.amber)}
        ${tocCol('PART 2 · 真实运行数据', 'Real runtime data — openclaw/openclaw & ody-cai/topfo', toc2, C.teal)}
      </Box>
    </Box>
${foot(2, '测试范围声明 / Scope：本次全部实测严格限定为 openclaw/openclaw 与 ody-cai/topfo 两个公开仓库，未测试任何第三个仓库。')}`);

/* ══════════════════ P03 · 问题 ══════════════════ */
const ocPerHour = OC.signal.commitsPerHour;
const ocTop = OC.concentration;
const tfTop = TF.concentration;
const ovMin = TF.abandoned.overlapRange.min;
const ovMax = TF.abandoned.overlapRange.max;
const surv = TF.abandoned.verified.map((x) => x.survivedMinutes);
const survMin = Math.min(...surv);
const survMax = Math.max(...surv);
const hhmm = (m) => `${Math.floor(m / 60)} 小时 ${m % 60} 分`;

const evidenceCard = (n, zhTitle, enTitle, zhBody, enBody, measured) => `
        <Box style={{ flex: 1, padding: '16px 18px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38', flexDirection: 'column' }}>
          <Text style={{ fontSize: 30, fontWeight: 'bold', lineHeight: 1, color: '#E3A33E', fontFamily: "${SERIF}" }}>${n}</Text>
          <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#EDF1F5', marginTop: 8 }}>${zhTitle}</Text>
          <Text style={{ fontSize: 11, color: '#8892A0', marginTop: 3, letterSpacing: 0.3 }}>${enTitle}</Text>
          <Text style={{ fontSize: 12.5, lineHeight: 1.55, color: '#A8B2BE', marginTop: 10 }}>${zhBody}</Text>
          <Text style={{ fontSize: 10, lineHeight: 1.4, color: '#6B7684', marginTop: 5 }}>${enBody}</Text>
          <Box style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #2C3542' }}>
            <Text style={{ fontSize: 11, lineHeight: 1.4, color: '#4CB8A6' }}>${measured}</Text>
          </Box>
        </Box>`;

pages['03_problem'] = slide(`
${head('有一类信息，读代码永远看不到', 'Some information never shows up in the code itself')}
    <Box style={{ height: 500 }}>
      <Box style={{ height: 76, padding: '11px 18px', background: '#1D242E', borderLeft: '3px solid #E3A33E', borderRadius: 10, justifyContent: 'center' }}>
        ${bi(
          '技术尽调评估复杂度、覆盖率与维护成本，却几乎不评估更致命的一项：这个代码库的知识还能不能被交接。下面三条全部来自本次两个仓库的现场实测。',
          'Due diligence measures complexity, coverage and maintenance cost — almost never the more fatal question: can this codebase\'s knowledge still be handed over? All three findings below are live measurements from the two repositories tested.',
          { zs: 13, es: 10.5, lh: 1.5 }
        )}
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 344, marginTop: 14 }}>
${evidenceCard(
  '01',
  '节奏被压扁',
  'Velocity is invisible in the final state',
  `openclaw/openclaw 的 ${OC.capture.limit} 次提交全部落在 <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${OC.capture.windowSpanText}</span> 之内，约合每小时 ${ocPerHour} 次、平均每 ${OC.signal.minutesPerCommit} 分钟一次，活跃天数 ${OC.rhythm.activeDays} 天。读 main 分支的终态看不到这种速度，也无法判断哪些改动是被时限逼出来的。`,
  'All 60 commits fall inside a single 2h16m window — about 26.5 commits per hour. The final state of main tells you nothing about this tempo.',
  `实测 openclaw：${OC.capture.limit} 次提交 / ${OC.capture.windowSpanText} / ${ocPerHour} 次·小时`
)}
${evidenceCard(
  '02',
  '知识集中在一个人头上',
  'Single point of knowledge',
  `openclaw 有 ${ocTop.authorCount} 位作者，但 <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${ocTop.topAuthorSharePct}%</span> 的提交来自 ${ocTop.topAuthor} 一人（${ocTop.topAuthorCommits} 次提交、${ocTop.topAuthorChurn.toLocaleString('en-US')} 行改动、${ocTop.topAuthorFiles} 个文件）。ody-cai/topfo 更极端：<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${tfTop.topAuthorSharePct}%</span> 的提交来自 ${tfTop.topAuthor}。代码里没有任何一行标注「这些文件只有一个人懂」。`,
  'openclaw has 8 authors, yet 80% of commits come from one person. topfo is starker: 96% from a single author. No line of code records this.',
  `实测 openclaw：${ocTop.topAuthorCommits}/${OC.hygiene.total} 次（${ocTop.topAuthorSharePct}%）／topfo：${tfTop.topAuthorCommits}/${TF.hygiene.total} 次（${tfTop.topAuthorSharePct}%）`
)}
${evidenceCard(
  '03',
  '先进后出，代码里零痕迹',
  'Added then removed — zero trace',
  `ody-cai/topfo 有 <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${TF.abandoned.verifiedCount} 处</span>改动在数小时内被整体拆除，拆除内容与当初新增内容重合 <span style={{ color: '#E3A33E', fontWeight: 'bold' }}>${ovMin}%–${ovMax}%</span>，存活时间最短 ${hhmm(survMin)}、最长 ${hhmm(survMax)}。这些功能在今天的代码库里查不到任何痕迹 —— 没有 TODO、没有注释、没有残留分支，只能从提交历史里挖出来。`,
  'Seven changes in topfo were added and then wholly removed within hours, with 93–100% content overlap. Today the code contains no trace of them.',
  `实测 topfo：${TF.abandoned.verifiedCount} 处已核实 · 重合 ${ovMin}%–${ovMax}% · 存活 ${hhmm(survMin)}–${hhmm(survMax)}`
)}
      </Box>

      <Box style={{ height: 48, marginTop: 14, padding: '0 18px', background: 'rgba(227,163,62,0.10)', border: '1px solid rgba(227,163,62,0.35)', borderRadius: 10, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Text style={{ fontSize: 14, color: '#E3A33E', fontWeight: 'bold' }}>于是问题不是「这个项目好不好」，而是「它还能不能被交接」。</Text>
        <Text style={{ fontSize: 10.5, color: '#8892A0' }}>The real question is not whether the project is good — but whether it can still be handed over.</Text>
      </Box>
    </Box>
${foot(3, `${SRC_OC} ｜ ${SRC_TF}`)}`);

/* ══════════════════ P04 · 方案 ══════════════════ */
const stageCard = (no, zh, en, body, enBody, tag, accent) => `
        <Box style={{ flex: 1, padding: '15px 17px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38', flexDirection: 'column' }}>
          <Text style={{ fontSize: 10.5, fontWeight: 'bold', color: '${accent}', letterSpacing: 1.5 }}>${no}</Text>
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#EDF1F5', marginTop: 6 }}>${zh}</Text>
          <Text style={{ fontSize: 10.5, color: '#8892A0', marginTop: 3 }}>${en}</Text>
          <Text style={{ fontSize: 12.5, lineHeight: 1.55, color: '#A8B2BE', marginTop: 9 }}>${body}</Text>
          <Text style={{ fontSize: 10, lineHeight: 1.4, color: '#6B7684', marginTop: 4 }}>${enBody}</Text>
          <Box style={{ marginTop: 'auto', paddingTop: 9, borderTop: '1px solid #2C3542' }}>
            <Text style={{ fontSize: 10.5, lineHeight: 1.4, color: '${accent}' }}>${tag}</Text>
          </Box>
        </Box>`;

pages['04_solution'] = slide(`
${head('先筛地层，再挖文物，最后自己查自己', 'Sift the strata, excavate the artifacts, then audit ourselves')}
    <Box style={{ height: 500 }}>
      <svg width={1160} height={132} viewBox='0 0 1160 132'>
        <rect x='0' y='24' width='356' height='86' rx='8' fill='#1D242E' stroke='#2C3542' />
        <rect x='392' y='24' width='356' height='86' rx='8' fill='#1D242E' stroke='#2C3542' />
        <rect x='784' y='24' width='376' height='86' rx='8' fill='#1D242E' stroke='#4CB8A6' />
        <text x='24' y='48' fill='#4CB8A6' fontFamily='Helvetica Neue, sans-serif' fontSize='11' fontWeight='bold'>STAGE 01 · PURE COMPUTATION</text>
        <text x='24' y='72' fill='#EDF1F5' fontFamily='PingFang SC, sans-serif' fontSize='14'>信噪分离 · 纯计算</text>
        <text x='24' y='92' fill='#8892A0' fontFamily='Helvetica Neue, sans-serif' fontSize='10.5'>Signal / noise separation</text>
        <text x='416' y='48' fill='#E3A33E' fontFamily='Helvetica Neue, sans-serif' fontSize='11' fontWeight='bold'>STAGE 02 · 3 VENDORS</text>
        <text x='416' y='72' fill='#EDF1F5' fontFamily='PingFang SC, sans-serif' fontSize='14'>多模型分工 · 3 家供应商</text>
        <text x='416' y='92' fill='#8892A0' fontFamily='Helvetica Neue, sans-serif' fontSize='10.5'>Three models, sequential roles</text>
        <text x='808' y='48' fill='#4CB8A6' fontFamily='Helvetica Neue, sans-serif' fontSize='11' fontWeight='bold'>STAGE 03 · SET ARITHMETIC</text>
        <text x='808' y='72' fill='#EDF1F5' fontFamily='PingFang SC, sans-serif' fontSize='14'>证据接地校验 · SHA 集合运算</text>
        <text x='808' y='92' fill='#8892A0' fontFamily='Helvetica Neue, sans-serif' fontSize='10.5'>Evidence grounding check</text>
        <path d='M358 67 L388 67' stroke='#E3A33E' strokeWidth='2' />
        <path d='M382 62 L390 67 L382 72 Z' fill='#E3A33E' />
        <path d='M750 67 L780 67' stroke='#4CB8A6' strokeWidth='2' />
        <path d='M774 62 L782 67 L774 72 Z' fill='#4CB8A6' />
        <text x='0' y='12' fill='#6B7684' fontFamily='PingFang SC, sans-serif' fontSize='10.5'>输入 owner/name（公开仓库）→ 输出：客观指标 + 决策史 + 证据接地报告 ｜ Input: owner/name of a public repo. Output: hard metrics, decision history, grounding report.</text>
        <text x='0' y='126' fill='#4CB8A6' fontFamily='PingFang SC, sans-serif' fontSize='10.5'>STAGE 01 不调用任何模型，STAGE 03 不出现在任何模型的输出里 —— 两者都由程序独立完成。 ｜ Neither stage 01 nor stage 03 involves any model.</text>
      </svg>

      <Box style={{ flexDirection: 'row', gap: 16, height: 356, marginTop: 6 }}>
${stageCard(
  'STAGE 01',
  '信噪分离',
  'Signal / noise separation — pure computation',
  `先用机器规则把自动化提交（机器人、生成物）与人类决策分开，再逐文件解析改动。这一层不调用任何模型，输出全部是可验证的客观统计：信噪比、改动热度、原地打转、被放弃的尝试、提交信息卫生、沉寂期。报告的第一个数字是信噪比，而不是结论。`,
  'Robotic and generated commits are separated before any analysis. No model is involved; every output is a verifiable statistic.',
  `实测：openclaw ${OC.capture.apiCalls} 次 API 调用 / ${OC.wallClock.mineSec} 秒；topfo ${TF.capture.apiCalls} 次 / ${TF.wallClock.mineSec} 秒`,
  C.teal
)}
${stageCard(
  'STAGE 02',
  '多模型真分工',
  'Three models from three vendors, working in sequence',
  `叙事者 ${TOOL.selfTest ? 'gpt-4o' : ''} 把提交序列还原成决策史；假设者推断「先进后出」的改动当年想做什么、为何被放弃；审稿人拿到客观指标后复核前两者，并给出裁决、给接手者的建议、以及该去问原作者的问题清单。三者来自三家不同供应商，是<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>串行有依赖</span>，不是并行投票。`,
  'Narrator reconstructs the decision history; hypothesizer infers abandoned intent; appraiser reviews both and issues a verdict plus interview questions.',
  `实测：${OC.analysis.distinctModels} 个模型 · ${OC.analysis.mode} · openclaw 全流程 ${OC.wallClock.excavateSec} 秒 / topfo ${TF.wallClock.excavateSec} 秒`,
  C.amber
)}
${stageCard(
  'STAGE 03',
  '证据接地校验',
  'Evidence grounding — set arithmetic, not model self-review',
  `常见做法是让另一个模型检查前一个有没有胡说 —— 但判官自己也会幻觉，而且无法查证。我们的做法：模型产出的每条结论必须引用具体的 commit SHA，而这些 SHA 是程序从 GitHub 真实拉回来的，于是「引用了一个不存在的提交」可以被<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>一次集合运算</span>直接判定：这是可证明的编造，不是主观判断。`,
  'Every claim must cite a commit SHA pulled from GitHub. A cited-but-nonexistent commit is provable fabrication — decided by set arithmetic, never by a model.',
  `实测：两仓库共 ${OC.analysis.evidenceAudit.overall.claims + TF.analysis.evidenceAudit.overall.claims} 条推断 · 编造 ${OC.analysis.evidenceAudit.overall.fabricated + TF.analysis.evidenceAudit.overall.fabricated} 条 · 无效引用 ${OC.analysis.evidenceAudit.overall.invalidCitations + TF.analysis.evidenceAudit.overall.invalidCitations} 条`,
  C.teal
)}
      </Box>
    </Box>
${foot(4, '本页为方案说明，不引用第三方数据；时序与调用次数为本次两仓库实测量。 / Method page: no third-party data cited; timings and call counts are measured on the two repositories tested.')}`);

/* ══════════════════ P05 · 产品形态与核心用途 ══════════════════ */
const formCard = (kb, zh, en, body, enBody, extra, accent) => `
        <Box style={{ flex: 1, padding: '15px 17px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38', flexDirection: 'column' }}>
          <Text style={{ fontSize: 9.5, fontWeight: 'bold', color: '${accent}', letterSpacing: 1.2 }}>${kb}</Text>
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#EDF1F5', marginTop: 6 }}>${zh}</Text>
          <Text style={{ fontSize: 10.5, color: '#8892A0', marginTop: 3 }}>${en}</Text>
          <Text style={{ fontSize: 12.5, lineHeight: 1.55, color: '#A8B2BE', marginTop: 9 }}>${body}</Text>
          <Text style={{ fontSize: 10, lineHeight: 1.4, color: '#6B7684', marginTop: 4 }}>${enBody}</Text>
          <Box style={{ marginTop: 'auto', paddingTop: 9, borderTop: '1px solid #2C3542' }}>
            <Text style={{ fontSize: 10.5, lineHeight: 1.4, color: '${accent}' }}>${extra}</Text>
          </Box>
        </Box>`;

pages['05_forms'] = slide(`
${head('一次实现，三种形态', 'One engine, three forms')}
    <Box style={{ height: 500 }}>
      <Box style={{ height: 62, padding: '10px 18px', background: '#1D242E', borderLeft: '3px solid #E3A33E', borderRadius: 10, justifyContent: 'center' }}>
        ${bi(
          `引擎只有一套，可被三种方式调用。核心用途：量化代码库的<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>知识可继承性</span>，并指出风险集中在哪几个文件。`,
          'One engine, three entry points — quantifying knowledge inheritability and naming the riskiest files.',
          { zs: 13, es: 10.5, lh: 1.5 }
        )}
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 270, marginTop: 14 }}>
${formCard('WEB · 同源前端', '网页端', 'Zero-build front-end, same origin as the API', `原生 JS + CSS，无构建、无框架、无跨域。输入 owner/name 即可看到信噪比、风险因子拆解、提交时间轴、文件热度、被放弃的尝试清单与原地打转分析。左上角实时显示模型层状态与所用模型数量。`, 'Vanilla JS, no build step, no cross-origin. Paste an owner/name and read the whole report.', `线上地址 ${TOOL.liveUrl}（Worker 版本 ${TOOL.latestWorkerVersion.slice(0, 8)}）`, C.teal)}
${formCard('CLI · 可接 CI', '命令行', 'A CLI that can gate a pull request', `同一条流水线可在终端运行，并支持 --fail-on-risk 指定阈值：风险分超过阈值时以<span style={{ color: '#E3A33E', fontWeight: 'bold' }}>退出码 2</span> 结束，可直接用于卡住合并请求。这让它从一次性报告变成流水线里的一道闸门。`, 'Runs the same pipeline in a terminal; exits with code 2 when the risk score exceeds a threshold.', `实测 ${ST.tests.total} 个单元测试 ${ST.tests.pass}/${ST.tests.total} 通过、${ST.tests.fail} 失败`, C.amber)}
${formCard('API · 8 端点', 'HTTP 接口', 'Eight endpoints, four of them reusable alone', `健康检查、能力清单、纯计算挖掘、完整考古，以及可单独复用的叙事 / 假设 / 评估 / 安全重构四层。调用方无需外部文档即可发现接口。`, 'Health, capabilities, mining, full excavation, plus narrative / hypothesis / appraisal / refactor layers usable on their own.', `能力清单端点返回 ${ST.apiEndpoints} 个可用接口`, C.teal)}
      </Box>

      <Box style={{ flexDirection: 'row', gap: 16, height: 130, marginTop: 14 }}>
        <Box style={{ flex: 1.35, padding: '14px 18px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>自有代码构成 / Own source code</Text>
          <Text style={{ fontSize: 10, color: '#8892A0', marginTop: 3 }}>共 ${ST.code.totalLines.toLocaleString('en-US')} 行 / ${ST.code.totalFiles} 个文件（零依赖框架）</Text>
          <Box style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            ${[
              ['src', ST.code.srcLines, ST.code.srcFiles, C.teal],
              ['public', ST.code.publicLines, ST.code.publicFiles, C.amber],
              ['tests', ST.code.testsLines, ST.code.testsFiles, '#4CB8A6'],
              ['bin', ST.code.binLines, ST.code.binFiles, '#8892A0'],
              ['scripts', ST.code.scriptsLines, ST.code.scriptsFiles, '#8892A0'],
            ]
              .map(
                ([n, l, f, c]) => `
            <Box style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: 'bold', color: '${c}' }}>${l.toLocaleString('en-US')}</Text>
              <Text style={{ fontSize: 10, color: '#EDF1F5', marginTop: 2 }}>${n}</Text>
              <Text style={{ fontSize: 9.5, color: '#8892A0' }}>${f} files</Text>
            </Box>`
              )
              .join('')}
          </Box>
        </Box>
        <Box style={{ flex: 1, padding: '14px 18px', background: '#1D242E', borderRadius: 10, border: '1px solid #232C38' }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#EDF1F5' }}>技术栈与部署 / Stack & deployment</Text>
          <Text style={{ fontSize: 11, lineHeight: 1.6, color: '#A8B2BE', marginTop: 8 }}>
            Node.js ESM · Cloudflare Workers + Assets 绑定（前端与 API 同源）· 零构建原生前端
          </Text>
          <Text style={{ fontSize: 10, lineHeight: 1.5, color: '#8892A0', marginTop: 5 }}>
            同一套路由层也能跑在本地 Node HTTP 容器里 —— 云端不可用时行为一致，不是备份方案而是容错设计。
          </Text>
        </Box>
      </Box>
    </Box>
${foot(5, '本页代码规模与测试数来自本机实测（' + ST.measuredAt + '）；部署版本来自 Cloudflare Workers deployments list。')}`);

for (const [name, dsl] of Object.entries(pages)) {
  writeFileSync(`${OUT}/${name}.slide`, dsl + '\n', 'utf8');
  console.log('wrote', name, dsl.length);
}
