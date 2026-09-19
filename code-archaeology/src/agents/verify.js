// 证据接地校验 —— 这套系统里我认为最关键的一个设计。
//
// 常见做法是「让另一个模型来检查前一个模型有没有胡说」。
// 但这不可靠：判官本身也会幻觉，而且它无法查证。
//
// 这里的做法是：不靠模型，靠代码。
// 模型产出的每一条结论都必须引用具体的 commit SHA，而这些 SHA 是
// 我们从 GitHub 真实拉回来的。于是「引用了一个不存在的 SHA」这件事
// 可以被一次集合运算直接判定 —— 这是可证明的幻觉，不是主观判断。

/** 从完整报告里收集所有真实存在的短 SHA，构成证据索引 */
export function buildEvidenceIndex(report) {
  const index = new Set();
  const add = (sha) => {
    if (sha && typeof sha === 'string') index.add(sha.trim().toLowerCase());
  };

  for (const c of report.timeline ?? []) add(c.sha);
  for (const a of report.abandoned ?? []) {
    add(a.addSha);
    add(a.removeSha);
  }
  for (const h of report.hotspots ?? []) {
    for (const s of h.sequence ?? []) add(s.sha);
  }
  for (const v of report.hygiene?.vagueSamples ?? []) add(v.sha);
  for (const v of report.hygiene?.reverts ?? []) add(v.sha);

  return index;
}

/** 模型引用 SHA 时常写成 7 位、8 位或带省略号，统一收敛后再比对 */
function normalize(sha) {
  return String(sha ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
}

/**
 * 校验一组结论的证据接地情况。
 *
 * @param {Array<object>} items    模型产出的结论，每项应含 evidence: string[]
 * @param {Set<string>}   index    buildEvidenceIndex 产出的真实 SHA 集合
 * @returns {{items: Array, summary: object}}
 */
export function auditEvidence(items, index) {
  let totalCited = 0;
  let totalValid = 0;
  const offenders = [];

  const audited = (items ?? []).map((item, i) => {
    const cited = Array.isArray(item.evidence)
      ? item.evidence
      : typeof item.evidence === 'string'
        ? [item.evidence]
        : [];

    const valid = [];
    const invalid = [];

    for (const raw of cited) {
      const n = normalize(raw);
      if (!n) continue;
      totalCited++;
      // 真实 SHA 的前缀匹配即可承认：模型常只写 7 位短 SHA
      const hit = [...index].some((real) => real.startsWith(n) || n.startsWith(real));
      if (hit) {
        valid.push(raw);
        totalValid++;
      } else {
        invalid.push(raw);
      }
    }

    const grounded = cited.length > 0 && invalid.length === 0;
    if (invalid.length) {
      offenders.push({ index: i, title: item.title ?? item.file ?? item.claim ?? `第 ${i + 1} 条`, invalid });
    }

    return {
      ...item,
      evidenceAudit: {
        cited: cited.length,
        valid: valid.length,
        invalid,
        // 无证据 = 未接地；有无效证据 = 编造
        status: cited.length === 0 ? 'ungrounded' : invalid.length ? 'fabricated' : 'grounded',
        grounded,
      },
    };
  });

  return {
    items: audited,
    summary: {
      claims: audited.length,
      grounded: audited.filter((a) => a.evidenceAudit.status === 'grounded').length,
      ungrounded: audited.filter((a) => a.evidenceAudit.status === 'ungrounded').length,
      fabricated: audited.filter((a) => a.evidenceAudit.status === 'fabricated').length,
      citations: totalCited,
      validCitations: totalValid,
      invalidCitations: totalCited - totalValid,
      // 接地率：结论中证据完全成立的占比。这是报告可信度的直接度量。
      groundingRate: audited.length ? Math.round((audited.filter((a) => a.evidenceAudit.grounded).length / audited.length) * 100) : 0,
      offenders,
    },
  };
}
