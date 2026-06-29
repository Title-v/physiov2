import {
  PATIENT_EXERCISES,
  PATIENT_EXERCISE_BY_ID,
  normalizePatientExercise,
  overlayJointsForExercise,
  practiceAngle,
  practiceDose,
  practicePreviewData,
  referenceForExercise,
} from '../../shared/core/patient-exercises.js';
import { createPoseEngine, makeDrawer, startCamera, stopCamera } from '../../shared/ai/PoseDetection.js';
import { drawBoundaryBox } from '../../shared/ai/BoundaryBoxGate.js';
import { drawAngleOverlayForJoints } from '../../shared/ai/AngleOverlay.js';
import { createMotionQualityEngine, isUsablePracticeReference } from '../../shared/ai/MotionQualityEngine.js';
import { createPracticeFrameProcessor } from '../../shared/practice/frame.js';
import { buildPracticeSessionPayload, summaryMetrics } from '../../shared/practice/session.js';

const colors = {
  line: '#E5DFD3',
  ink: '#1F2937',
  ink2: '#6B7280',
  ink3: '#9CA3AF',
  inverse: '#FBFAF5',
  brand: '#2F5D50',
  good: '#2F5D50',
  warn: '#9C7344',
  bad: '#8C4F40',
};

const host = globalThis.location?.hostname || '';
const port = globalThis.location?.port || '';
const protocol = globalThis.location?.protocol || 'http:';
const localApiBase = (host === 'localhost' || host === '127.0.0.1') && port && port !== '3000'
  ? `${protocol}//${host}:3000`
  : '';
const API_BASE = String(globalThis.PHYSIOAI_API_BASE || localApiBase || '').replace(/\/+$/, '');

const TOKEN_KEY = 'physioai.v2.token';
const SESSION_KEY = 'physioai.v2.session';

const builtins = PATIENT_EXERCISES;
const byId = PATIENT_EXERCISE_BY_ID;

const state = {
  screen: 'welcome',
  session: null,
  exercise: builtins[0],
  plan: { items: [] },
  sessions: [],
  references: {},
  practiceRun: null,
  lastSummary: null,
  loadError: null,
  auth: { name: '', email: '', password: '', confirm: '', error: '', info: '', busy: false },
};

const app = document.querySelector('#app');
const poseEngine = createPoseEngine();
const practiceRuntime = {
  running: false,
  raf: 0,
  video: null,
  canvas: null,
  drawer: null,
  motionEngine: null,
  frameProcessor: null,
  reference: null,
  snapshot: null,
  boundaryFrame: null,
  lastVideoTime: -1,
  startedAt: 0,
  frameCount: 0,
  exerciseId: null,
};

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  return session;
}

function clearSession() {
  state.session = null;
  setToken(null);
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `http_${res.status}`);
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

const apiGet = (path) => api(path);
const apiPost = (path, body) => api(path, { method: 'POST', body });

function authMessage(error) {
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

async function loginPatient() {
  const email = state.auth.email.trim().toLowerCase();
  const password = state.auth.password;
  if (!email || !password) {
    throw Object.assign(new Error('required'), { code: 'required' });
  }
  const data = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  if (data.user?.role && data.user.role !== 'patient') {
    setToken(null);
    throw Object.assign(new Error('not_patient'), { code: 'not_patient' });
  }
  setToken(data.token);
  return saveSession(data.user);
}

async function registerPatient() {
  const name = state.auth.name.trim();
  const email = state.auth.email.trim().toLowerCase();
  const password = state.auth.password;
  const confirm = state.auth.confirm;
  if (!name || !email || !password || !confirm) {
    throw Object.assign(new Error('required'), { code: 'required' });
  }
  if (password !== confirm) {
    throw Object.assign(new Error('match'), { code: 'match' });
  }
  const data = await api('/auth/register', {
    method: 'POST',
    body: { name, email, password, role: 'patient' },
    auth: false,
  });
  if (data.token) setToken(data.token);
  return saveSession(data.user);
}

async function resendVerification() {
  const email = state.auth.email.trim().toLowerCase();
  if (!email) throw Object.assign(new Error('required'), { code: 'required' });
  return api('/auth/resend-verification', {
    method: 'POST',
    body: { email },
    auth: false,
  });
}

async function verifySession() {
  const token = getToken();
  const cached = getSession();
  if (!token || !cached) return null;
  state.session = cached;
  try {
    const { user } = await apiGet('/auth/me');
    if (user?.role && user.role !== 'patient') {
      clearSession();
      return null;
    }
    return saveSession(user);
  } catch (error) {
    if ([401, 403].includes(error.status)) clearSession();
    return getSession();
  }
}

function normalizeExercise(raw, over = {}) {
  return normalizePatientExercise(raw, over, byId);
}

function normalizeReferences(raw) {
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.filter((ref) => ref?.exerciseId).map((ref) => [ref.exerciseId, ref]));
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function normalizePlan(raw, references = state.references) {
  if (!raw?.items?.length) return { items: [] };
  const items = raw.items
    .map((item) => {
      const ex = normalizeExercise(item.exercise || { id: item.exerciseId }, item);
      const reference = references[ex.id] || null;
      return ex.id ? { ...item, exercise: { ...ex, reference }, exerciseId: ex.id, reference } : null;
    })
    .filter(Boolean);
  return { ...raw, items };
}

function toMs(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const date = Number(new Date(value));
  return Number.isFinite(date) ? date : 0;
}

async function loadCloudData() {
  state.loadError = null;
  try {
    const [plan, sessions, references] = await Promise.all([
      apiGet('/plans'),
      apiGet('/sessions'),
      apiGet('/references'),
    ]);
    state.references = normalizeReferences(references);
    state.plan = normalizePlan(plan, state.references);
    state.sessions = Array.isArray(sessions) ? sessions.map((session) => ({ ...session, endedAt: toMs(session.endedAt) })) : [];
  } catch (error) {
    state.loadError = error;
    state.plan = { items: [] };
    state.sessions = [];
    state.references = {};
  }
}

function scoreTone(score) {
  if (score >= 75) return colors.good;
  if (score >= 50) return colors.warn;
  return colors.bad;
}

function iconSvg(done = false) {
  if (done) {
    return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 12.5l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}

function scoreRing(value, size = 68) {
  const thickness = 7;
  const radius = (size - thickness) / 2;
  const c = Math.PI * 2 * radius;
  const offset = c * (1 - Math.max(0, Math.min(1, value / 100)));
  const col = scoreTone(value);
  return `
    <div class="score-ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}">
        <g transform="rotate(-90 ${size / 2} ${size / 2})">
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${colors.line}" stroke-width="${thickness}"></circle>
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${col}" stroke-width="${thickness}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle>
        </g>
      </svg>
      <span class="score-value">${value}</span>
    </div>
  `;
}

function completedPlanIds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const dayStart = start.getTime();
  return new Set(state.sessions
    .filter((session) => session.endedAt >= dayStart && session.kind !== 'extra')
    .map((session) => session.exerciseId));
}

function decorateResponsive(screen) {
  const phone = app.firstElementChild;
  if (!phone) return;
  app.dataset.screen = screen;
  const stage = document.createElement('section');
  stage.className = `web-stage is-${screen}`;
  app.innerHTML = '';
  stage.appendChild(phone);
  app.appendChild(stage);
}

function welcomeScreen() {
  app.innerHTML = `
    <section class="phone" data-screen="welcome">
      <div class="welcome-page">
        <button class="lang-chip" type="button">EN</button>
        <div class="welcome-hero">
          <div class="logo-mark" aria-hidden="true">
            <span></span>
          </div>
          <h1>Physio<span>AI</span></h1>
          <p>ผู้ช่วยฝึกกายภาพสำหรับผู้ป่วย</p>
        </div>
        <div class="welcome-actions">
          <button class="primary-button" data-action="login">เข้าสู่ระบบ</button>
          <button class="ghost-button" data-action="register">สร้างบัญชี</button>
        </div>
      </div>
    </section>
  `;
  decorateResponsive('welcome');
}

function authField(label, key, type, placeholder) {
  const value = state.auth[key] || '';
  return `
    <label class="auth-field">
      <span>${label}</span>
      <input class="auth-input" name="${key}" data-auth-field="${key}" type="${type}" value="${escapeAttr(value)}" placeholder="${placeholder}" autocomplete="${type === 'password' ? 'current-password' : type}" />
    </label>
  `;
}

function authScreen(mode) {
  const isRegister = mode === 'register';
  app.innerHTML = `
    <section class="phone" data-screen="${mode}">
      <form class="auth-page" data-auth-form="${mode}">
        <button class="back-button" type="button" data-action="welcome">‹ ย้อนกลับ</button>
        <div class="auth-logo-wrap"><div class="logo-mark small" aria-hidden="true"><span></span></div></div>
        <h1 class="auth-title">${isRegister ? 'สร้างบัญชีผู้ป่วย' : 'เข้าสู่ระบบ'}</h1>
        <p class="auth-sub">${isRegister ? 'ใช้บัญชีนี้เพื่อรับแผนจากนักกายภาพ' : 'เข้าสู่ระบบเพื่อดูแผนของคุณ'}</p>

        <div class="form">
          ${isRegister ? authField('ชื่อ-นามสกุล', 'name', 'text', 'ชื่อของคุณ') : ''}
          ${authField('อีเมล', 'email', 'email', 'you@email.com')}
          ${authField('รหัสผ่าน', 'password', 'password', '••••••••')}
          ${isRegister ? authField('ยืนยันรหัสผ่าน', 'confirm', 'password', '••••••••') : ''}
          ${state.auth.error ? `<p class="auth-error">${state.auth.error}</p>` : ''}
          ${state.auth.info ? `<p class="auth-info">${state.auth.info}</p>` : ''}
          <button class="primary-button" type="submit" ${state.auth.busy ? 'disabled' : ''}>${state.auth.busy ? 'กำลังดำเนินการ...' : (isRegister ? 'สร้างบัญชี' : 'เข้าสู่ระบบ')}</button>
        </div>

        <div class="auth-switch">
          ${isRegister
            ? 'มีบัญชีอยู่แล้ว? <button type="button" data-action="login">เข้าสู่ระบบ</button>'
            : 'ยังไม่มีบัญชี? <button type="button" data-action="register">สร้างบัญชี</button>'}
        </div>
      </form>
    </section>
  `;
  decorateResponsive(mode);
}

function verifyEmailScreen() {
  app.innerHTML = `
    <section class="phone" data-screen="verify">
      <div class="auth-page">
        <button class="back-button" type="button" data-action="login">‹ เข้าสู่ระบบ</button>
        <div class="auth-logo-wrap"><div class="logo-mark small" aria-hidden="true"><span></span></div></div>
        <h1 class="auth-title">ยืนยันอีเมล</h1>
        <p class="auth-sub">เราได้ส่งลิงก์ verify ไปที่อีเมลนี้แล้ว</p>
        <div class="verify-box">${state.auth.email || 'you@email.com'}</div>
        ${state.auth.error ? `<p class="auth-error">${state.auth.error}</p>` : ''}
        ${state.auth.info ? `<p class="auth-info">${state.auth.info}</p>` : ''}
        <button class="primary-button" data-action="login">กลับไปเข้าสู่ระบบ</button>
        <button class="ghost-button" data-action="resend-verification">ส่งลิงก์ใหม่</button>
      </div>
    </section>
  `;
  decorateResponsive('verify');
}

function exerciseRow(ex, kind = 'extra', done = false) {
  return `
    <button class="exercise-row" data-action="ready" data-id="${ex.id}" data-kind="${kind}">
      <span class="exercise-icon ${done ? 'done' : ''}">${iconSvg(done)}</span>
      <span>
        <p class="exercise-title">${ex.title}</p>
        <p class="exercise-dose">${ex.desc}</p>
      </span>
      <span class="chevron">›</span>
    </button>
  `;
}

function homeScreen() {
  const doneIds = completedPlanIds();
  const planItems = state.plan.items || [];
  const planIds = new Set(planItems.map((item) => item.exerciseId));
  const doneCount = planItems.filter((item) => doneIds.has(item.exerciseId)).length;
  const regularExtras = builtins.filter((ex) => !planIds.has(ex.id));
  const name = state.session?.name || state.session?.email?.split('@')[0] || 'Guest';
  app.innerHTML = `
    <section class="phone" data-screen="home">
      <div class="phone-scroll">
        <header class="home-header">
          <div class="brand">Physio<span>AI</span></div>
          <button class="text-button" data-action="logout">ออกจากระบบ</button>
        </header>
        <p class="greeting">สวัสดี, ${name}</p>
        ${state.loadError ? `<div class="error-box">${authMessage(state.loadError)}</div>` : ''}

        ${!state.loadError && planItems.length ? `
          <section class="progress-card">
            <div class="progress-card-top">
              <span class="progress-label">ความคืบหน้าวันนี้</span>
              <span class="progress-count">${doneCount}/${planItems.length} วันนี้</span>
            </div>
            <div class="track"><div class="track-fill" style="width:${(doneCount / planItems.length) * 100}%"></div></div>
          </section>
        ` : ''}

        <h2 class="section-title">แผนของฉัน</h2>
        ${state.loadError ? '' : planItems.length
          ? `<div class="exercise-list">${planItems.map((item) => exerciseRow(item.exercise, 'plan', doneIds.has(item.exerciseId))).join('')}</div>`
          : '<p class="empty-text">ยังไม่มีแผนจากนักกายภาพ</p>'}

        <h2 class="section-title">ท่าเสริม</h2>
        <p class="section-hint">ทำเสริมได้ · ไม่นับในการรักษา</p>
        <div class="exercise-list">${regularExtras.map((ex) => exerciseRow(ex)).join('')}</div>
      </div>
    </section>
  `;
  decorateResponsive('home');
}

function readyScreen() {
  const ex = state.exercise;
  const reference = referenceForExercise(ex, state.references);
  const canPractice = isUsablePracticeReference(reference, ex);
  app.innerHTML = `
    <section class="phone" data-screen="ready">
      <div class="ready-page">
        <button class="back-button" data-action="home">‹ ย้อนกลับ</button>
        <span class="mode-pill">โหมดผู้ป่วย</span>
        <h1 class="ready-title">${ex.title}</h1>
        <p class="ready-sub">${ex.source === 'custom' ? 'ท่าที่นักกายภาพสร้างเอง' : 'ฝึกตามแผนพร้อมคำแนะนำบนหน้าจอ'}</p>

        <section class="info-card">
          <div class="info-row"><span>เป้าหมาย</span><strong>${ex.target}°</strong></div>
          <div class="info-row"><span>จำนวน</span><strong>${ex.reps} ครั้ง · ${ex.sets} เซ็ต</strong></div>
          <div class="info-row"><span>ท่าอ้างอิง</span><strong>${canPractice ? 'พร้อมจาก therapist' : 'รอ therapist'}</strong></div>
          <div class="info-row"><span>Body region</span><strong>${ex.bodyRegionLabel || ex.bodyRegion}</strong></div>
        </section>
        ${canPractice ? '' : '<p class="empty-text">ยังไม่มี motion reference สำหรับท่านี้ ให้ therapist บันทึก reference ก่อน</p>'}

        <div class="ready-spacer"></div>
        <p class="perm-hint">จัดพื้นที่รอบตัวให้พร้อมก่อนเริ่ม</p>
        <button class="primary-button" data-action="practice" ${canPractice ? '' : 'disabled'}>เริ่มฝึก</button>
        <button class="ghost-button" data-action="summary" ${state.lastSummary ? '' : 'disabled'}>ดูสรุปผล</button>
      </div>
    </section>
  `;
  decorateResponsive('ready');
}

function setPracticeStatus(text) {
  const node = app.querySelector('[data-practice-status]');
  if (node) node.textContent = text;
}

function updatePracticeScore(score, cue = null) {
  const scoreNode = app.querySelector('[data-practice-score]');
  const textNode = app.querySelector('[data-practice-score-text]');
  if (scoreNode) scoreNode.innerHTML = scoreRing(Number(score) || 0);
  if (textNode) textNode.textContent = `${Math.round(Number(score) || 0)}%`;
  const cueNode = app.querySelector('[data-practice-cue]');
  if (cueNode && cue) cueNode.textContent = cue;
}

function resizePracticeCanvas() {
  const canvas = practiceRuntime.canvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
}

function updatePracticeFrameUi(ex, snapshot, liveAngles) {
  const score = Math.round(Number(snapshot?.overallScore) || 0);
  const targetCount = Math.max(1, Number(ex.reps || 1) * Number(ex.sets || 1));
  const repNode = app.querySelector('[data-practice-reps]');
  if (repNode) {
    repNode.textContent = snapshot.kind === 'hold_pose'
      ? `ค้างอยู่ · คะแนน ${score}%`
      : `ทำได้ ${snapshot.reps || 0}/${targetCount} ครั้ง · valid ${snapshot.validReps || 0}`;
  }
  const angleNode = app.querySelector('[data-practice-angle]');
  const joint = overlayJointsForExercise(ex)[0];
  if (angleNode) angleNode.textContent = `${Math.round(liveAngles?.[joint] ?? ex.angle ?? 0)}° / ${ex.target}°`;
  const formNode = app.querySelector('[data-practice-form]');
  if (formNode) {
    const label = score >= 70 ? 'ฟอร์มดี' : score >= 50 ? 'ต้องปรับเล็กน้อย' : 'ควรปรับท่า';
    formNode.textContent = `ฟอร์ม: ${label}`;
    formNode.style.color = scoreTone(score);
  }
  const segments = app.querySelectorAll('[data-practice-progress] span');
  const progress = Math.round(((snapshot.reps || 0) / targetCount) * segments.length);
  segments.forEach((seg, index) => seg.className = index < progress ? 'done' : '');
  updatePracticeScore(score, snapshot.cue?.text);
}

function clearPracticeRuntime() {
  if (practiceRuntime.raf) cancelAnimationFrame(practiceRuntime.raf);
  practiceRuntime.raf = 0;
  practiceRuntime.running = false;
  if (practiceRuntime.video) stopCamera(practiceRuntime.video);
  practiceRuntime.video = null;
  practiceRuntime.canvas = null;
  practiceRuntime.drawer = null;
  practiceRuntime.motionEngine = null;
  practiceRuntime.frameProcessor = null;
  practiceRuntime.reference = null;
  practiceRuntime.snapshot = null;
  practiceRuntime.boundaryFrame = null;
  practiceRuntime.lastVideoTime = -1;
  practiceRuntime.startedAt = 0;
  practiceRuntime.frameCount = 0;
  practiceRuntime.exerciseId = null;
}

async function startLivePractice(ex) {
  clearPracticeRuntime();
  const reference = referenceForExercise(ex, state.references);
  if (!isUsablePracticeReference(reference, ex)) {
    setPracticeStatus('ยังไม่มี reference จากนักกายภาพ');
    return;
  }
  const video = app.querySelector('[data-practice-video]');
  const canvas = app.querySelector('[data-practice-overlay]');
  if (!video || !canvas) return;
  practiceRuntime.video = video;
  practiceRuntime.canvas = canvas;
  practiceRuntime.drawer = makeDrawer(canvas.getContext('2d'));
  practiceRuntime.motionEngine = createMotionQualityEngine({
    exercise: ex,
    reference,
    dose: practiceDose(ex),
    lang: 'th',
  });
  practiceRuntime.frameProcessor = createPracticeFrameProcessor({
    exercise: ex,
    reference,
    motionEngine: practiceRuntime.motionEngine,
  });
  practiceRuntime.reference = reference;
  practiceRuntime.exerciseId = ex.id;
  practiceRuntime.startedAt = Date.now();
  resizePracticeCanvas();
  setPracticeStatus('กำลังเปิดกล้อง...');
  try {
    await startCamera(video, { facingMode: 'user' });
    if (state.screen !== 'practice' || practiceRuntime.exerciseId !== ex.id) {
      stopCamera(video);
      return;
    }
    if (!poseEngine.state.ready) await poseEngine.init('full');
    if (state.screen !== 'practice' || practiceRuntime.exerciseId !== ex.id) {
      stopCamera(video);
      return;
    }
    practiceRuntime.running = true;
    setPracticeStatus('ขยับตาม reference ได้เลย');
    practiceRuntime.raf = requestAnimationFrame(() => practiceLoop(ex));
  } catch {
    setPracticeStatus('เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้อง');
  }
}

function practiceLoop(ex) {
  if (!practiceRuntime.running || state.screen !== 'practice') return;
  const video = practiceRuntime.video;
  if (poseEngine.state.ready && video && video.currentTime !== practiceRuntime.lastVideoTime) {
    practiceRuntime.lastVideoTime = video.currentTime;
    const result = poseEngine.detectVideo(video, performance.now());
    processPracticeFrame(ex, result?.landmarks?.[0] || null);
  }
  practiceRuntime.raf = requestAnimationFrame(() => practiceLoop(ex));
}

function processPracticeFrame(ex, landmarks) {
  const canvas = practiceRuntime.canvas;
  const ctx = canvas?.getContext('2d');
  if (!ctx || !practiceRuntime.frameProcessor) return;
  resizePracticeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const result = practiceRuntime.frameProcessor.processPracticeFrame({
    landmarks,
    previousBoundaryFrame: practiceRuntime.boundaryFrame,
    timestamp: performance.now(),
  });
  practiceRuntime.boundaryFrame = result.nextBoundaryFrame;
  if (!result.hasPose) {
    drawBoundaryBox(ctx, result.boundary);
    setPracticeStatus('ถอยออกเพื่อให้เห็นตัวคุณ');
    return;
  }
  const { boundary, liveAngles, snapshot, overlayJoints, ghostLandmarks } = result;
  if (!snapshot) return;
  practiceRuntime.snapshot = snapshot;
  practiceRuntime.frameCount += 1;
  if (ghostLandmarks) practiceRuntime.drawer(ghostLandmarks, { ghost: true });
  practiceRuntime.drawer(landmarks, {
    color: scoreTone(snapshot.overallScore || 0),
    accent: snapshot.overallScore >= 50 ? colors.brand : colors.bad,
  });
  drawBoundaryBox(ctx, boundary);
  drawAngleOverlayForJoints(ctx, landmarks, liveAngles, overlayJoints, { lang: 'th' });
  setPracticeStatus(boundary.status === 'inside' ? `${landmarks.length} pts · ${snapshot.phase}` : boundary.hintTh || boundary.hint);
  updatePracticeFrameUi(ex, snapshot, liveAngles);
}

function finishLivePracticeSession() {
  if (!practiceRuntime.motionEngine) return null;
  const summary = practiceRuntime.motionEngine.finishSummary();
  const run = {
    exercise: state.exercise,
    reference: practiceRuntime.reference,
    snapshot: practiceRuntime.snapshot,
    summary,
    frameCount: practiceRuntime.frameCount,
    startedAt: practiceRuntime.startedAt,
  };
  state.practiceRun = run;
  clearPracticeRuntime();
  return run;
}

function practiceScreen() {
  const ex = state.exercise;
  const reference = referenceForExercise(ex, state.references);
  if (!isUsablePracticeReference(reference, ex)) {
    app.innerHTML = `
      <section class="phone" data-screen="ready">
        <div class="ready-page">
          <button class="back-button" data-action="ready" data-id="${ex.id}">‹ ย้อนกลับ</button>
          <span class="mode-pill">โหมดผู้ป่วย</span>
          <h1 class="ready-title">${ex.title}</h1>
          <p class="empty-text">ยังไม่มี reference จากนักกายภาพสำหรับท่านี้</p>
          <div class="ready-spacer"></div>
          <button class="primary-button" data-action="home">กลับหน้าแรก</button>
        </div>
      </section>
    `;
    decorateResponsive('ready');
    return;
  }
  const angle = practiceAngle(ex, state.references);
  app.innerHTML = `
    <section class="phone" data-screen="practice">
      <div class="practice">
        <div class="camera-layer">
          <video class="practice-video" data-practice-video autoplay muted playsinline></video>
          <div class="camera-placeholder visible" data-practice-status>กำลังเปิดกล้อง...</div>
          <div class="room-lines"></div>
        </div>
        <canvas class="practice-overlay-canvas" data-practice-overlay></canvas>
        <div class="hud">
          <div class="hud-top">
            <button class="glass-pill" data-action="ready" data-id="${ex.id}">‹ ${ex.title}</button>
            <button class="glass-pill" data-action="summary">สรุป</button>
          </div>
          <div class="rep-area">
            <div class="segmented-track" data-practice-progress>${Array.from({ length: 8 }, () => '<span></span>').join('')}</div>
            <div class="rep-label" data-practice-reps">เริ่มจากท่าพัก · เซ็ต 1/${ex.sets}</div>
            <div class="chip-row">
              <span class="metric-chip" data-practice-angle>${angle}° / ${ex.target}°</span>
              <span class="form-chip" data-practice-form style="color:${colors.ink2}">ฟอร์ม: รอ pose</span>
            </div>
          </div>
          <div class="hud-spacer"></div>
          <section class="cue-card">
            <p class="cue-eyebrow">คำแนะนำ</p>
            <p class="cue-text" data-practice-cue style="color:${colors.ink}">เข้ากรอบกล้องก่อน</p>
          </section>
          <section class="score-card">
            <div data-practice-score>${scoreRing(0)}</div>
            <div>
              <p class="score-eyebrow">ความแม่นยำ</p>
              <p class="score-text" data-practice-score-text>0%</p>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
  decorateResponsive('practice');
  void startLivePractice(ex);
}

async function completePracticeSession() {
  const run = state.screen === 'practice'
    ? finishLivePracticeSession()
    : state.practiceRun;
  if (!run) {
    state.screen = 'ready';
    return;
  }
  const endedAt = Date.now();
  const summary = run.summary;
  const payload = buildPracticeSessionPayload({
    exercise: state.exercise,
    planItems: state.plan.items,
    summary,
    endedAt,
  });
  try {
    const saved = await apiPost('/sessions', payload);
    state.lastSummary = { ...payload, ...saved, endedAt: toMs(saved.endedAt ?? endedAt) };
  } catch {
    state.lastSummary = payload;
  }
  state.sessions = [
    state.lastSummary,
    ...state.sessions.filter((session) => session.id !== state.lastSummary.id),
  ];
  state.screen = 'summary';
}

function summaryScreen() {
  const session = state.lastSummary || state.practiceRun && {
    exerciseId: state.exercise.id,
    score: state.practiceRun.summary.overallScore,
    summary: state.practiceRun.summary,
  };
  const summary = session?.summary || {};
  const metrics = summaryMetrics({ summary, session });
  app.innerHTML = `
    <section class="phone" data-screen="summary">
      <div class="summary-page">
        <button class="back-button" data-action="home">‹ หน้าแรก</button>
        <section class="summary-hero">
          ${scoreRing(metrics.score, 100)}
          <div>
            <h1 class="summary-title">จบเซสชันแล้ว เยี่ยมมาก</h1>
            <p class="summary-sub">คะแนนรวมของท่านี้</p>
          </div>
        </section>
        <div class="metric-grid">
          <div class="metric-card"><span>รวม</span><strong>${metrics.score}%</strong></div>
          <div class="metric-card"><span>ท่าทาง</span><strong>${metrics.poseScore}%</strong></div>
          <div class="metric-card"><span>Motion</span><strong>${metrics.motionScore}%</strong></div>
          <div class="metric-card"><span>Valid</span><strong>${metrics.validLabel}</strong></div>
        </div>
        <div class="ready-spacer"></div>
        <button class="primary-button" data-action="practice">กลับหน้าฝึก</button>
      </div>
    </section>
  `;
  decorateResponsive('summary');
}

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function updateAuthField(input) {
  state.auth[input.dataset.authField] = input.value;
}

async function submitAuth(mode) {
  state.auth.error = '';
  state.auth.info = '';
  state.auth.busy = true;
  render();
  try {
    if (mode === 'login') await loginPatient();
    else await registerPatient();
    await loadCloudData();
    state.screen = 'home';
  } catch (error) {
    if (mode === 'register' && error.code === 'email_confirmation_required') {
      state.screen = 'verify';
      state.auth.info = authMessage(error);
    } else if (error.code === 'match') {
      state.auth.error = 'รหัสผ่านไม่ตรงกัน';
    } else if (mode === 'login' && error.code === 'email_confirmation_required') {
      state.auth.error = authMessage('email_not_verified');
    } else {
      state.auth.error = authMessage(error);
    }
  } finally {
    state.auth.busy = false;
    render();
  }
}

async function route(action, target) {
  if (target?.matches?.('[data-auth-field]')) updateAuthField(target);
  const leavingPractice = state.screen === 'practice' && action !== 'summary';
  if (leavingPractice) clearPracticeRuntime();

  if (action === 'welcome') state.screen = 'welcome';
  if (action === 'login') {
    state.auth.error = '';
    state.auth.info = '';
    state.screen = 'login';
  }
  if (action === 'register') {
    state.auth.error = '';
    state.auth.info = '';
    state.screen = 'register';
  }
  if (action === 'logout') {
    clearPracticeRuntime();
    clearSession();
    state.plan = { items: [] };
    state.sessions = [];
    state.references = {};
    state.practiceRun = null;
    state.lastSummary = null;
    state.screen = 'welcome';
  }
  if (action === 'home') {
    if (!state.session) state.screen = 'welcome';
    else {
      state.screen = 'home';
      render();
      await loadCloudData();
    }
  }
  if (action === 'ready') {
    const id = target.dataset.id;
    const planItem = state.plan.items.find((item) => item.exerciseId === id);
    const base = planItem?.exercise || byId.get(id) || state.exercise;
    state.exercise = { ...base, reference: referenceForExercise(base, state.references) };
    state.practiceRun = null;
    state.screen = 'ready';
  }
  if (action === 'practice') {
    if (!isUsablePracticeReference(referenceForExercise(state.exercise, state.references), state.exercise)) state.screen = 'ready';
    else state.screen = 'practice';
  }
  if (action === 'summary') {
    if (state.screen === 'practice') await completePracticeSession();
    else if (state.lastSummary) state.screen = 'summary';
  }
  if (action === 'resend-verification') {
    state.auth.error = '';
    state.auth.info = '';
    try {
      await resendVerification();
      state.auth.info = 'ส่งลิงก์ยืนยันใหม่แล้ว กรุณาเช็กอีเมล';
    } catch (error) {
      state.auth.error = authMessage(error);
    }
  }
  render();
}

function render() {
  if (state.screen === 'welcome') welcomeScreen();
  if (state.screen === 'login') authScreen('login');
  if (state.screen === 'register') authScreen('register');
  if (state.screen === 'verify') verifyEmailScreen();
  if (state.screen === 'home') homeScreen();
  if (state.screen === 'ready') readyScreen();
  if (state.screen === 'practice') practiceScreen();
  if (state.screen === 'summary') summaryScreen();
}

app.addEventListener('input', (event) => {
  if (event.target.matches('[data-auth-field]')) updateAuthField(event.target);
});

app.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-auth-form]');
  if (!form) return;
  event.preventDefault();
  submitAuth(form.dataset.authForm);
});

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  route(target.dataset.action, target);
});

window.addEventListener('resize', () => {
  if (state.screen === 'practice') resizePracticeCanvas();
});

window.addEventListener('beforeunload', () => {
  clearPracticeRuntime();
  poseEngine.close();
});

(async function boot() {
  render();
  const session = await verifySession();
  if (session) {
    state.screen = 'home';
    render();
    await loadCloudData();
  }
  render();
}());
