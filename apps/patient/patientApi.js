import { apiGet } from '../../shared/core/api.js';
import { createRoleAuthClient } from '../../shared/core/auth-client.js';
import { PATIENT_EXERCISE_BY_ID, normalizePatientExercise } from '../../shared/core/patient-exercises.js';

export const PATIENT_TOKEN_KEY = 'physioai.v2.token';
export const PATIENT_SESSION_KEY = 'physioai.v2.session';

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function createPatientAuthClient() {
  return createRoleAuthClient({
    role: 'patient',
    sessionKey: PATIENT_SESSION_KEY,
    tokenKey: PATIENT_TOKEN_KEY,
  });
}

export function authMessage(error) {
  const code = error?.code || error;
  switch (code) {
    case 'required': return 'กรอกข้อมูลให้ครบ';
    case 'invalid': return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    case 'exists': return 'อีเมลนี้ถูกใช้แล้ว';
    case 'not_patient': return 'บัญชีนี้ไม่ใช่บัญชีผู้ป่วย';
    case 'email_confirmation_required': return 'ส่งอีเมลยืนยันแล้ว กรุณากดยืนยันในอีเมลก่อนเข้าสู่ระบบ';
    case 'email_not_verified': return 'อีเมลนี้ยังไม่ได้ยืนยัน กรุณากดลิงก์ verify ในอีเมล';
    case 'api_not_configured': return 'ยังไม่ได้ตั้งค่า API';
    case 'unauthorized':
    case 'invalid_token':
    case 'jwt_expired': return 'กรุณาเข้าสู่ระบบอีกครั้ง';
    default: return 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ';
  }
}

export function normalizeExercise(raw, over = {}, catalog = PATIENT_EXERCISE_BY_ID) {
  return normalizePatientExercise(raw, over, catalog);
}

export function normalizeReferences(raw) {
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.filter((ref) => ref?.exerciseId).map((ref) => [ref.exerciseId, ref]));
  }
  return raw && typeof raw === 'object' ? raw : {};
}

export function normalizePlan(raw, references = {}, catalog = PATIENT_EXERCISE_BY_ID) {
  if (!raw?.items?.length) return { items: [] };
  const items = raw.items
    .map((item) => {
      const ex = normalizeExercise(item.exercise || { id: item.exerciseId }, item, catalog);
      const reference = references[ex.id] || null;
      return ex.id ? { ...item, exercise: { ...ex, reference }, exerciseId: ex.id, reference } : null;
    })
    .filter(Boolean);
  return { ...raw, items };
}

export function toMs(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const date = Number(new Date(value));
  return Number.isFinite(date) ? date : 0;
}

export function normalizeSessions(raw) {
  return Array.isArray(raw) ? raw.map((session) => ({ ...session, endedAt: toMs(session.endedAt) })) : [];
}

export async function loadPatientCloudData({ get = apiGet } = {}) {
  try {
    const [plan, sessions, referencesRaw] = await Promise.all([
      get('/plans'),
      get('/sessions'),
      get('/references'),
    ]);
    const references = normalizeReferences(referencesRaw);
    return {
      references,
      plan: normalizePlan(plan, references),
      sessions: normalizeSessions(sessions),
      loadError: null,
    };
  } catch (error) {
    return {
      references: {},
      plan: { items: [] },
      sessions: [],
      loadError: error,
    };
  }
}

export function savePatientSession(state, authClient, session) {
  if (state) state.session = session;
  return authClient.saveSession(session);
}

export function clearPatientSession(state, authClient) {
  if (state) state.session = null;
  authClient.clearSession();
}

export async function loginPatient(authClient, authState = {}) {
  const email = authState.email?.trim().toLowerCase();
  const password = authState.password;
  if (!email || !password) throw codedError('required');
  return authClient.login({ email, password });
}

export async function registerPatient(authClient, authState = {}) {
  const name = authState.name?.trim();
  const email = authState.email?.trim().toLowerCase();
  const password = authState.password;
  const confirm = authState.confirm;
  if (!name || !email || !password || !confirm) throw codedError('required');
  if (password !== confirm) throw codedError('match');
  return authClient.register({ name, email, password });
}

export function resendPatientVerification(authClient, authState = {}) {
  return authClient.resendVerification(authState.email?.trim().toLowerCase());
}

export function verifyPatientSession(authClient) {
  return authClient.verify();
}
