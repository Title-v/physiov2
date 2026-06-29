import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoleAuthClient } from '../../shared/core/auth-client.js';

function installLocalStorage() {
  const store = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return () => {
    if (original) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

test('createRoleAuthClient logs in and stores token/session for the requested role', async () => {
  const restoreStorage = installLocalStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url).endsWith('/auth/login'), true);
    assert.equal(options.method, 'POST');
    return jsonResponse({
      token: 'patient-token',
      user: { id: 'p1', role: 'patient', email: 'p@example.com' },
    });
  };
  try {
    const auth = createRoleAuthClient({
      role: 'patient',
      tokenKey: 'test.patient.token',
      sessionKey: 'test.patient.session',
    });
    const user = await auth.login({ email: 'P@EXAMPLE.COM', password: 'pw' });
    assert.equal(user.role, 'patient');
    assert.equal(globalThis.localStorage.getItem('test.patient.token'), 'patient-token');
    assert.deepEqual(auth.getSession(), { id: 'p1', role: 'patient', email: 'p@example.com' });
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});

test('createRoleAuthClient rejects the wrong role and clears token', async () => {
  const restoreStorage = installLocalStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    token: 'therapist-token',
    user: { id: 't1', role: 'therapist' },
  });
  try {
    const auth = createRoleAuthClient({
      role: 'patient',
      tokenKey: 'test.patient.token.2',
      sessionKey: 'test.patient.session.2',
    });
    await assert.rejects(() => auth.login({ email: 't@example.com', password: 'pw' }), /not_patient/);
    assert.equal(globalThis.localStorage.getItem('test.patient.token.2'), null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});

test('createRoleAuthClient verify keeps cached session on network failure', async () => {
  const restoreStorage = installLocalStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const auth = createRoleAuthClient({
      role: 'patient',
      tokenKey: 'test.patient.token.3',
      sessionKey: 'test.patient.session.3',
    });
    globalThis.localStorage.setItem('test.patient.token.3', 'cached-token');
    auth.saveSession({ id: 'p3', role: 'patient' });
    assert.deepEqual(await auth.verify(), { id: 'p3', role: 'patient' });
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});
