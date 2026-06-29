import { apiGet, apiPost, configureApi, getToken, setToken } from './api.js';

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {}
}

export function createRoleAuthClient({
  role,
  sessionKey,
  tokenKey = null,
  base = null,
  registerRole = role,
} = {}) {
  if (!role || !sessionKey) throw new Error('role_and_session_key_required');
  if (tokenKey || base != null) configureApi({ tokenKey, base });

  function getSession() {
    return readJson(sessionKey);
  }

  function saveSession(user) {
    writeJson(sessionKey, user);
    return user;
  }

  function clearSession() {
    setToken(null);
    writeJson(sessionKey, null);
  }

  async function login({ email, password }) {
    const e = (email || '').trim().toLowerCase();
    if (!e || !password) throw codedError('required');
    const data = await apiPost('/auth/login', { email: e, password }, { auth: false });
    if (data.user?.role && data.user.role !== role) {
      setToken(null);
      throw codedError(`not_${role}`);
    }
    setToken(data.token);
    return saveSession(data.user);
  }

  async function register({ name, email, password }) {
    const e = (email || '').trim().toLowerCase();
    const n = (name || '').trim();
    if (!n || !e || !password) throw codedError('required');
    const data = await apiPost('/auth/register', { name: n, email: e, password, role: registerRole }, { auth: false });
    if (data.token) setToken(data.token);
    if (data.user?.role && data.user.role !== role) throw codedError(`not_${role}`);
    return saveSession(data.user);
  }

  async function resendVerification(email) {
    const e = (email || '').trim().toLowerCase();
    if (!e) throw codedError('required');
    return apiPost('/auth/resend-verification', { email: e }, { auth: false });
  }

  async function verify() {
    const token = getToken();
    const cached = getSession();
    if (!token || !cached) return null;
    try {
      const { user } = await apiGet('/auth/me');
      if (user?.role && user.role !== role) {
        clearSession();
        return null;
      }
      return saveSession(user);
    } catch (error) {
      if ([401, 403].includes(error.status)) clearSession();
      return getSession();
    }
  }

  return {
    getSession,
    saveSession,
    clearSession,
    login,
    register,
    resendVerification,
    verify,
  };
}
