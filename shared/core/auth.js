// PhysioAI · Therapist (web) — therapist authentication against the cloud backend.
// Login/register hit POST /auth/* and store the returned JWT (api.js) + cached user.
// Only therapist-role accounts are accepted into the Therapist console.

import { getToken, isDemoEnabled } from './api.js';
import { createRoleAuthClient } from './auth-client.js';

const K_THERAPIST = 'physioai.v1.therapist'; // cached { id, name, email, role }
const K_GUEST = 'physioai.v1.guest';         // '1' when browsing as guest (demo, no cloud)
const therapistAuth = createRoleAuthClient({ role: 'therapist', sessionKey: K_THERAPIST });

export function getTherapist() {
  return therapistAuth.getSession();
}
function clearGuest() { try { localStorage.removeItem(K_GUEST); } catch {} }
function save(user) { clearGuest(); return user; }

export function isLoggedIn() { return !!getToken() && !!getTherapist(); }

// Guest = quick live demo: no login, no token, localStorage only. Available only
// when demo mode is enabled; cleared on a real login or on logout.
export function isGuest() { try { return isDemoEnabled() && localStorage.getItem(K_GUEST) === '1'; } catch { return false; } }
export function continueAsGuest() {
  if (!isDemoEnabled()) { const err = new Error('demo_disabled'); err.code = 'demo_disabled'; throw err; }
  try { localStorage.setItem(K_GUEST, '1'); } catch {}
  return { guest: true, name: 'Guest' };
}

export function logout() {
  therapistAuth.clearSession();
  clearGuest();
}

export async function login({ email, password }) {
  const e = (email || '').trim().toLowerCase();
  if (!e || !password) { const err = new Error('required'); err.code = 'required'; throw err; }
  return save(await therapistAuth.login({ email: e, password }));
}

export async function register({ name, email, password }) {
  const e = (email || '').trim().toLowerCase();
  const n = (name || '').trim();
  if (!n || !e || !password) { const err = new Error('required'); err.code = 'required'; throw err; }
  return save(await therapistAuth.register({ name: n, email: e, password }));
}

export async function resendVerification(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) { const err = new Error('required'); err.code = 'required'; throw err; }
  return therapistAuth.resendVerification(e);
}

// Re-validate the cached token against the backend. Updates the cache on success;
// on network error it leaves the cached session intact (offline-friendly).
export async function verify() {
  const user = await therapistAuth.verify();
  return user?.role === 'therapist' ? save(user) : null;
}
