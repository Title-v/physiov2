// PhysioAI · Therapist (web) — backend API client.
//
// Same-origin by default: the Node server serves this frontend and the Supabase-backed API.
// Override before loading the app with: window.PHYSIOAI_API_BASE = 'https://...'
const flagOn = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
const host = globalThis.location?.hostname || '';
const port = globalThis.location?.port || '';
const protocol = globalThis.location?.protocol || '';
const privateLan = host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
const localHost = !host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || privateLan;
const localFile = protocol === 'file:';
const localApiBase = (host === 'localhost' || host === '127.0.0.1') && port && port !== '3000'
  ? `${protocol || 'http:'}//${host}:3000`
  : '';

export const API_BASE = String(globalThis.PHYSIOAI_API_BASE || localApiBase || '').replace(/\/+$/, '');
export const DEMO_ENABLED = flagOn(globalThis.PHYSIOAI_ENABLE_DEMO) || localHost || localFile;

let apiBase = API_BASE;
let tokenKey = 'physioai.v1.token';

export function configureApi({ base = null, tokenKey: nextTokenKey = null } = {}) {
  if (base != null) apiBase = String(base || '').replace(/\/+$/, '');
  if (nextTokenKey) tokenKey = String(nextTokenKey);
}

export const isCloud = () => !!apiBase;
export const isDemoEnabled = () => DEMO_ENABLED;

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_GET_RETRIES = 1;
export function getToken() { try { return localStorage.getItem(tokenKey); } catch { return null; } }
export function setToken(tk) { try { if (tk) localStorage.setItem(tokenKey, tk); else localStorage.removeItem(tokenKey); } catch {} }

function timeoutError(path, timeoutMs) {
  const err = new Error('request_timeout');
  err.code = 'request_timeout';
  err.path = path;
  err.timeoutMs = timeoutMs;
  return err;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  if (!timeoutMs || typeof AbortController === 'undefined') return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw timeoutError(url, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function req(path, { method = 'GET', body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS, retries } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) { const tk = getToken(); if (tk) headers.authorization = 'Bearer ' + tk; }
  const safeMethod = String(method || 'GET').toUpperCase();
  const maxRetries = safeMethod === 'GET' ? Number(retries ?? DEFAULT_GET_RETRIES) || 0 : 0;
  let attempt = 0;
  let res = null;
  while (attempt <= maxRetries) {
    try {
      res = await fetchWithTimeout(apiBase + path, {
        method: safeMethod,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      }, timeoutMs);
      break;
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      attempt += 1;
      continue;
    }
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || ('http_' + res.status));
    err.code = data && data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const apiGet = (p, opts) => req(p, { method: 'GET', ...(opts || {}) });
export const apiPost = (p, body, opts) => req(p, { method: 'POST', body, ...(opts || {}) });
export const apiPut = (p, body, opts) => req(p, { method: 'PUT', body, ...(opts || {}) });
export const apiDelete = (p, body, opts) => req(p, { method: 'DELETE', body, ...(opts || {}) });
