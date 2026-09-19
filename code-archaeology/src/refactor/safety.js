export class RefactorError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export const fail = (code, message, status = 400) => { throw new RefactorError(code, message, status); };
export const encoder = new TextEncoder();
export async function sha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))]
    .map((n) => n.toString(16).padStart(2, '0')).join('');
}
export function safeRepo(repo) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo) || repo.endsWith('.git')) {
    fail('invalid_repo', '仓库须为严格的 owner/name，不接受 URL、查询参数或路径。');
  }
  return repo.toLowerCase();
}
export function safePath(file) {
  if (typeof file !== 'string' || file.length > 240 || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte)$/.test(file)
      || file.split('/').some((x) => !x || x === '.' || x === '..' || x.startsWith('.'))
      || /(^|\/)(?:node_modules|vendor|dist|build|coverage|generated|secrets?|credentials?)(\/|\.)/i.test(file)
      || /(?:^|\/)(?:[^/]*\.)?(?:min|generated)\.[^/]+$/.test(file)) {
    fail('unsafe_path', '仅支持安全相对路径下的常规源码文件；不允许隐藏路径、配置、生成物或目录穿越。');
  }
  return file;
}
export function assertNoSecrets(text, secrets = []) {
  if (typeof text !== 'string' || secrets.filter((s) => typeof s === 'string' && s.length >= 8).some((s) => text.includes(s))
      || /(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) {
    fail('sensitive_content', '检测到可能的凭据；已停止生成或输出，请先清理源码中的敏感信息。', 422);
  }
}
/**
 * 字节数组 → Base64。分块处理，避免 `String.fromCharCode(...bytes)` 在数组过大时
 * 触发「Maximum call stack size exceeded」。btoa 在 Node ≥16 与 Workers 均可用。
 */
export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Base64 → 字节数组（分块解码，兼容任意长度与多字节内容）。 */
export function base64ToBytes(b64) {
  const bin = atob(String(b64));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function bounded(fn, ms, code = 'upstream_timeout') {
  const ctrl = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(ctrl.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => {
        ctrl.abort();
        reject(new RefactorError(code, '操作超时，未自动重试写入。', 504));
      }, ms); }),
    ]);
  } finally { clearTimeout(timer); }
}
