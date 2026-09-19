// 代码考古学 · 历史挖掘引擎
// 纯计算层：只依赖 GitHub REST API，不依赖任何 LLM。
// 产出物是整个 demo 的「硬数字」来源 —— 每一条结论都必须能追溯到具体 commit SHA。
//
// 设计前提：考古学家不会把地层沉积物当成文物。
// 一个不剥离自动化噪音的工具，输出的全是依赖升级和锁文件 diff。
// 因此引擎的第一件事是「信噪分离」：机器人提交 + 生成/锁文件，先剔除，再考古。

import { ghFetch, pool, parseRepo } from './core/github.js';
import { isNoiseFile, isBotCommit } from './core/noise.js';
import { scoreMessage, isRevertMessage } from './core/message.js';
import { contentOverlap, classifyAbandonment, isGlobalRevert } from './core/overlap.js';

// 以模块身份再导出，让旧的引用路径继续可用
export { isNoiseFile, scoreMessage };

const pct = (sortedAsc, q) =>
  sortedAsc.length ? sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * q))] : 0;
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);


/**
 * 主入口：对一个仓库（或仓库内某个路径）做历史挖掘。
 *
 * @param {object} opts
 * @param {string} opts.repo      "owner/name"
 * @param {string} [opts.path]    限定到某个文件或目录
 * @param {number} [opts.limit]   分析最近多少个 commit
 * @param {string} [opts.token]   GitHub Token（可选，但强烈建议：60/h → 5000/h）
 * @param {Function} opts.fetchImpl
 * @param {Function} [opts.onProgress]
 */
export async function mine({ repo, path = '', limit = 60, token, fetchImpl = fetch, onProgress = () => {}, ref }) {
  const { owner, name } = parseRepo(repo);

  let apiCalls = 0;
  let rateRemaining = -1;
  const call = async (p) => {
    apiCalls++;
    const r = await ghFetch(p, { token, fetchImpl });
    rateRemaining = r.rateRemaining;
    return r.data;
  };

  // ── 1. 仓库元信息 ────────────────────────────────────────────────
  onProgress({ phase: 'meta', msg: '读取仓库元信息' });
  const meta = await call(`/repos/${owner}/${name}`);
  const branch = meta.default_branch;

  // ── 2. 提交列表 ──────────────────────────────────────────────────
  onProgress({ phase: 'commits', msg: `拉取最近 ${limit} 条提交` });
  const qs = new URLSearchParams({ sha: ref || branch, per_page: String(Math.min(limit, 100)) });
  if (path) qs.set('path', path);
  const commitList = await call(`/repos/${owner}/${name}/commits?${qs}`);
  if (!commitList.length) {
    throw new Error(path ? `路径 \`${path}\` 在该仓库最近历史中没有提交记录` : '该仓库没有任何提交记录');
  }

  // ── 3. 逐条拉取 diff 详情（并发 8） ─────────────────────────────
  onProgress({ phase: 'diffs', msg: '解析提交改动', total: commitList.length, done: 0 });
  let done = 0;
  const details = await pool(commitList, 8, async (c) => {
    try {
      const d = await call(`/repos/${owner}/${name}/commits/${c.sha}`);
      done++;
      if (done % 5 === 0 || done === commitList.length) {
        onProgress({ phase: 'diffs', msg: '解析提交改动', total: commitList.length, done });
      }
      return d;
    } catch (e) {
      done++; // 容错：单条失败不中断整次考古
      return { ...c, files: [], _failed: e.message };
    }
  });

  // ── 4. 归一化 + 信噪分类（时间序） ──────────────────────────────
  // patchIndex 只在内存里服务于「内容级核实」，不进入任何对外输出结构：
  // 我们只需要它回答一个问题 —— 拆除侧删掉的行，是不是当初新增的那些行。
  const patchIndex = new Map(); // `${shortSha}|${file}` -> patch
  const globalRevertShas = new Set(); // 整仓回滚的提交，不归因为文件级放弃

  const all = details
    .map((d) => {
      const rawMsg = d.commit?.message ?? '';
      const message = rawMsg.split('\n')[0].trim();
      const quality = scoreMessage(rawMsg);
      const short = (d.sha ?? '').slice(0, 7);

      const authorName = d.commit?.author?.name ?? d.author?.login ?? 'unknown';
      const authorEmail = d.commit?.author?.email ?? '';
      const isBot = isBotCommit({
        authorType: d.author?.type,
        committerType: d.committer?.type,
        authorName,
        authorEmail,
      });

      const files = (d.files ?? []).map((f) => ({
        name: f.filename,
        status: f.status,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        noise: isNoiseFile(f.filename),
      }));
      const signalFiles = files.filter((f) => !f.noise);

      for (const f of d.files ?? []) {
        if (f.patch) patchIndex.set(`${short}|${f.filename}`, f.patch);
      }
      if (isGlobalRevert(message)) globalRevertShas.add(short);

      return {
        sha: d.sha,
        short,
        date: d.commit?.author?.date ?? d.commit?.committer?.date ?? '',
        author: authorName,
        message,
        messageScore: quality.score,
        vague: quality.vague,
        vagueReason: quality.reason,
        isRevert: isRevertMessage(message),
        isMerge: (d.parents?.length ?? 0) > 1,
        isBot,
        additions: files.reduce((s, f) => s + f.additions, 0),
        deletions: files.reduce((s, f) => s + f.deletions, 0),
        files,
        signalFiles,
        // 有效考古线索 = 人类提交 且 至少改到一个非生成物文件
        isSignal: !isBot && signalFiles.length > 0,
        failed: d._failed ?? null,
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((c) => ({ ...c, churn: c.additions + c.deletions }));

  // 下游所有指标只建立在「人类 + 非生成物」之上
  const chrono = all.filter((c) => c.isSignal);
  const bots = all.filter((c) => c.isBot);
  const noiseOnly = all.filter((c) => !c.isBot && !c.isSignal);

  // ── 5. 信噪比（这是报告的第一个核心数字） ───────────────────────
  const allFileTouches = new Map();
  for (const c of all) {
    for (const f of c.files) allFileTouches.set(f.name, (allFileTouches.get(f.name) ?? 0) + 1);
  }
  const botAuthors = new Map();
  for (const c of bots) botAuthors.set(c.author, (botAuthors.get(c.author) ?? 0) + 1);

  const signalQuality = {
    analyzed: all.length,
    totalCommits: meta ? all.length : 0,
    botCommits: bots.length,
    botRate: all.length ? Math.round((bots.length / all.length) * 100) : 0,
    noiseOnlyCommits: noiseOnly.length,
    signalCommits: chrono.length,
    signalRate: all.length ? Math.round((chrono.length / all.length) * 100) : 0,
    botAuthors: [...botAuthors.entries()]
      .map(([author, commits]) => ({ author, commits }))
      .sort((a, b) => b.commits - a.commits),
    noisiestFiles: [...allFileTouches.entries()]
      .map(([file, touches]) => ({ file, touches, noise: isNoiseFile(file) }))
      .sort((a, b) => b.touches - a.touches)
      .slice(0, 8),
  };

  if (!chrono.length) {
    throw new Error(
      `该仓库最近 ${all.length} 次提交全部来自机器人或仅改动生成物，没有可供考古的人类决策痕迹。请换一个仓库，或指定 \`path\` 缩小范围。`
    );
  }

  // ── 6. 文件级统计（仅人类信号） ─────────────────────────────────
  onProgress({ phase: 'compute', msg: '重建文件变更史' });
  const fileMap = new Map();
  for (const c of chrono) {
    for (const f of c.signalFiles) {
      let rec = fileMap.get(f.name);
      if (!rec) {
        rec = {
          file: f.name,
          touches: 0,
          additions: 0,
          deletions: 0,
          authors: new Set(),
          firstSeen: c.date,
          lastSeen: c.date,
          sequence: [],
        };
        fileMap.set(f.name, rec);
      }
      rec.touches++;
      rec.additions += f.additions;
      rec.deletions += f.deletions;
      rec.authors.add(c.author);
      rec.lastSeen = c.date;
      rec.sequence.push({
        sha: c.short,
        date: c.date,
        message: c.message,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      });
    }
  }

  const files = [...fileMap.values()].map((r) => ({
    file: r.file,
    touches: r.touches,
    additions: r.additions,
    deletions: r.deletions,
    churn: r.additions + r.deletions,
    net: r.additions - r.deletions,
    authors: [...r.authors],
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    sequence: r.sequence,
  }));

  // ── 7. 被放弃的尝试：先进后出，且内容确实被拆掉 ─────────────────
  // 三级判据，缺一不可：
  //   a) 行数门槛：某次提交净增 ≥ 阈值，随后 ≤45 天内又有一次净删 ≥ 阈值 60%
  //   b) 内容核实：拆除侧删掉的行，确实包含当初新增的那些行（见 core/overlap.js）
  //   c) 排除整仓回滚：`Restored to '<sha>'` 是全局操作，连带删除不等于放弃
  // b 和 c 是 2026-09-19 逐条核对 GitHub 后补上的 —— 此前只按行数判定，
  // chalk 的一次性能重写被判成「下划线样式被放弃」，而该功能至今仍在 main 分支上。
  const allAdds = files.flatMap((f) => f.sequence.map((s) => s.additions)).sort((a, b) => a - b);
  const addThreshold = Math.max(15, pct(allAdds, 0.7));

  const abandoned = [];
  const rejected = []; // 行数达标但内容核实未通过 —— 假阳性，单列出来接受审视而不是藏起来
  const globalReverts = []; // 被整仓回滚连带删除，原因与「放弃方案」不同

  for (const f of files) {
    for (let i = 0; i < f.sequence.length; i++) {
      const a = f.sequence[i];
      if (a.additions < addThreshold) continue;
      for (let j = i + 1; j < f.sequence.length; j++) {
        const b = f.sequence[j];
        const gap = days(a.date, b.date);
        if (gap > 45) break;
        if (!(b.deletions >= addThreshold * 0.6 && b.deletions >= a.additions * 0.5)) continue;

        const base = {
          file: f.file,
          addSha: a.sha,
          addDate: a.date,
          addMessage: a.message,
          addLines: a.additions,
          removeSha: b.sha,
          removeDate: b.date,
          removeMessage: b.message,
          removeLines: b.deletions,
          survivedDays: gap,
        };

        // c) 整仓回滚 —— 它删的东西是全局性的，不能归因给单个文件
        if (globalRevertShas.has(b.sha)) {
          globalReverts.push(base);
          i = j;
          break;
        }

        // b) 内容核实：删掉的是不是当初加的那些行
        const ov = contentOverlap(
          patchIndex.get(`${a.sha}|${f.file}`),
          patchIndex.get(`${b.sha}|${f.file}`)
        );
        const verdict = classifyAbandonment(ov.verifiable ? ov.rate : null);
        const record = {
          ...base,
          overlapRate: ov.rate,
          overlappedLines: ov.hits,
          comparableLines: ov.comparable,
          verified: ov.verifiable,
          verifyNote: verdict.note,
        };

        if (verdict.abandoned) {
          abandoned.push(record);
          i = j;
          break;
        }
        // 内容对不上：两次改动碰的不是同一段代码，继续往后找真正的拆除
        rejected.push(record);
      }
    }
  }
  abandoned.sort((x, y) => x.survivedDays - y.survivedDays);

  // ── 8. 原地打转：改了很多次，净变化却很小 ───────────────────────
  const thrash = files
    .filter((f) => f.touches >= 3 && f.churn >= 40 && Math.abs(f.net) <= f.churn * 0.3)
    .map((f) => ({
      file: f.file,
      touches: f.touches,
      churn: f.churn,
      net: f.net,
      spinRatio: Math.abs(f.net) < 1 ? f.churn : Math.round(f.churn / Math.abs(f.net)),
      authors: f.authors,
      lastSeen: f.lastSeen,
    }))
    .sort((a, b) => b.spinRatio - a.spinRatio);

  // ── 9. 提交卫生（仅人类提交 —— 拿机器人的规范信息来夸项目没意义） ──
  const nonMerge = chrono.filter((c) => !c.isMerge);
  const vagueCommits = nonMerge.filter((c) => c.vague);
  const revertCommits = chrono.filter((c) => c.isRevert);
  const avgMsgLen = nonMerge.length
    ? Math.round(nonMerge.reduce((s, c) => s + c.message.length, 0) / nonMerge.length)
    : 0;
  const hygiene = {
    total: chrono.length,
    nonMerge: nonMerge.length,
    merges: chrono.length - nonMerge.length,
    vagueCount: vagueCommits.length,
    vagueRate: nonMerge.length ? Math.round((vagueCommits.length / nonMerge.length) * 100) : 0,
    revertCount: revertCommits.length,
    avgMsgLen,
    vagueSamples: vagueCommits.slice(0, 8).map((c) => ({ sha: c.short, message: c.message, date: c.date })),
    reverts: revertCommits.map((c) => ({ sha: c.short, message: c.message, date: c.date })),
  };

  // ── 10. 提交节奏：冲刺与沉寂 ────────────────────────────────────
  const weekMap = new Map();
  for (const c of chrono) {
    const d = new Date(c.date);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weekMap.has(key)) weekMap.set(key, { week: key, commits: 0, churn: 0 });
    const w = weekMap.get(key);
    w.commits++;
    w.churn += c.churn;
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week));

  let longestGap = { days: 0, from: '', to: '' };
  for (let i = 1; i < chrono.length; i++) {
    const g = days(chrono[i - 1].date, chrono[i].date);
    if (g > longestGap.days) longestGap = { days: g, from: chrono[i - 1].date, to: chrono[i].date };
  }
  // 沉寂期之后往往是一次转向 —— 叙事上最有价值的位置
  const afterGap = longestGap.to ? (chrono.find((c) => c.date === longestGap.to) ?? null) : null;

  const rhythm = {
    weeks,
    longestGap,
    afterGapCommit: afterGap ? { sha: afterGap.short, message: afterGap.message, date: afterGap.date } : null,
    activeDays: new Set(chrono.map((c) => c.date.slice(0, 10))).size,
    spanDays: chrono.length > 1 ? days(chrono[0].date, chrono[chrono.length - 1].date) : 0,
  };

  // ── 11. 作者分布 ────────────────────────────────────────────────
  const authorMap = new Map();
  for (const c of chrono) {
    if (!authorMap.has(c.author)) authorMap.set(c.author, { author: c.author, commits: 0, churn: 0, files: new Set() });
    const a = authorMap.get(c.author);
    a.commits++;
    a.churn += c.churn;
    for (const f of c.signalFiles) a.files.add(f.name);
  }
  const authors = [...authorMap.values()]
    .map((a) => ({ author: a.author, commits: a.commits, churn: a.churn, fileCount: a.files.size }))
    .sort((a, b) => b.commits - a.commits);

  // 巴士因子：只改过某文件的作者数 -- 为 1 说明该文件只有一个人懂
  const soloOwned = files
    .filter((f) => f.authors.length === 1 && f.touches >= 2)
    .map((f) => ({ file: f.file, owner: f.authors[0], touches: f.touches, churn: f.churn }))
    .sort((a, b) => b.churn - a.churn);

  // ── 12. 风险评分 ────────────────────────────────────────────────
  const factorDefs = [
    {
      key: 'vague',
      label: '提交信息质量',
      raw: `${hygiene.vagueCount} / ${hygiene.nonMerge} 条无信息量`,
      score: Math.min(1, hygiene.vagueRate / 20) * 25,
      weight: 25,
      detail: '含糊的提交信息让后来者无法还原改动意图',
    },
    {
      key: 'thrash',
      label: '原地打转的文件',
      raw: `${thrash.length} 个文件反复推翻`,
      score: Math.min(1, thrash.length / 5) * 25,
      weight: 25,
      detail: '改动总量很大但净变化很小，说明方案被反复推翻',
    },
    {
      key: 'abandoned',
      label: '被放弃的尝试',
      raw: `${abandoned.length} 处已核实（另否定 ${rejected.length} 处）`,
      score: Math.min(1, abandoned.length / 5) * 20,
      weight: 20,
      detail: '短期加入又短期拆除，且拆除内容与当初新增内容重合 —— 确属方向摇摆',
    },
    {
      key: 'revert',
      label: '显式回滚',
      raw: `${hygiene.revertCount} 次回滚提交`,
      score: Math.min(1, hygiene.revertCount / 3) * 15,
      weight: 15,
      detail: '明确的回滚是决策失败的直接证据',
    },
    {
      key: 'gap',
      label: '最长沉寂期',
      raw: `${longestGap.days} 天无人提交`,
      score: Math.min(1, longestGap.days / 120) * 15,
      weight: 15,
      detail: '长期停摆后重启，往往伴随架构转向',
    },
  ];
  const riskScore = Math.round(Math.min(100, factorDefs.reduce((s, f) => s + f.score, 0)));

  onProgress({ phase: 'done', msg: '挖掘完成' });

  return {
    repo: {
      owner,
      name,
      full: `${owner}/${name}`,
      url: meta.html_url,
      description: meta.description,
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      openIssues: meta.open_issues_count,
      language: meta.language,
      license: meta.license?.spdx_id ?? null,
      createdAt: meta.created_at,
      pushedAt: meta.pushed_at,
      branch,
      sizeKb: meta.size,
      archived: meta.archived,
    },
    scope: {
      path: path || null,
      limit,
      windowFrom: all[0]?.date ?? null,
      windowTo: all.at(-1)?.date ?? null,
      signalWindowFrom: chrono[0]?.date ?? null,
      signalWindowTo: chrono.at(-1)?.date ?? null,
    },
    signalQuality,
    // 时间轴保留全部提交，前端把机器人/噪音灰显 —— 一眼看懂真实决策密度
    timeline: all.map((c) => ({
      sha: c.short,
      date: c.date,
      author: c.author,
      message: c.message,
      messageScore: c.messageScore,
      vague: c.vague,
      isRevert: c.isRevert,
      isMerge: c.isMerge,
      isBot: c.isBot,
      isSignal: c.isSignal,
      additions: c.additions,
      deletions: c.deletions,
      churn: c.churn, // 前端用柱高表示改动量，缺这个字段柱子会全是 NaN
      files: c.files.length,
      failed: c.failed,
    })),
    hotspots: files
      .slice()
      .sort((a, b) => b.churn - a.churn)
      .slice(0, 12)
      .map((f) => ({
        file: f.file,
        touches: f.touches,
        additions: f.additions,
        deletions: f.deletions,
        churn: f.churn,
        net: f.net,
        authors: f.authors,
        firstSeen: f.firstSeen,
        lastSeen: f.lastSeen,
        sequence: f.sequence.slice(-8),
      })),
    abandoned: abandoned.slice(0, 10),
    // 这两个是「被放弃的尝试」判定的副产品，一并交付：
    // rejected 是我们的假阳性，globalReverts 是原因不同的连带删除。
    // 把它们藏起来会让报告显得干净，但会让结论失去可复核性。
    abandonedRejected: rejected.slice(0, 10),
    globalReverts: globalReverts.slice(0, 10),
    thrash: thrash.slice(0, 10),
    soloOwned: soloOwned.slice(0, 10),
    authors,
    hygiene,
    rhythm,
    risk: {
      score: riskScore,
      level: riskScore >= 60 ? '高' : riskScore >= 35 ? '中' : '低',
      factors: factorDefs.map(({ key, label, raw, score, weight, detail }) => ({
        key,
        label,
        raw,
        detail,
        score: Math.round(score),
        weight,
      })),
    },
    cost: { apiCalls, rateRemaining, token: Boolean(token), fetchedAt: new Date().toISOString() },
    // 给 LLM 的高密度上下文：只保留最有考古价值的证据切片，避免 token 爆炸
    digSite: buildDigSite({ meta, chrono, files, abandoned, thrash, hygiene, rhythm, signalQuality }),
  };
}

/**
 * 构造给 LLM 的「发掘现场」——不把原始 diff 全丢过去，而是挑出最能解释
 * 「为什么长这样」的证据切片，并强制每条都带 SHA，便于前端做证据回溯。
 */
function buildDigSite({ meta, chrono, files, abandoned, thrash, hygiene, rhythm, signalQuality }) {
  const fileSeq = (f) => ({
    file: f.file,
    touches: f.touches,
    churn: f.churn,
    changes: f.sequence.slice(-14).map((s) => ({
      sha: s.sha,
      date: s.date.slice(0, 10),
      msg: s.message.slice(0, 110),
      add: s.additions,
      del: s.deletions,
      status: s.status,
    })),
  });

  return {
    repo: `${meta.full_name} · ${meta.language ?? '未知语言'} · ${meta.stargazers_count} stars · 创建于 ${meta.created_at?.slice(0, 10)}`,
    signalNote: `共分析 ${signalQuality.analyzed} 次提交，其中 ${signalQuality.botCommits} 次来自机器人（${signalQuality.botRate}%），仅 ${signalQuality.signalCommits} 次包含人类决策痕迹`,
    window: `${chrono[0]?.date.slice(0, 10)} → ${chrono.at(-1)?.date.slice(0, 10)}，有效人类提交 ${chrono.length} 次`,
    topFiles: files
      .slice()
      .sort((a, b) => b.churn - a.churn)
      .slice(0, 6)
      .map(fileSeq),
    thrash: thrash.slice(0, 5).map((t) => ({
      file: t.file,
      touches: t.touches,
      totalChurn: t.churn,
      netChange: t.net,
      spinRatio: t.spinRatio,
    })),
    abandoned: abandoned.slice(0, 6).map((a) => ({
      file: a.file,
      added: { sha: a.addSha, date: a.addDate.slice(0, 10), lines: a.addLines, msg: a.addMessage.slice(0, 110) },
      removed: { sha: a.removeSha, date: a.removeDate.slice(0, 10), lines: a.removeLines, msg: a.removeMessage.slice(0, 110) },
      survivedDays: a.survivedDays,
    })),
    vagueSamples: hygiene.vagueSamples.map((v) => `${v.sha} ${v.date.slice(0, 10)} "${v.message}"`),
    reverts: hygiene.reverts.map((v) => `${v.sha} ${v.date.slice(0, 10)} "${v.message}"`),
    longestGap: rhythm.longestGap,
    afterGap: rhythm.afterGapCommit,
  };
}
