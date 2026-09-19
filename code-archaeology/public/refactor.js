// 安全重构入口（Web 端）—— 挂在考古报告末尾的「分析区」旁边。
//
// 设计红线（来自赛道安全要求，逐条对应实现）：
//   1) patch 预览只用 textContent，绝不 innerHTML / eval，源码与 HTML 都不会被执行；
//   2) 调用者的 GitHub Token 只活在内存里：不写 local/sessionStorage、不打日志、不进 .diff 下载、不进 getState；
//   3) 创建草稿 PR 需要四个条件同时成立：prEligible + reviewToken + 用户输入的 token + 已勾选确认；
//   4) 清空 token / 改动 token / 拿到新 patch / 切换仓库，都会让旧审阅票据失效，必须重新生成；
//   5) busy 状态阻断重复点击；
//   6) 模型基于历史生成「候选」补丁，但历史只能证明「改了什么」，不能证明「改得对」，必须人工审阅；
//   7) 所有网络请求 redirect:'error'，绝不跟随跳转；URL（PR 链接）只接受 http(s)，拒绝 javascript:/data: 等；
//   8) 请求超时（后台流水线可能更长）只告知用户去 GitHub 检查分支/PR，绝不自动重试。
//
// 该模块是纯前端，不碰任何服务端代码。它只消费 POST /api/refactor（由后端队友实现），
// 通过可被测试的 fetchImpl 注入，因此 UI 测试可以完全脱离网络。

const API_PATH = '/api/refactor';
// 后台流水线（信噪分离 + 模型候选生成）可能耗时较长，30s 太短会被误杀；
// 默认总 timeout 建议 180s。
const DEFAULT_TIMEOUT_MS = 180000;

/* ── 纯函数（可单独单测，不依赖 DOM） ─────────────── */

/** PR 按钮是否可点：四条件缺一不可。 */
export function prReadiness({ prEligible, reviewToken, hasToken, confirmed }) {
  return Boolean(prEligible) && Boolean(reviewToken) && Boolean(hasToken) && Boolean(confirmed);
}

/** 把任意字符串做成可安全放进 textContent 的纯文本（这里仅作显式语义标注，
 *   真正的安全由 textContent 赋值保证，不靠转义；保留以便调用方意图清晰）。 */
export function asPlainText(s) {
  return String(s ?? '');
}

/** 仅允许 http / https 的绝对 URL，阻断 javascript:/data:/vbscript: 等危险方案。 */
export function isSafeHttpUrl(u) {
  if (typeof u !== 'string' || u.length === 0) return false;
  // 先做朴素前缀过滤（最快），再用 URL 解析兜底。
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/* ── 默认 DOM 适配（浏览器里用全局，测试里注入桩） ─── */

function resolveDoc(opts) {
  return opts.doc ?? (typeof document !== 'undefined' ? document : null);
}
function resolveWin(opts) {
  return opts.win ?? (typeof window !== 'undefined' ? window : null);
}
function resolveLoc(opts) {
  return opts.loc ?? (typeof location !== 'undefined' ? location : null);
}
function resolveHistory(opts) {
  // 浏览器里是 History 对象；Node 测试里注入 opts.history 或不存在
  return opts.history ?? (typeof history !== 'undefined' ? history : null);
}

/* ── 主挂载函数 ─────────────────────────────────── */

/**
 * @param {HTMLElement} root 挂载容器（考古报告里的 #refactorZone）
 * @param {object} opts { repo, limit, fetchImpl?, api?, doc?, win?, loc?, history?, timeoutMs? }
 * @returns {{ destroy: () => void, generate: () => void, getState: () => object }}
 */
export function mountRefactor(root, opts = {}) {
  const doc = resolveDoc(opts);
  const win = resolveWin(opts);
  const loc = resolveLoc(opts);
  const hist = resolveHistory(opts);
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  const apiUrl = opts.api ?? API_PATH;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const repo = opts.repo ?? '';
  const limit = opts.limit ?? 40;

  if (!doc) throw new Error('mountRefactor 需要一个 DOM 环境（传入 opts.doc 或运行在浏览器中）');

  // 内部可变状态
  const state = {
    token: '',
    patch: null, // 最近一次 patch 响应里的 data
    busy: false,
    confirmed: false,
  };

  const cleanups = [];
  let aborter = null;
  let destroyed = false;
  let identityVersion = 0;

  /* ── 构建 DOM（全部用 createElement，动态文本走 textContent） ── */

  const panel = doc.createElement('section');
  panel.className = 'section refactor-panel';

  const head = doc.createElement('div');
  head.className = 'section-head';
  const headText = doc.createElement('div');
  const h2 = doc.createElement('h2');
  h2.textContent = '安全重构入口';
  const en = doc.createElement('span');
  en.className = 'section-en';
  en.textContent = 'Safe Refactor · 只创建独立分支与草稿 PR';
  headText.appendChild(h2);
  headText.appendChild(en);
  const note = doc.createElement('span');
  note.className = 'section-note';
  note.dataset.role = 'note';
  note.textContent = '';
  head.appendChild(headText);
  head.appendChild(note);

  const body = doc.createElement('div');
  body.className = 'section-body';

  const disclaimer = doc.createElement('p');
  disclaimer.className = 'refactor-disclaimer';
  disclaimer.textContent =
    '模型会基于提交历史生成补丁「候选」，但历史只能证明「改了什么」，不能证明「改得对」。请人工审阅 diff，并确认只创建独立分支和草稿 PR。';

  const controls = doc.createElement('div');
  controls.className = 'refactor-controls';

  const tokenField = doc.createElement('label');
  tokenField.className = 'field refactor-token-field';
  const tokenLabel = doc.createElement('span');
  tokenLabel.className = 'refactor-token-label';
  tokenLabel.textContent = 'GitHub Token（仅本次会话内存，不保存）';
  const tokenInput = doc.createElement('input');
  tokenInput.type = 'password';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;
  tokenInput.placeholder = 'ghp_… 或 github_pat_…（可选，用于获得审阅凭证）';
  tokenInput.className = 'refactor-token';
  tokenField.appendChild(tokenLabel);
  tokenField.appendChild(tokenInput);

  const genBtn = doc.createElement('button');
  genBtn.type = 'button';
  genBtn.className = 'dig-btn refactor-generate';
  genBtn.textContent = '生成补丁';

  controls.appendChild(tokenField);
  controls.appendChild(genBtn);

  const confirmWrap = doc.createElement('label');
  confirmWrap.className = 'refactor-confirm';
  const confirmBox = doc.createElement('input');
  confirmBox.type = 'checkbox';
  confirmBox.className = 'refactor-confirm-box';
  const confirmText = doc.createElement('span');
  confirmText.textContent = '已审阅本补丁，确认只创建独立分支和草稿 PR';
  confirmWrap.appendChild(confirmBox);
  confirmWrap.appendChild(confirmText);

  const status = doc.createElement('div');
  status.className = 'refactor-status';
  status.setAttribute('aria-live', 'polite');
  status.dataset.role = 'status';

  const diffPre = doc.createElement('pre');
  diffPre.className = 'refactor-diff';
  diffPre.hidden = true;

  const actions = doc.createElement('div');
  actions.className = 'refactor-actions';
  const dlBtn = doc.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'sample refactor-download';
  dlBtn.textContent = '下载 .diff';
  dlBtn.disabled = true;
  const prBtn = doc.createElement('button');
  prBtn.type = 'button';
  prBtn.className = 'dig-btn refactor-pr';
  prBtn.textContent = '创建草稿 PR';
  prBtn.disabled = true;
  actions.appendChild(dlBtn);
  actions.appendChild(prBtn);

  const evList = doc.createElement('ul');
  evList.className = 'refactor-evidence';
  evList.dataset.role = 'evidence';
  const warnList = doc.createElement('ul');
  warnList.className = 'refactor-warnings';
  warnList.dataset.role = 'warnings';

  body.appendChild(disclaimer);
  body.appendChild(controls);
  body.appendChild(confirmWrap);
  body.appendChild(status);
  body.appendChild(diffPre);
  body.appendChild(actions);
  body.appendChild(evList);
  body.appendChild(warnList);

  panel.appendChild(head);
  panel.appendChild(body);
  root.appendChild(panel);

  /* ── 状态渲染辅助 ── */

  function setStatus(kind, msg) {
    status.className = 'refactor-status' + (kind ? ' is-' + kind : '');
    status.textContent = msg ?? '';
  }

  function setNote() {
    const p = state.patch;
    if (!p) {
      note.textContent = '';
      return;
    }
    const parts = [];
    if (p.digest) parts.push('digest ' + String(p.digest).slice(0, 12) + '…');
    if (p.changedLines != null) parts.push('改动 ' + p.changedLines + ' 行');
    if (p.prEligible) parts.push('可创建 PR');
    else parts.push('仅可下载（未授权 PR）');
    if (p.expiresAt) {
      const left = Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000));
      parts.push('凭证 ' + left + 's 后失效');
    }
    note.textContent = parts.join(' · ');
  }

  function renderEvidence(evidence) {
    evList.innerHTML = '';
    if (!evidence || typeof evidence !== 'object') return;
    for (const [k, v] of Object.entries(evidence)) {
      const li = doc.createElement('li');
      const key = doc.createElement('b');
      key.textContent = k;
      li.appendChild(key);
      const val = doc.createElement('span');
      // 证据值一律走 textContent，绝不 innerHTML
      val.textContent = '：' + (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
      li.appendChild(val);
      evList.appendChild(li);
    }
  }

  function renderWarnings(warnings) {
    warnList.innerHTML = '';
    const list = Array.isArray(warnings) ? warnings : [];
    if (!list.length) return;
    for (const w of list) {
      const li = doc.createElement('li');
      li.textContent = typeof w === 'string' ? w : w?.message ?? JSON.stringify(w);
      warnList.appendChild(li);
    }
  }

  /** 清空补丁相关 UI（失败 / 切换 token 时调用，避免「旧预览」残留）。 */
  function clearPatchUI() {
    diffPre.hidden = true;
    diffPre.textContent = '';
    evList.innerHTML = '';
    warnList.innerHTML = '';
    dlBtn.disabled = true;
    setNote();
  }

  /** 渲染一份 patch：diff 通过 textContent 安全显示（关键安全点）。 */
  function renderPatch(data) {
    state.patch = data;
    // 新拿到补丁 -> 撤销用户的「已审阅」勾选，强制重新确认
    revokeConfirm();

    diffPre.hidden = false;
    diffPre.textContent = asPlainText(data.diff ?? ''); // 安全：不会执行源码 / HTML

    renderEvidence(data.evidence);
    renderWarnings(data.warnings);
    setNote();

    dlBtn.disabled = !(data.diff != null && data.diff !== '');
    updatePrButton();
    setStatus('ok', `补丁已就绪：${data.file ?? ''} · 改动 ${data.changedLines ?? '?'} 行`);
  }

  function revokeConfirm() {
    state.confirmed = false;
    confirmBox.checked = false;
    updatePrButton();
  }

  function updatePrButton() {
    const ready = prReadiness({
      prEligible: state.patch?.prEligible,
      reviewToken: state.patch?.reviewToken,
      hasToken: Boolean(state.token),
      confirmed: state.confirmed,
    });
    prBtn.disabled = !ready || state.busy;
  }

  /* ── 网络请求（统一封装，错误走结构化 message，redirect 一律报错） ── */

  async function callApi(body, withToken) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境没有可用的 fetch');
    const controller = new AbortController();
    aborter = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'Content-Type': 'application/json' };
      // token 只通过 X-GitHub-Token 头传出（且仅来自用户输入），不进 body、不进 URL、不进日志
      if (withToken && state.token) headers['X-GitHub-Token'] = state.token;

      const res = await fetchImpl(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error', // 安全：绝不跟随跳转，避免被导向到非预期地址
      });

      let payload;
      try {
        payload = await res.json();
      } catch {
        throw new Error(`服务返回了非 JSON 响应（HTTP ${res.status}）`);
      }
      if (!res.ok || payload.error) {
        throw new Error(payload.message || `请求失败（HTTP ${res.status}）`);
      }
      return payload.data;
    } finally {
      clearTimeout(timer);
      aborter = null;
    }
  }

  /* ── 事件处理 ── */

  async function onGenerate() {
    if (destroyed) return;
    if (state.busy) return; // busy 阻断重复点击
    const requestVersion = identityVersion;
    state.busy = true;
    genBtn.disabled = true;
    prBtn.disabled = true;
    setStatus('loading', `正在为 ${repo} 生成补丁候选…`);
    try {
      // 默认 patch：不传 path（避免 path:null 被服务拒绝）；仅当用户显式指定时才带上。
      const body = { repo, mode: 'patch', limit };
      if (opts.path) body.path = opts.path;

      const data = await callApi(body, true); // patch 也带调用者 token（可选），用于换取审阅凭证
      if (destroyed || requestVersion !== identityVersion) return;
      renderPatch(data);
      // 标记 URL，便于刷新后识别处于「已生成补丁」状态（不含任何敏感信息）
      if (loc && hist && typeof hist.replaceState === 'function') {
        try {
          hist.replaceState(null, '', '#refactor');
        } catch {
          /* 某些环境禁止改 hash，忽略即可 */
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        // 超时：后台流水线可能仍在进行，告知用户去 GitHub 检查分支/PR，绝不自动重试。
        setStatus(
          'error',
          '请求超时：后台流水线可能仍在运行。请到 GitHub 检查对应分支 / 草稿 PR，不要重复点击重试。'
        );
      } else {
        setStatus('error', e.message || '生成补丁失败');
      }
      // 失败清理敏感/过期状态：清空旧补丁与预览，避免「旧预览」残留误导。
      state.patch = null;
      clearPatchUI();
      updatePrButton();
    } finally {
      state.busy = false;
      genBtn.disabled = false;
      updatePrButton();
    }
  }

  function onDownload() {
    const data = state.patch;
    if (!data || data.diff == null) return;
    const filename = (repo || 'change').replace(/[^\w.-]/g, '_') + '.patch.diff';
    // 注入式适配：浏览器用 Blob + URL + <a>.download；测试可传 stub。
    const BlobCtor = opts.blobCtor ?? (typeof Blob !== 'undefined' ? Blob : null);
    const URLCtor = opts.urlCtor ?? (typeof URL !== 'undefined' ? URL : null);
    if (!BlobCtor || !URLCtor) {
      setStatus('error', '当前环境不支持下载');
      return;
    }
    const blob = new BlobCtor([data.diff], { type: 'application/octet-stream' });
    const url = URLCtor.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    URLCtor.revokeObjectURL(url);
    setStatus('ok', `已下载 ${filename}（不含 token）`);
  }

  async function onPr() {
    if (state.busy) return;
    // 四条件门控（双保险，UI 禁用 + 逻辑校验）
    if (!prReadiness({ prEligible: state.patch?.prEligible, reviewToken: state.patch?.reviewToken, hasToken: Boolean(state.token), confirmed: state.confirmed })) {
      setStatus('warn', '需要：已生成可 PR 补丁 + 审阅凭证 + 输入 Token + 勾选确认');
      return;
    }
    state.busy = true;
    genBtn.disabled = true;
    prBtn.disabled = true;
    setStatus('loading', '正在创建独立分支与草稿 PR…');
    try {
      const data = await callApi(
        {
          repo,
          mode: 'pr',
          confirm: true,
          reviewedDigest: state.patch.digest,
          reviewToken: state.patch.reviewToken,
          diff: state.patch.diff,
        },
        true
      );
      // 成功：先写状态文本（textContent 会清空子节点），再按需追加可点击链接。
      // 仅当 URL 是 http(s) 时才生成可点击链接，否则只展示文本，杜绝 javascript:/data: 注入。
      if (data.url && isSafeHttpUrl(data.url)) {
        setStatus('ok', `草稿 PR 已创建：（分支 ${data.branch ?? ''}）`);
        const link = doc.createElement('a');
        link.href = data.url;
        link.textContent = data.url;
        link.className = 'refactor-pr-link';
        link.rel = 'noopener';
        link.target = '_blank';
        status.appendChild(link);
      } else {
        // 非法或未提供 URL：仅以纯文本提示，绝不把它当作可点击 href。
        setStatus('ok', `草稿 PR 已创建（分支 ${data.branch ?? ''}），但未返回可验证链接，请到 GitHub 自行核对。`);
      }
      // PR 成功后撤销「已审阅」确认：审阅票据已消费，防止误再次提交。
      revokeConfirm();
    } catch (e) {
      if (e.name === 'AbortError') {
        setStatus(
          'error',
          '请求超时：后台流水线可能仍在运行。请到 GitHub 检查对应分支 / 草稿 PR，不要重复点击重试。'
        );
      } else {
        setStatus('error', e.message || '创建 PR 失败');
      }
      // 失败同样清理，不让已消费/过期的凭据继续可点。
      updatePrButton();
    } finally {
      state.busy = false;
      genBtn.disabled = false;
      updatePrButton();
    }
  }

  function onTokenInput() {
    const next = tokenInput.value;
    // 清空 / 改动 token -> 旧审阅票据（reviewToken）立即失效，必须重新生成补丁
    // 才能拿回 PR 资格。这是为了防止「换了 token 仍用旧凭证」绕过服务端校验。
    // 这里只让票据失效（保留 diff 供人工复核），而非整段丢弃。
    if (next !== state.token) {
      state.token = next;
      identityVersion += 1;
      if (state.patch) {
        // 旧 reviewToken 绑定的是上一个 token 视角，必须作废；同时把 prEligible 置否，
        // 使 PR 按钮禁用，直到用新 token 重新 generate 换发新票据。
        state.patch = { ...state.patch, reviewToken: null, prEligible: false };
        setNote();
      }
      revokeConfirm();
      updatePrButton();
    }
  }

  function onConfirmChange() {
    state.confirmed = confirmBox.checked;
    updatePrButton();
  }

  // hashchange：刷新后回到带 #refactor 的页面时，仅做无害的状态提示（不自动重发请求）
  function onHashChange() {
    if (loc && loc.hash === '#refactor' && !state.patch) {
      setStatus('warn', '检测到上次处于补丁状态；点击「生成补丁」可重新获取（凭证不会自动复用）');
    }
  }

  genBtn.addEventListener('click', onGenerate);
  dlBtn.addEventListener('click', onDownload);
  prBtn.addEventListener('click', onPr);
  tokenInput.addEventListener('input', onTokenInput);
  confirmBox.addEventListener('change', onConfirmChange);
  if (win && win.addEventListener) {
    win.addEventListener('hashchange', onHashChange);
    cleanups.push(() => win.removeEventListener('hashchange', onHashChange));
  }

  /* ── 销毁：重考古 / 切换仓库时清理监听、URL 与敏感状态 ── */

  function destroy() {
    destroyed = true;
    identityVersion += 1;
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    cleanups.length = 0;
    if (aborter) {
      try {
        aborter.abort();
      } catch {
        /* ignore */
      }
      aborter = null;
    }
    // 销毁必须清理敏感状态（token），避免残留内存里。
    state.token = '';
    tokenInput.value = '';
    state.patch = null;
    state.confirmed = false;
    if (loc && loc.hash === '#refactor' && hist && typeof hist.replaceState === 'function') {
      try {
        hist.replaceState(null, '', ' ');
      } catch {
        /* ignore */
      }
    }
    panel.remove();
  }

  // 初次渲染
  setStatus('', '输入可选 Token 后点击「生成补丁」。');
  setNote();

  return {
    destroy,
    generate: onGenerate,
    getState: () => {
      // 关键：getState 绝不泄露用户 token，仅暴露非敏感状态。
      const { token, ...rest } = state;
      return { ...rest, patch: state.patch ? { ...state.patch } : null };
    },
  };
}
