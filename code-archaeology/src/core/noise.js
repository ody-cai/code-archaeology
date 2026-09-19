// 信噪分类 —— 考古学的地层筛选。
// 独立模块：判定「哪些提交/文件的变化不承载人类决策」。
// 规则可被单独测试、单独扩展，也可被其他分析工具复用。

/** 机器人识别：GitHub 会把 App 提交标记为 Bot，但大量自建 bot 只有名字线索 */
export const BOT_RE =
  /(\[bot\]$|-bot$|-bot@|^bot-|dependabot|renovate|greenkeeper|snyk-bot|github-actions|actions-user|pre-commit-ci|semantic-release|allcontributors|imgbot|codecov|mergify|stale|bors|homu|auto-format|l10n|transifex|weblate|poeditor|crowdin)/i;

/** 生成物 / 锁文件 / 二进制：这些文件的变化不承载人类决策 */
export const NOISE_PATTERNS = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Gemfile\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|gradle\.lockfile|packages\.lock\.json|mix\.lock|pubspec\.lock)$/i,
  /\.(min\.js|min\.css|map|snap|lock|sum)$/i,
  // 变更日志/贡献者名单类：由脚本或流程生成。用包含匹配，
  // 否则 PRE_RELEASE_CHANGELOG.md 这类变体会漏网。
  /(^|[\/_.-])(changelog|history|changes|release[-_]?notes|authors|contributors|notice|copying|third[-_]?party[-_]?licen[cs]es?)([\/_.-]|$)/i,
  /(^|\/)(dist|build|out|coverage|node_modules|vendor|third_party|__snapshots__|\.next|\.nuxt|target)\//i,
  // 数据/夹具/示例数据：内容由业务或抓取产生，不是人写出来的逻辑
  /(^|\/)docs?\/data\//i,
  /(^|\/)(fixtures|seeds?|snapshots?)\//i,
  // 代码生成产物
  /\.(pb\.go|g\.dart|generated\.[a-z]+|designer\.cs|assemblyinfo\.cs)$/i,
  /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|eot|pdf|zip|tar|gz|tgz|mp4|mov|psd|sketch|bin|exe|dll|so|dylib)$/i,
];

/** 该文件的变化是否属于「沉积物」而非「文物」 */
export const isNoiseFile = (name) => NOISE_PATTERNS.some((re) => re.test(name));

/** 该提交是否由机器人产生 */
export function isBotCommit({ authorType, committerType, authorName = '', authorEmail = '' } = {}) {
  if (authorType === 'Bot' || committerType === 'Bot') return true;
  return BOT_RE.test(authorName) || BOT_RE.test(authorEmail);
}

/**
 * 把一批 commit 文件列表拆成「噪音」与「信号」两组。
 * 这是整个引擎的第一道工序：先筛地层，再挖文物。
 */
export function splitSignals(files = []) {
  const signalFiles = files.filter((f) => !isNoiseFile(f.filename));
  return { signalFiles, noisFileCount: files.length - signalFiles.length };
}
