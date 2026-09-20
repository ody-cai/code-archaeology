// 由 FACTS.json 驱动生成全部幻灯片 DSL。
// 页面上出现的每一个数字都来自这里对 FACTS 的插值 —— 不允许手写。
//
// 用法：node build-slides.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const FACTS = JSON.parse(readFileSync('../judge-evidence/FACTS.json', 'utf8'));
const OC = FACTS.openclaw;
const TF = FACTS.topfo;
const ST = FACTS.tool.selfTest;
const TOOL = FACTS.tool;

const OUT = './slides';
mkdirSync(OUT, { recursive: true });

/* ── 设计令牌（与 DESIGN.md 的地层剖面体系一致）───────── */
const C = {
  bg: '#10141A', card: '#1D242E', card2: '#232C38', line: '#2C3542',
  amber: '#E3A33E', teal: '#4CB8A6', ink: '#EDF1F5', muted: '#8892A0', faint: '#6B7684',
};
const SERIF = "'Source Han Serif SC','Noto Serif SC','Songti SC',serif";
const SANS = "'PingFang SC','Microsoft YaHei','Helvetica Neue',sans-serif";
const PAGE = 12;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── 组件：双语段落 ───────────────────────────────── */
function bi(zh, en, o = {}) {
  const { zs = 15, es = 11.5, zc = C.ink, ec = C.muted, lh = 1.5, m = 5, w = null } = o;
  const wAttr = w ? `, width: ${w}` : '';
  return `
    <Text style={{ fontSize: ${zs}, lineHeight: ${lh}, color: '${zc}'${wAttr} }}>${zh}</Text>
    <Text style={{ fontSize: ${es}, lineHeight: 1.45, color: '${ec}', marginTop: ${m}${wAttr} }}>${en}</Text>`;
}

/* ── 组件：页脚 + 来源标注 ────────────────────────── */
// source 支持字符串或字符串数组（多行来源各自一行，避免换行高度不可控）
function foot(n, source) {
  const lines = Array.isArray(source) ? source : [source];
  return `
  <Box style={{ height: 32, justifyContent: 'center' }}>
    ${lines
      .map(
        (t) =>
          `<Text style={{ fontSize: 10, lineHeight: 1.4, color: '#6B7684', textAlign: 'right' }}>${t}</Text>`
      )
      .join('\n    ')}
  </Box>
  <Box style={{ height: 36, marginTop: 6, paddingTop: 8, borderTop: '1px solid #232C38', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
    <Text style={{ fontSize: 12, color: '#8892A0' }}>代码考古学 / Code Archaeology · BAYTECH 2026 · AI 应用与工程赛道</Text>
    <Text style={{ fontSize: 12, color: '#8892A0' }}>${String(n).padStart(2, '0')} / ${PAGE}</Text>
  </Box>`;
}

/* ── 组件：页标题（A 区）──────────────────────────── */
function head(zh, en, right = '') {
  return `
  <Box style={{ height: 96, justifyContent: 'center' }}>
    <Box style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <Box>
        <Text style={{ fontSize: 32, fontWeight: 'bold', lineHeight: 1.22, color: '#EDF1F5', fontFamily: "${SERIF}" }}>${zh}</Text>
        <Text style={{ fontSize: 14.5, color: '#8892A0', marginTop: 7, letterSpacing: 0.3 }}>${en}</Text>
      </Box>
      ${right}
    </Box>
  </Box>`;
}

const slide = (inner) =>
  `<Slide style={{ width: '1280px', height: '720px', padding: '20px 60px', background: '#10141A', fontFamily: "${SANS}", flexDirection: 'column' }}>${inner}
</Slide>`;

/* ── 组件：迷你柱状时间轴（用真实提交数据）────────── */
function bars(values, max, color, w = 1000, h = 46) {
  const n = values.length;
  const gap = 2;
  const bw = Math.max(1, (w - gap * (n - 1)) / n);
  return values
    .map((v, i) => {
      const bh = Math.max(2, Math.round((v / max) * h));
      return `<rect x='${(i * (bw + gap)).toFixed(1)}' y='${h - bh}' width='${bw.toFixed(1)}' height='${bh}' fill='${color}' />`;
    })
    .join('\n                ');
}

/* ── 组件：风险因子条 ─────────────────────────────── */
function factorRow(f, accent) {
  const pct = Math.round((f.score / f.weight) * 100);
  const col = f.score === 0 ? '#3A4553' : accent;
  return `
    <Box style={{ flexDirection: 'row', alignItems: 'center', height: 21 }}>
      <Text style={{ width: 132, fontSize: 11.5, color: '#A8B2BE' }}>${f.label}</Text>
      <Box style={{ width: 118, height: 7, background: '#232C38', borderRadius: 4 }}>
        <Box style={{ width: ${Math.max(2, Math.round(1.18 * pct))}, height: 7, background: '${col}', borderRadius: 4 }} />
      </Box>
      <Text style={{ width: 52, fontSize: 11, color: '${col}', textAlign: 'right', letterSpacing: 0.5 }}>${f.score}/${f.weight}</Text>
      <Text style={{ flex: 1, fontSize: 10.5, color: '#6B7684', marginLeft: 12 }}>${f.raw}</Text>
    </Box>`;
}

export { FACTS, OC, TF, ST, TOOL, C, SERIF, SANS, PAGE, esc, bi, foot, head, slide, bars, factorRow };
