// PhysioAI · Therapist (web) — patient roster.
// Cloud (GET /patients) when a therapist is logged in. Demo data is available
// only when demo mode is enabled (local/dev by default), so production API errors
// are visible instead of being replaced by sample patients.

import { apiGet, apiPost, isDemoEnabled } from './api.js';
import { isLoggedIn } from './auth.js';
import { getPatients as demoPatients, getSessions as demoSessions } from './store.js';

// Returns [{ id, name, email? }]. Empty array = logged in but no patients registered yet.
export async function fetchPatients() {
  if (!isLoggedIn()) return isDemoEnabled() ? demoPatients() : [];
  const list = await apiGet('/patients');
  if (!Array.isArray(list)) {
    const err = new Error('invalid_patients_response');
    err.code = 'invalid_patients_response';
    throw err;
  }
  return list.map((p) => ({ id: p.id, name: p.name, email: p.email }));
}

export async function linkPatient(emailOrId) {
  if (!isLoggedIn()) {
    const err = new Error('login_required');
    err.code = 'login_required';
    throw err;
  }
  const value = String(emailOrId || '').trim();
  if (!value) {
    const err = new Error('required');
    err.code = 'required';
    throw err;
  }
  const body = value.includes('@') ? { email: value.toLowerCase() } : { patientId: value };
  const patient = await apiPost('/patients/link', body);
  return { id: patient.id, name: patient.name, email: patient.email };
}

export async function createPatient({ name, email, password }) {
  if (!isLoggedIn()) {
    const err = new Error('login_required');
    err.code = 'login_required';
    throw err;
  }
  const body = {
    name: String(name || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    password: String(password || ''),
  };
  if (!body.name || !body.email || !body.password) {
    const err = new Error('required');
    err.code = 'required';
    throw err;
  }
  const patient = await apiPost('/patients', body);
  return { id: patient.id, name: patient.name, email: patient.email, verificationRequired: !!patient.verificationRequired };
}

// A patient's finished sessions, newest-first (GET /sessions?patientId=). Demo seed
// when not logged in. Shape matches store.js sessions, so the dashboard analytics work as-is.
export async function fetchSessions(patientId) {
  if (!isLoggedIn()) return isDemoEnabled() ? demoSessions(patientId) : [];
  const list = await apiGet('/sessions?patientId=' + encodeURIComponent(patientId));
  return Array.isArray(list) ? list : [];
}

// A patient's HEP plan (GET /plans?patientId=) — used to compute adherence. null when offline/none.
export async function fetchPlan(patientId) {
  if (!isLoggedIn()) return null;
  return await apiGet('/plans?patientId=' + encodeURIComponent(patientId));
}
