#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""根据已落盘的原始响应与工具输出，生成可验证的 HTML 报告（随后打印为 PDF）。"""
import html, json, pathlib, datetime

BASE = pathlib.Path(__file__).parent
RAW = BASE / "raw"
OUT = BASE / "report.html"

FACTS = json.loads((BASE / "verification-facts.json").read_text(encoding="utf-8"))
CASES = {c["case"]: c for c in FACTS["cases"]}

def read_tsv(name):
    rows = []
    lines = (BASE / name).read_text(encoding="utf-8").rstrip("\n").split("\n")
    head = lines[0].split("\t")
    for ln in lines[1:]:
        cells = ln.split("\t")
        rows.append(dict(zip(head, cells)))
    return rows

MANIFEST = read_tsv("raw/manifest.tsv")
PROBE = read_tsv("sha-probe.tsv")

def tool(name):
    return (BASE / name).read_text(encoding="utf-8").strip("\n")

TOOL_CHALK = tool("tool-chalk-mine.json")
TOOL_OA = tool("tool-oa-mine.json")

def esc(s):
    return html.escape(str(s))

def short(h, n=16):
    return f"{h[:n]}…" if len(h) > n else h

# ---------- 元数据比对 ----------
def case_ev(case, key):
    return CASES[case]["evidence"][key]

MD_PAIRS = [
    ("chalk/chalk", "星标数", "23,317", f'{case_ev("A-chalk/chalk","stargazers_count"):,}',
     "E1 stargazers_count"),
    ("chalk/chalk", "主语言", "JavaScript", case_ev("A-chalk/chalk", "language"),
     "E1 language"),
    ("chalk/chalk", "默认分支", "main", case_ev("A-chalk/chalk", "default_branch"),
     "E1 default_branch"),
    ("chalk/chalk", "分析窗口末端", "2026-09-18",
     case_ev("A-chalk/chalk", "pushed_at")[:10], "E1 pushed_at"),
    ("chalk/chalk", "许可证", "MIT", case_ev("A-chalk/chalk", "license"), "E1 license"),
    ("ody-cai/oa-system", "星标数", "1", f'{case_ev("A-ody-cai/oa-system","stargazers_count"):,}',
     "E5 stargazers_count"),
    ("ody-cai/oa-system", "主语言", "TypeScript", case_ev("A-ody-cai/oa-system", "language"),
     "E5 language"),
    ("ody-cai/oa-system", "分析窗口起点", "2026-05-29",
     case_ev("A-ody-cai/oa-system", "created_at")[:10], "E5 created_at"),
    ("ody-cai/oa-system", "分析窗口末端", "2026-09-12",
     CASES["D-提交史与信噪比"]["computed"]["head_commit"]["date"][:10],
     "E6 head commit author.date"),
    ("ody-cai/oa-system", "许可证", "MIT", case_ev("A-ody-cai/oa-system", "license"), "E5 license"),
]

B = CASES["B-父子链"]
C = CASES["C-行级存在性"]
D = CASES["D-提交史与信噪比"]

# 箭头语义核对：工具输出的 X → Y 中，Y 的 parent 是否就是 X
ARROWS = [
    ("chalk/chalk", "source/index.js", "4c304dd", "5729845",
     B["commit_5729845"]["parents"][0][:7], "是 —— Y 的直接父提交就是 X"),
    ("chalk/chalk", "test/chalk.js", "ff549c5", "8a94e0e",
     json.loads((RAW / "chalk-commit-8a94e0e.json").read_text(encoding="utf-8"))["parents"][0]["sha"][:7],
     "否 —— 箭头表示「该文件相邻两次改动」"),
    ("ody-cai/oa-system", "src/app/dashboard/layout.tsx", "1fbd843", "bc4e63c",
     json.loads((RAW / "oa-commit-bc4e63c.json").read_text(encoding="utf-8"))["parents"][0]["sha"][:7],
     "否 —— 箭头表示「该文件相邻两次改动」"),
    ("ody-cai/oa-system", "README.md（整仓回滚落点）", "62d1b8d", "109fd2c",
     json.loads((RAW / "oa-commit-109fd2c.json").read_text(encoding="utf-8"))["parents"][0]["sha"][:7],
     "否 —— 箭头表示「该文件相邻两次改动」"),
]

gaps = B["computed"]["gap_seconds"]
gap_txt = f"{gaps} 秒（{gaps//3600} 小时 {(gaps%3600)//60} 分 {gaps%60} 秒）"

rows_manifest = "\n".join(
    f"<tr><td class='mono'>{esc(r['id'])}</td><td class='mono url'>{esc(r['url'].replace('https://api.github.com',''))}</td>"
    f"<td class='c'>{esc(r['http_status'])}</td><td class='c'>{esc(r['bytes'])}</td>"
    f"<td class='mono sha'>{esc(r['sha256'][:32])}…</td><td class='mono'>{esc(r['utc_time'])}</td></tr>"
    for r in MANIFEST)

rows_probe = "\n".join(
    f"<tr><td class='mono'>{esc(r['repo'])}</td><td class='mono'>{esc(r['short_sha'])}</td>"
    f"<td class='c'>{esc(r['http'])}</td><td class='mono sha'>{esc(r['full_sha'])}</td>"
    f"<td class='c'>{'✔' if r['prefix_match']=='yes' else '✘'}</td>"
    f"<td class='c'><span class='tag {'ok' if r['verdict']=='GROUNDED' else 'bad'}'>{esc(r['verdict'])}</span></td></tr>"
    for r in PROBE)

rows_md = "\n".join(
    f"<tr><td class='mono'>{esc(a)}</td><td>{esc(b)}</td>"
    f"<td class='mono'>{esc(c)}</td><td class='mono'>{esc(d)}</td>"
    f"<td class='c'>{'✔' if str(c).replace(',','')==str(d).replace(',','') else '✘'}</td>"
    f"<td class='mono tiny'>{esc(e)}</td></tr>"
    for a, b, c, d, e in MD_PAIRS)

rows_arrow = "\n".join(
    f"<tr><td class='mono tiny'>{esc(a)}</td><td class='mono tiny'>{esc(b)}</td>"
    f"<td class='mono'>{esc(c)} → {esc(d)}</td><td class='mono'>{esc(e)}</td>"
    f"<td class='c'>{'父子' if e == c else '非父子'}</td><td class='tiny'>{esc(f)}</td></tr>"
    for a, b, c, d, e, f in ARROWS)

matched_rows = "\n".join(
    f"<tr><td class='c mono'>{esc(l)}</td><td class='mono tiny'>{esc(t)}</td></tr>"
    for l, t in C["computed"]["matched_lines"])

n_files = D["computed"]["sample_size"]
author_list = "、".join(D["computed"]["distinct_authors"])
bot_n = D["computed"]["bot_like_count"]

CSS = """
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { font-family: "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  color:#1a1d21; line-height:1.62; font-size:10.2pt; margin:0; }
header.cover { border-bottom:2.5px solid #1a1d21; padding-bottom:14px; margin-bottom:20px; }
.kicker { font-size:8.6pt; letter-spacing:.18em; color:#5d6672; text-transform:uppercase; }
h1 { font-size:20pt; margin:8px 0 6px; letter-spacing:-.01em; }
.sub { color:#4a5460; font-size:10pt; }
.meta { margin-top:10px; font-size:8.8pt; color:#5d6672; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
h2 { font-size:12.4pt; margin:26px 0 8px; padding-left:9px; border-left:4px solid #2f6df6; }
h3 { font-size:10.6pt; margin:16px 0 6px; color:#2b3038; }
p { margin:6px 0; }
table { width:100%; border-collapse:collapse; margin:8px 0 4px; font-size:8.5pt; }
th { background:#eef1f5; text-align:left; padding:5px 6px; border:1px solid #ccd2da; font-weight:600; }
td { padding:4px 6px; border:1px solid #dde2e8; vertical-align:top; }
tbody tr:nth-child(even) { background:#fafbfc; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:8pt; }
.url { word-break:break-all; }
.sha { font-size:7pt; word-break:break-all; color:#3c4450; }
.tiny { font-size:7.6pt; }
.c { text-align:center; }
pre { background:#f5f7fa; border:1px solid #dde2e8; border-left:3px solid #2f6df6;
  padding:9px 11px; font-size:7.9pt; line-height:1.5; overflow-wrap:anywhere; white-space:pre-wrap;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; margin:6px 0; }
.box { border:1px solid #d5dbe3; background:#f8fafc; padding:10px 13px; margin:10px 0; }
.box.warn { border-left:4px solid #d9821b; background:#fffaf2; }
.box.good { border-left:4px solid #1f9d55; background:#f4fbf7; }
.tag { display:inline-block; padding:1px 7px; border-radius:3px; font-size:7.6pt; font-weight:600; }
.tag.ok { background:#dff3e6; color:#14683a; }
.tag.bad { background:#fbe2e2; color:#8f1d1d; }
.tag.neu { background:#e8ecf2; color:#3c4450; }
.grid { display:flex; gap:10px; margin:12px 0; }
.card { flex:1; border:1px solid #d5dbe3; padding:10px 12px; }
.card .n { font-size:19pt; font-weight:700; letter-spacing:-.02em; }
.card .l { font-size:8.2pt; color:#5d6672; }
ol, ul { margin:6px 0 6px 18px; padding:0; }
li { margin:3px 0; }
hr { border:none; border-top:1px solid #e3e7ec; margin:18px 0; }
footer { margin-top:22px; border-top:1px solid #e3e7ec; padding-top:8px; font-size:8pt; color:#6b7280; }
.note { font-size:8.6pt; color:#5d6672; }
.code-inline { font-family:ui-monospace,Menlo,monospace; background:#eef1f5; padding:1px 4px; font-size:8.6pt; }
"""

HTML = f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>GitHub 数据真实性验证报告 · 代码考古学</title><style>{CSS}</style></head><body>

<header class="cover">
  <div class="kicker">Verification Report · Evidence Grounding</div>
  <h1>GitHub 仓库信息真实性验证报告</h1>
  <div class="sub">对象工具：<b>代码考古学 / Code Archaeology</b>（BAYTECH26 黑客松参赛项目）　
  验证对象：<b>chalk/chalk</b> 与 <b>ody-cai/oa-system</b> 两个公开仓库的分析结论</div>
  <div class="meta">
    生成时间（UTC）：{FACTS['generated_utc']}　·　签发人：蔡奇均 / Ody　·　联系：cqjody@126.com<br>
    验证方式：绕过项目自身接口，直接用 GitHub REST API v2022-11-28 独立取证，与工具输出逐条比对
  </div>
</header>

<h2>一、结论先行</h2>
<div class="grid">
  <div class="card"><div class="n">11/11</div><div class="l">API 取证请求全部返回 HTTP 200</div></div>
  <div class="card"><div class="n">10/10</div><div class="l">工具引用的提交 SHA 全部接地（0 编造）</div></div>
  <div class="card"><div class="n">10/10</div><div class="l">工具展示的元数据与 GitHub 原始值一致</div></div>
  <div class="card"><div class="n">1 处</div><div class="l">发现展示层歧义（非数据错误，见第五节）</div></div>
</div>

<p><b>总体判定：工具关于 GitHub 仓库的展示数据是真实有效的。</b>所有被引用的提交对象都在 GitHub 上真实存在，
星标、语言、分支、时间窗口等元数据与官方接口返回值逐项吻合，没有发现虚构、编造或张冠李戴的情况。</p>

<div class="box good">
<b>最重要的一条证据（可直接肉眼复核）</b><br>
工具曾把 chalk 的「<span class="code-inline">4c304dd</span> 新增扩展下划线 → <span class="code-inline">5729845</span>」判为「被放弃的尝试」。
本次独立取证证明这是<b>误判</b>：<span class="code-inline">5729845</span> 的直接父提交就是 <span class="code-inline">4c304dd</span>（真实 git 父子关系），
两者相隔仅 {gap_txt}；并且直到本次取证时刻，<span class="code-inline">source/index.js</span> 第 115 行仍完整保留该特性代码。
<b>工具当前版本已自行纠正为「0 处已核实 / 另否定 2 处」—— 与独立取证结论完全一致。</b>
</div>

<h2>二、验证方法</h2>
<p>为避免「用自己的接口验证自己的数据」这类自证循环，本次验证完全绕开项目的 API 与分析链路，采取三步独立取证：</p>
<ol>
  <li><b>原始层取证</b>：直接用 curl 调 <span class="code-inline">api.github.com</span>，把未经处理的 JSON 响应体逐份落盘，
      同时记录 HTTP 状态码、响应体 SHA-256、字节数与 UTC 时间戳。</li>
  <li><b>SHA 回归层</b>：把工具输出文本中出现的<b>每一个</b>短 SHA 单独回查 GitHub，以「HTTP 200 且返回完整 SHA 前缀匹配」为接地判定标准。</li>
  <li><b>内容层核验</b>：对涉及"代码是否真被删除"这类可证伪结论，直接拉取文件内容做行级比对，而非采信任何中间层的描述。</li>
</ol>
<p class="note">所用凭据为调用者本机 Keychain 中的 OAuth token，全程只读（未创建分支、未提交 PR、未写入任何远端），
token 未回显、未落盘于任何产物。</p>

<h2>三、取证清单（可在第三方机器上完全复现）</h2>
<table>
<thead><tr><th>编号</th><th>端点（省略 https://api.github.com）</th><th>状态</th><th>字节</th><th>响应体 SHA-256 前 32 位</th><th>采集时间(UTC)</th></tr></thead>
<tbody>{rows_manifest}</tbody>
</table>
<p class="note">原始响应文件存于 <span class="code-inline">raw/</span>，每个 JSON 附有同名 <span class="code-inline">.headers.txt</span> 保留原始响应头。
任何人可用下列命令重取并比对哈希：</p>
<pre>curl -sS -H "Authorization: Bearer &lt;只读 PAT&gt;" \\
     -H "Accept: application/vnd.github+json" \\
     -H "X-GitHub-Api-Version: 2022-11-28" \\
     https://api.github.com/repos/chalk/chalk/commits/5729845 \\
  | shasum -a 256</pre>

<h2>四、逐项核验结果</h2>

<h3>4.1 提交 SHA 接地核验（幻觉检测的核心）</h3>
<p>把工具输出文本中出现的全部 10 个提交引用逐一下去 GitHub 验证，不抽样、不挑选：</p>
<table>
<thead><tr><th>仓库</th><th>工具引用</th><th>HTTP</th><th>GitHub 返回的完整 SHA</th><th>前缀匹配</th><th>判定</th></tr></thead>
<tbody>{rows_probe}</tbody>
</table>
<p><b>接地率 10/10 = 100%，编造 0 个。</b>这直接支撑了项目「幻觉检测不靠模型自评、靠 SHA 集合运算」的设计主张 ——
至少在数据引用层，它确实没有凭空造出一个不存在的提交。</p>

<h3>4.2 仓库元数据比对（工具显示值 vs GitHub 原始值）</h3>
<table>
<thead><tr><th>仓库</th><th>字段</th><th>工具显示</th><th>GitHub 原始值</th><th>一致</th><th>取自</th></tr></thead>
<tbody>{rows_md}</tbody>
</table>

<h3>4.3 「父子链」核验 —— 一条能被独立推翻的强断言</h3>
<p>这是本次验证中信息量最大的一项：如果 <span class="code-inline">5729845</span> 的父提交不是 <span class="code-inline">4c304dd</span>，
那么工具的纠错就是自说自话。原始响应显示：</p>
<pre>4c304dd  message : {esc(B['commit_4c304dd']['message_head'])}
         author  : {esc(B['commit_4c304dd']['author_date'])}
         +{B['commit_4c304dd']['additions']} / -{B['commit_4c304dd']['deletions']}

5729845  message : {esc(B['commit_5729845']['message_head'])}
         author  : {esc(B['commit_5729845']['author_date'])}
         parents : {esc(str(B['commit_5729845']['parents']))}
         +{B['commit_5729845']['additions']} / -{B['commit_5729845']['deletions']}

=> 5729845 的直接父提交 == 4c304dd ：{B['computed']['is_direct_child']}
=> 两次提交相隔 ：{gap_txt}</pre>
<p><b>判定：真阳性 TIME-SERIES（父子成立）。</b>两个提交是同一次开发动作内的连续推进，
把它判成「写完又放弃」是错的；工具现版本已将其归类为「复核未通过」，逻辑正确。</p>

<h3>4.4 文件内容行级核验 —— 代码到底还在不在</h3>
<p>光看提交不够，代码可能后来又被删掉。直接拉 <span class="code-inline">main</span> 分支当前文件内容：</p>
<table>
<thead><tr><th>行号</th><th>内容</th></tr></thead>
<tbody>{matched_rows}</tbody>
</table>
<pre>文件        : source/index.js（chalk / main）
git blob SHA: {C['computed']['content_sha_git_blob']}
文件大小    : {C['computed']['file_size_bytes']} 字节 / {C['computed']['total_lines']} 行
解码后 SHA256: {C['computed']['sha256_decoded_file']}</pre>
<p><b>判定：第 115 行 <span class="code-inline">['underline' + capitalizedModel, 'underlineColor'],</span> 依然存在。</b>
该特性从未被移除 —— 从代码内容层面二次证实了 4.3 的结论。</p>

<h3>4.5 提交史与信噪比</h3>
<p>独立拉取 <span class="code-inline">ody-cai/oa-system</span> 最近 {n_files} 次提交（时间跨度
{D['computed']['range'][0][:10]} → {D['computed']['range'][1][:10]}）：</p>
<pre>样本提交数   : {n_files}
作者集合     : {esc(author_list)}
机器人类别数 : {bot_n}（占比 {D['computed']['bot_ratio']*100:.0f}%）
HEAD 提交    : {esc(D['computed']['head_commit']['sha'])} 「{esc(D['computed']['head_commit']['message'])}」</pre>
<p>作者名单中<b>没有任何 bot / dependabot / github-actions</b>，与工具给出的「机器人 0 次（0%）」方向一致。</p>

<h2>五、发现的一处展示层歧义（非数据错误）</h2>
<div class="box warn">
工具输出使用 <span class="code-inline">X → Y</span> 记号表示「某文件被连续改动」，但读取者极易理解成「Y 是 X 的子提交」。
逐条回查后发现，<b>四条箭头里只有一条是真父子关系</b>：
<table>
<thead><tr><th>仓库</th><th>文件</th><th>箭头</th><th>Y 的真实父提交</th><th>关系</th><th>说明</th></tr></thead>
<tbody>{rows_arrow}</tbody>
</table>
<b>这不构成数据错误</b> —— 箭头所指的提交都真实存在、改动确有其事、删增方向也对。
但它是一个<b>可被评委追问的措辞风险</b>：若路演时口头解释成「这个回滚紧接着那次提交」，
在有 git 父子概念的人面前会站不住。建议改成像 <span class="code-inline">4c304dd → 5729845（相邻两次改动）</span> 这样自解释的写法，
或在 UI 上点开箭头时显示真实 parent SHA。
</div>

<h2>六、如实说明：本次未能核实的部分</h2>
<p>出于严谨，以下项目<b>没有</b>被本次取证覆盖，不应被解读为"已验证"：</p>
<ul>
  <li><b>信噪比中「人类决策 19/30」的其余 11 次</b>：工具判定"人类决策"的内部口径未在输出中公开，
      无法从 API 原始数据复算。本次只独立证实了"bot 提交为 0"，未逐条复核另外 11 次的归类。</li>
  <li><b>churn 数值与「原地打转」阈值</b>：属于工具自定义聚合口径（如 README.md 的 1650x churn），
      GitHub 侧没有对应字段，无法交叉验证，只能确认它引用的文件真实存在。</li>
  <li><b>风险分加权公式</b>（chalk 55 / oa-system 51）：这是产品自身的评分模型，属于设计选择而非可核验事实。</li>
  <li><b>两次采样存在轻微抖动</b>：同一仓库在 limit=30 与默认 40 下，人类决策数分别为 26/30 与 33/40，
      文件热度排序也有小幅变化，属窗口效应。「0 处已核实 / 否定 2 处」这一核心判定在两次采样下稳定。</li>
  <li><b>时间基准</b>：文中时间为 GitHub 返回的 author 时间（UTC），可能与本地提交时间存在时区差异。</li>
</ul>

<h2>七、复现步骤</h2>
<pre># 1. 采集原始证据（token 建议用细粒度只读 PAT）
cd outputs/evidence-verification
export GITHUB_TOKEN=&lt;只读 PAT&gt;
zsh collect.sh &amp;&amp; zsh collect2.sh &amp;&amp; zsh probe_shas.sh

# 2. 单条核对哈希（应与第三节表格完全一致）
shasum -a 256 raw/chalk-commit-5729845.json

# 3. 浏览器肉眼复核（无需任何凭据）
open https://github.com/chalk/chalk/commit/5729845
open https://github.com/chalk/chalk/blob/main/source/index.js</pre>
<p class="note">第 3 步是给非技术评委的最低门槛验证路径：打开 commit 页即可看到 parent 行，
打开源文件按 Ctrl+G 跳到第 115 行即可看到那段代码。</p>

<hr>
<h2>附录 A · 工具原始输出（未删改，供比对）</h2>
<h3>A1 · chalk/chalk</h3>
<pre>{esc(TOOL_CHALK)}</pre>
<h3>A2 · ody-cai/oa-system</h3>
<pre>{esc(TOOL_OA)}</pre>

<footer>
本报告所有数据均来自 GitHub 官方 REST API 的实时响应，未使用任何模型生成内容填充。
报告本身可被第三方完整复现：按第七节命令重取数据，比对 SHA-256 即可。
</footer>

</body></html>
"""

OUT.write_text(HTML, encoding="utf-8")
print("written:", OUT, len(HTML), "bytes")
