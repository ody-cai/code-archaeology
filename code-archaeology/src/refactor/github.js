// GitHub 写入适配器 —— 安全重构专用。
//
// 设计原则（来自安全重构契约）：
//   - 仅使用调用者显式传入的 token；绝不读取 env / Keychain / 站点凭据。
//   - 固定 origin 为 https://api.github.com；路径由本模块构造，redirect 一律报错。
//   - 所有网络错误翻译为静态中文错误，绝不原样复述上游 message。
//   - 任何不确定的超时都会保留已创建的草稿分支“锁”，绝不自动重试写入。
//   - 写入只产生独立的功能分支 + 草稿 PR；绝不触碰默认分支、绝不 merge。
//
// 暴露：createGitHub({ token, fetchImpl, timeoutMs }) -> {
//   request(path, options), resolveBase(repo), identity(),
//   readSource(repo, baseSha, file), createDraft(ticket),
// }

import { RefactorError, fail, safeRepo, safePath, sha256, encoder, bounded, assertNoSecrets } from './safety.js';

export const API_BASE = 'https://api.github.com';
const HEX40 = /^[a-f0-9]{40}$/;
const DEFAULT_TIMEOUT_MS = 15000;

export function createGitHub({ token, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') fail('bad_config', 'fetchImpl 必须为可调用函数。', 500);
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  // ── 底层请求：固定 origin、redirect:error、静态错误、超时覆盖 ──
  async function request(path, options = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
        /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
      fail('unsafe_path', 'GitHub 请求路径非法（不允许绝对 URL 或协议前缀）。');
    }
    const url = API_BASE + path;
    if (/[\\\s#]/.test(path) || new URL(url).origin !== API_BASE || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path.split('?')[0])) fail('unsafe_path', 'GitHub 请求路径非法。');
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET' && !token) fail('caller_auth_required', '写入需要调用者 Token。', 401);
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'code-archaeology/0.1',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const init = { method, headers, redirect: 'error' };
    if (options.body !== undefined) {
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    // 覆盖 fetch 和响应体解析；即使传输忽略 AbortSignal 也按时返回。
    return bounded(async (signal) => {
      let res;
      try { res = await fetchImpl(url, { ...init, signal }); }
      catch (e) { throw translateFetchError(e); }
      if (!res.ok) throw translateStatus(res.status);
      try { return await res.json(); }
      catch { fail('bad_upstream', 'GitHub 响应不是有效 JSON。', 502); }
    }, effectiveTimeout, 'upstream_timeout');
  }

  // ── 基础提交解析：真实元数据校验规范名、push 权限、40hex HEAD ──
  async function resolveBase(repo) {
    const r = safeRepo(repo);
    const data = await request(`/repos/${r}`);
    // 校验规范名，避免跟随仓库更名跳转（rename 会被 redirect:error 拦截，这里双保险）。
    if (!data || typeof data.full_name !== 'string' || data.full_name.toLowerCase() !== r) {
      fail('repo_mismatch', '仓库规范名与请求不一致（可能为更名跳转），已拒绝。', 421);
    }
    const baseBranch = data.default_branch;
    if (typeof baseBranch !== 'string' || baseBranch.length === 0) {
      fail('bad_repo', '仓库未返回默认分支。', 422);
    }
    const ref = await request(`/repos/${r}/git/refs/heads/${encodeURIComponent(baseBranch)}`);
    const baseSha = ref?.object?.sha;
    if (typeof baseSha !== 'string' || !HEX40.test(baseSha)) {
      fail('bad_repo', '默认分支 HEAD 不是合法的 40 位提交 SHA。', 422);
    }
    // permissions 仅在鉴权后返回；push 必须严格为 true。
    const canPush = Boolean(data.permissions && data.permissions.push === true);
    return { baseSha, baseBranch, canPush };
  }

  // ── 调用者身份：仅在有 token 时可用 ──
  async function identity() {
    if (!token) fail('caller_auth_required', '获取 GitHub 身份需要调用者 Token。', 401);
    const data = await request('/user');
    if (!data || !Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.login !== 'string' || !data.login) {
      fail('bad_identity', 'GitHub 身份响应非法。', 422);
    }
    return { id: data.id, login: data.login };
  }

  // ── 读取源码：Git Trees 逐级下降，拒绝 symlink 祖先 / gitlink，仅 blob ──
  async function readSource(repo, baseSha, file) {
    const r = safeRepo(repo);
    safePath(file);
    if (typeof baseSha !== 'string' || !HEX40.test(baseSha)) fail('bad_base', '基础提交 SHA 非法。', 422);

    const commit = await request(`/repos/${r}/git/commits/${baseSha}`);
    let treeSha = commit?.tree?.sha;
    if (typeof treeSha !== 'string' || !HEX40.test(treeSha)) fail('bad_base', '提交未返回合法根树 SHA。', 422);

    const segments = file.split('/');
    for (let i = 0; i < segments.length; i++) {
      const entryName = segments[i];
      const tree = await request(`/repos/${r}/git/trees/${treeSha}`);
      if (tree?.truncated || !Array.isArray(tree?.tree)) fail('bad_upstream', '源码树不完整，拒绝生成补丁。', 422);
      const entry = tree.tree.find((e) => e.path === entryName);
      if (!entry) fail('file_not_found', '固定提交中不存在候选文件。', 404);
      if (!HEX40.test(entry.sha || '')) fail('bad_upstream', '源码树条目 SHA 非法。', 422);

      // 任何祖先段若指向 gitlink / symlink，立即拒绝（不跟随）。
      if (entry.mode === '160000' || entry.type === 'commit') {
        fail('unsafe_path', '路径含子树模块（gitlink），已拒绝。', 422);
      }
      if (entry.mode === '120000') {
        fail('unsafe_path', '路径含符号链接，已拒绝跟随。', 422);
      }

      if (i === segments.length - 1) {
        if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
          fail('unsafe_path', '目标不是常规源码 blob（仅允许 100644 / 100755）。', 422);
        }
        return fetchBlob(r, entry.sha, entry.mode);
      }
      if (entry.type !== 'tree' || entry.mode !== '040000') {
        fail('unsafe_path', '路径中间段不是目录。', 422);
      }
      treeSha = entry.sha;
    }
    fail('file_not_found', `路径不存在：${file}`, 404);
  }

  async function fetchBlob(repo, blobSha, mode) {
    const data = await request(`/repos/${repo}/git/blobs/${blobSha}`);
    if (typeof data.sha === 'string' && data.sha !== blobSha) {
      fail('blob_mismatch', 'Blob SHA 与服务端返回不一致。', 422);
    }
    if (data.encoding !== 'base64') fail('blob_unsupported', '不支持的 Blob 编码。', 422);
    let bytes;
    try {
      bytes = Uint8Array.from(atob(String(data.content).replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    } catch {
      fail('blob_unsupported', 'Blob 内容解码失败。', 422);
    }
    // 校验 git blob SHA（SHA-1("blob <size>\0" + bytes)），拒绝截断 / 篡改。
    const expect = await gitBlobSha(bytes);
    if (expect !== blobSha) fail('blob_mismatch', 'Blob 内容校验失败（可能已被截断或篡改）。', 422);
    if (bytes.length > 64000) fail('source_too_large', '源码超过 64KB 上限。', 422);

    let source;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('binary_source', '源码不是合法的 UTF-8 文本（疑似二进制），已拒绝。', 422);
    }
    if (source.includes('\r') || source.includes('\0')) {
      fail('unsafe_source', '源码含回车或 NUL，仅支持 LF 文本。', 422);
    }
    if (!source.endsWith('\n')) fail('unsafe_source', '源码必须以换行结尾。', 422);
    return { source, blobSha, mode };
  }

  // ── 写前 / PR 前基础校验 ──
  async function verifyBase(repo, expectedSha, expectedBranch) {
    const base = await resolveBase(repo);
    if (base.baseSha !== expectedSha || base.baseBranch !== expectedBranch) {
      // 说明默认分支 HEAD 已变化；GitHub 跨请求无法原子锁定默认分支，
      // 因此这里主动阻断写入以避免在不一致基础上产生草稿。
      fail('stale_base', '默认分支基础提交已变化，已停止写入以避免冲突。', 409);
    }
    if (!base.canPush) fail('write_forbidden', '调用者对目标仓库没有写权限。', 403);
  }

  // ── 创建草稿 PR：单文件新 tree/commit，独立功能分支，确定性去重 ref ──
  async function createDraft(ticket) {
    if (!token) fail('caller_auth_required', '创建草稿 PR 必须使用调用者 GitHub Token，绝不借用站点 Token。', 401);
    const { repo, file, baseSha, baseBranch, mode, digest, source } = ticket;
    const r = safeRepo(repo);
    safePath(file);
    if (typeof baseSha !== 'string' || !HEX40.test(baseSha)) fail('bad_base', '票据基础提交 SHA 非法。', 422);
    if (typeof baseBranch !== 'string' || baseBranch.length === 0) fail('bad_ticket', '票据缺少基础分支。', 422);
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) fail('bad_ticket', '票据摘要非法。', 422);
    if (typeof source !== 'string' || encoder.encode(source).length > 64000 || !source.endsWith('\n') || /[\r\0]/.test(source)) fail('bad_ticket', '票据源码非法或超限。', 422);
    assertNoSecrets(source, [token]);
    if (mode !== '100644' && mode !== '100755') fail('bad_ticket', '票据 mode 非法。', 422);

    // 写前检查 base 与权限。
    await verifyBase(r, baseSha, baseBranch);

    // 确定性 ref 名：绑定 repo/base/file/digest，作为分布式去重原子 claim。
    const refHex = await sha256(`${r}\0${baseSha}\0${file}\0${digest}`);
    const refName = `refs/heads/refactor/${refHex}`;
    const branch = `refactor/${refHex}`;

    // 原子 claim：先创建一个指向 baseSha 的独立分支。已存在则视为重复，不更新旧 ref。
    try {
      await request(`/repos/${r}/git/refs`, { method: 'POST', body: { ref: refName, sha: baseSha } });
    } catch (e) {
      if (e instanceof RefactorError && e.code === 'unprocessable') {
        // 区分“重复 claim”与“base 已失效导致 sha 无效”。
        try {
          await request(`/repos/${r}/git/refs/heads/${branch}`);
          throw new RefactorError('duplicate_operation', '该重构已存在草稿分支（分布式去重），未重复写入。', 409);
        } catch (e2) {
          if (e2 instanceof RefactorError && e2.code === 'duplicate_operation') throw e2;
          throw new RefactorError('stale_base', '基础提交已不存在，已停止写入。', 409);
        }
      }
      throw e;
    }
    // 注意：至此分支锁已建立。后续任何不确定超时都保留此锁，绝不自动重试。

    // 新 blob（不伪造 author/date：提交时不传 author/committer）。
    const blob = await request(`/repos/${r}/git/blobs`, { method: 'POST', body: { content: source, encoding: 'utf-8' } });
    const newBlobSha = blob?.sha;
    if (typeof newBlobSha !== 'string' || !HEX40.test(newBlobSha)) fail('bad_upstream', 'Blob 创建未返回合法 SHA。', 502);

    // 根树（用于 base_tree，避免重建整棵树）。
    const baseCommit = await request(`/repos/${r}/git/commits/${baseSha}`);
    const rootTree = baseCommit?.tree?.sha;
    if (typeof rootTree !== 'string' || !HEX40.test(rootTree)) fail('bad_upstream', '提交未返回合法根树 SHA。', 502);

    // 新 tree：仅替换目标单文件，由 GitHub 自动重建中间目录树。
    const tree = await request(`/repos/${r}/git/trees`, {
      method: 'POST',
      body: { base_tree: rootTree, tree: [{ path: file, mode, type: 'blob', sha: newBlobSha }] },
    });
    const newTreeSha = tree?.sha;
    if (typeof newTreeSha !== 'string' || !HEX40.test(newTreeSha)) fail('bad_upstream', 'Tree 创建未返回合法 SHA。', 502);

    // 新 commit：父 = baseSha，不设置 author/committer/date。
    const newCommit = await request(`/repos/${r}/git/commits`, {
      method: 'POST',
      body: { message: commitMessage(file), tree: newTreeSha, parents: [baseSha] },
    });
    const newCommitSha = newCommit?.sha;
    if (typeof newCommitSha !== 'string' || !HEX40.test(newCommitSha)) fail('bad_upstream', 'Commit 创建未返回合法 SHA。', 502);

    // 创建 tree/commit 后再次校验 base 未变化、权限。若变化则保留分支锁、不再移动 / 建 PR。
    await verifyBase(r, baseSha, baseBranch);

    // 仅把“新 ref”以 force:false 向前移动（fast-forward，从 baseSha 到新 commit）。
    await request(`/repos/${r}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: { sha: newCommitSha, force: false },
    });

    // 独立分支移动之后、创建 PR 之前再次核验，仍不声称跨 HTTP 请求原子锁住默认分支。
    await verifyBase(r, baseSha, baseBranch);
    // 创建草稿 PR（draft:true，绝不 merge / 绝不写默认分支）。
    const pr = await request(`/repos/${r}/pulls`, {
      method: 'POST',
      body: { title: prTitle(file), head: branch, base: baseBranch, body: prBody(file, digest), draft: true },
    });
    if (typeof pr?.html_url !== 'string' || typeof pr?.number !== 'number') {
      fail('bad_upstream', 'PR 创建未返回合法结果。', 502);
    }
    return { url: pr.html_url, number: pr.number, branch, draft: true };
  }

  return { request, resolveBase, identity, readSource, createDraft };
}

/* ───────── 内部工具 ───────── */

async function gitBlobSha(bytes) {
  const header = encoder.encode(`blob ${bytes.length}\0`);
  const combined = new Uint8Array(header.length + bytes.length);
  combined.set(header);
  combined.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', combined);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function commitMessage(file) {
  return `refactor(draft): ${file}\n\nAuto-generated draft refactor from fixed-base archaeology evidence. ` +
    'Human review and in-repo tests required before merge.';
}
function prTitle(file) {
  return `Draft refactor: ${file}`;
}
function prBody(file, digest) {
  return `Draft (not auto-merged) refactor of \`${file}\`.\n` +
    'Source-fixed, human-reviewed diff is required before merge.\n' +
    `Proposal digest: ${digest}\n\n` +
    'Created by the code-archaeology tool from a fixed base commit. ' +
    'Must be reviewed and tested in the target project before merging.';
}

// fetch 抛错翻译：区分超时 / 跳转 / 不可达，均为静态错误。
function translateFetchError(e) {
  const msg = (e && e.message) || '';
  if ((e && e.name === 'AbortError') || /abort/i.test(msg)) {
    return new RefactorError('upstream_timeout', 'GitHub 上游请求超时，未自动重试写入。', 504);
  }
  if (/redirect/i.test(msg)) {
    return new RefactorError('unsafe_redirect', 'GitHub 返回跳转，已拒绝跟随（可能为仓库更名）。', 421);
  }
  return new RefactorError('upstream_unreachable', '无法连接 GitHub 上游。', 502);
}

// 按状态码翻译为静态错误（绝不复述上游 message）。
function translateStatus(status) {
  switch (status) {
    case 401: return new RefactorError('caller_auth_required', 'GitHub Token 无效或已过期。', 401);
    case 403: return new RefactorError('forbidden', 'GitHub 拒绝该操作（权限或速率限制）。', 403);
    case 404: return new RefactorError('not_found', 'GitHub 资源不存在或不可访问。', 404);
    case 409: return new RefactorError('conflict', 'GitHub 资源状态冲突，已停止写入。', 409);
    case 422: return new RefactorError('unprocessable', 'GitHub 拒绝请求数据。', 422);
    case 301: case 302: case 307: case 308:
      return new RefactorError('unsafe_redirect', 'GitHub 返回跳转，已拒绝跟随（可能为仓库更名）。', 421);
    default:
      return status >= 500
        ? new RefactorError('upstream_error', 'GitHub 上游暂时不可用。', 503)
        : new RefactorError('upstream_error', 'GitHub 上游请求失败。', 400);
  }
}

export default createGitHub;
