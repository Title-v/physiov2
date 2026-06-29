import { isUsablePracticeReference } from '../../shared/ai/MotionQualityEngine.js';
import { summaryMetrics } from '../../shared/practice/session.js';
import {
  overlayJointsForExercise,
  practiceAngle,
  referenceForExercise,
} from '../../shared/core/patient-exercises.js';

export const colors = Object.freeze({
  line: '#E5DFD3',
  ink: '#1F2937',
  ink2: '#6B7280',
  ink3: '#9CA3AF',
  inverse: '#FBFAF5',
  brand: '#2F5D50',
  good: '#2F5D50',
  warn: '#9C7344',
  bad: '#8C4F40',
});

export function scoreTone(score) {
  if (score >= 75) return colors.good;
  if (score >= 50) return colors.warn;
  return colors.bad;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export const escapeAttr = escapeHtml;

export function scoreRing(value, size = 68) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const thickness = 7;
  const radius = (size - thickness) / 2;
  const c = Math.PI * 2 * radius;
  const offset = c * (1 - safeValue / 100);
  const col = scoreTone(safeValue);
  return `
    <div class="score-ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}">
        <g transform="rotate(-90 ${size / 2} ${size / 2})">
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${colors.line}" stroke-width="${thickness}"></circle>
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${col}" stroke-width="${thickness}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle>
        </g>
      </svg>
      <span class="score-value">${Math.round(safeValue)}</span>
    </div>
  `;
}

export function completedPlanIdsForDate(sessions = [], now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dayStart = start.getTime();
  return new Set(sessions
    .filter((session) => session.endedAt >= dayStart && session.kind !== 'extra')
    .map((session) => session.exerciseId));
}

function iconSvg(done = false) {
  if (done) {
    return '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 12.5l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
}

export function createPatientScreenRenderer({
  app,
  state,
  builtins = [],
  authMessage = () => '',
  startLivePractice = () => {},
} = {}) {
  if (!app || !state) throw new Error('patient_screen_renderer_requires_app_and_state');

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
            ${state.auth.error ? `<p class="auth-error">${escapeHtml(state.auth.error)}</p>` : ''}
            ${state.auth.info ? `<p class="auth-info">${escapeHtml(state.auth.info)}</p>` : ''}
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
          <div class="verify-box">${escapeHtml(state.auth.email || 'you@email.com')}</div>
          ${state.auth.error ? `<p class="auth-error">${escapeHtml(state.auth.error)}</p>` : ''}
          ${state.auth.info ? `<p class="auth-info">${escapeHtml(state.auth.info)}</p>` : ''}
          <button class="primary-button" data-action="login">กลับไปเข้าสู่ระบบ</button>
          <button class="ghost-button" data-action="resend-verification">ส่งลิงก์ใหม่</button>
        </div>
      </section>
    `;
    decorateResponsive('verify');
  }

  function exerciseRow(ex, kind = 'extra', done = false) {
    return `
      <button class="exercise-row" data-action="ready" data-id="${escapeAttr(ex.id)}" data-kind="${kind}">
        <span class="exercise-icon ${done ? 'done' : ''}">${iconSvg(done)}</span>
        <span>
          <p class="exercise-title">${escapeHtml(ex.title)}</p>
          <p class="exercise-dose">${escapeHtml(ex.desc)}</p>
        </span>
        <span class="chevron">›</span>
      </button>
    `;
  }

  function homeScreen() {
    const doneIds = completedPlanIdsForDate(state.sessions);
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
          <p class="greeting">สวัสดี, ${escapeHtml(name)}</p>
          ${state.loadError ? `<div class="error-box">${escapeHtml(authMessage(state.loadError))}</div>` : ''}

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
          <h1 class="ready-title">${escapeHtml(ex.title)}</h1>
          <p class="ready-sub">${ex.source === 'custom' ? 'ท่าที่นักกายภาพสร้างเอง' : 'ฝึกตามแผนพร้อมคำแนะนำบนหน้าจอ'}</p>

          <section class="info-card">
            <div class="info-row"><span>เป้าหมาย</span><strong>${ex.target}°</strong></div>
            <div class="info-row"><span>จำนวน</span><strong>${ex.reps} ครั้ง · ${ex.sets} เซ็ต</strong></div>
            <div class="info-row"><span>ท่าอ้างอิง</span><strong>${canPractice ? 'พร้อมจาก therapist' : 'รอ therapist'}</strong></div>
            <div class="info-row"><span>Body region</span><strong>${escapeHtml(ex.bodyRegionLabel || ex.bodyRegion)}</strong></div>
            ${ex.setupInstruction ? `<div class="info-row"><span>กล้อง</span><strong>${escapeHtml(ex.setupInstruction)}</strong></div>` : ''}
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
    segments.forEach((seg, index) => { seg.className = index < progress ? 'done' : ''; });
    updatePracticeScore(score, snapshot.cue?.text);
  }

  function practiceScreen() {
    const ex = state.exercise;
    const reference = referenceForExercise(ex, state.references);
    if (!isUsablePracticeReference(reference, ex)) {
      app.innerHTML = `
        <section class="phone" data-screen="ready">
          <div class="ready-page">
            <button class="back-button" data-action="ready" data-id="${escapeAttr(ex.id)}">‹ ย้อนกลับ</button>
            <span class="mode-pill">โหมดผู้ป่วย</span>
            <h1 class="ready-title">${escapeHtml(ex.title)}</h1>
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
              <button class="glass-pill" data-action="ready" data-id="${escapeAttr(ex.id)}">‹ ${escapeHtml(ex.title)}</button>
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

  function summaryScreen() {
    const session = state.lastSummary || (state.practiceRun && {
      exerciseId: state.exercise.id,
      score: state.practiceRun.summary.overallScore,
      summary: state.practiceRun.summary,
    });
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

  function render() {
    if (state.screen === 'welcome') welcomeScreen();
    else if (state.screen === 'login') authScreen('login');
    else if (state.screen === 'register') authScreen('register');
    else if (state.screen === 'verify') verifyEmailScreen();
    else if (state.screen === 'home') homeScreen();
    else if (state.screen === 'ready') readyScreen();
    else if (state.screen === 'practice') practiceScreen();
    else if (state.screen === 'summary') summaryScreen();
  }

  return {
    render,
    setPracticeStatus,
    updatePracticeFrameUi,
    decorateResponsive,
    scoreRing,
  };
}
