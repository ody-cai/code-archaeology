import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat } from '../src/agents/llm.js';

for (const provider of ['openai', 'anthropic', 'gemini']) {
  test(`${provider} transport refuses credential-bearing redirects and honors abort`, async () => {
    const previous = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      const data = provider === 'anthropic' ? { content: [{ text: '{}' }] } : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: '{}' }] } }] } : { choices: [{ message: { content: '{}' } }] };
      return new Response(JSON.stringify(data));
    };
    try {
      const result = await chat({ env: { LLM_PROVIDER: provider, LLM_API_KEY: 'fixture-not-a-real-key' }, model: 'fixture-model', system: 'fixture', user: 'JSON fixture', retries: 0 });
      assert.equal(result, '{}');
      assert.equal(calls.length, 1);
      // 这条断言曾经写的是 'error'。它在本地永远通过，却让线上三个模型调用全部失败 ——
      // Cloudflare 的运行时只接受 follow/manual，'error' 会在 fetch 阶段直接抛
      // 「Invalid redirect value」。测试固化了一个只在 Node 上成立的行为。
      assert.equal(calls[0].opts.redirect, 'manual');
      assert.ok(calls[0].opts.signal instanceof AbortSignal);
      const ac = new AbortController(); ac.abort();
      await assert.rejects(chat({ env: { LLM_PROVIDER: provider }, model: 'fixture', user: 'fixture', signal: ac.signal }));
      assert.equal(calls.length, 1);
    } finally { globalThis.fetch = previous; }
  });
}

// 重定向必须仍然被拒绝：请求头里带着 API Key，一旦跟着 302 走，
// 凭据就被转发到第三方域名了。manual 模式不会自动跟随，再手动把 3xx 当错误。
test('遇到 3xx 重定向时拒绝请求，且不把凭据带到新地址', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return new Response('', { status: 302, headers: { location: 'https://evil.example.com/steal' } });
  };
  try {
    await assert.rejects(
      chat({
        env: { LLM_PROVIDER: 'openai', LLM_API_KEY: 'fixture-not-a-real-key', LLM_BASE_URL: 'https://api.example.com/v1' },
        model: 'fixture-model',
        user: 'JSON fixture',
        retries: 0,
      }),
      /重定向/,
    );
    assert.equal(calls.length, 1, '重定向后不得再发起第二次请求 —— 那等于把凭据送出去');
  } finally {
    globalThis.fetch = previous;
  }
});
