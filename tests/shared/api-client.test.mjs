import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

async function loadApiClient() {
  const url = pathToFileURL(path.resolve('shared/core/api.js'));
  url.search = `?t=${Date.now()}_${Math.random()}`;
  return import(url.href);
}

function okResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

test('apiGet retries one transient fetch failure by default', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('network');
    return okResponse({ ok: true });
  };
  try {
    const { apiGet } = await loadApiClient();
    const data = await apiGet('/retry');
    assert.deepEqual(data, { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apiPost does not retry failed side-effect requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network');
  };
  try {
    const { apiPost } = await loadApiClient();
    await assert.rejects(() => apiPost('/write', { x: 1 }));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
