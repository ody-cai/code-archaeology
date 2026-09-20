export const SITE_URL = 'https://code-archaeology.pages.dev/';
export const SITE_ORIGIN = new URL(SITE_URL).origin;
export const PRODUCT_NAME = '代码考古学';

export function isSiteUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.origin === SITE_ORIGIN && !u.username && !u.password; }
  catch { return false; }
}

// Only web links may leave the sandbox. Never launch OS handlers for data/file/custom schemes.
export function externalUrl(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

export function safeDownloadName(value) {
  const name = String(value || 'download').split(/[\\/]/).pop()
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 160);
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `download-${name || 'file'}` : name;
}

export function isAllowedDownload(url, ownerUrl) {
  if (!isSiteUrl(ownerUrl)) return false;
  try {
    const target = new URL(url);
    if (target.origin === SITE_ORIGIN && (target.protocol === 'https:' || target.protocol === 'http:')) return true;
    return target.protocol === 'blob:' && target.href.startsWith(`blob:${SITE_ORIGIN}/`);
  } catch { return false; }
}

export function securePreferences() {
  return {
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    // In-memory session: no API tokens/cookies are deliberately persisted by the wrapper.
    partition: 'code-archaeology-session',
    spellcheck: false,
  };
}
