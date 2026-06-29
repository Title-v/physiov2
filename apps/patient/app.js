import {
  PATIENT_EXERCISES,
  PATIENT_EXERCISE_BY_ID,
  referenceForExercise,
} from '../../shared/core/patient-exercises.js';
import { isUsablePracticeReference } from '../../shared/ai/MotionQualityEngine.js';
import { createPatientPracticeRuntime } from './practiceRuntime.js';
import { savePracticeSession } from './sessionSync.js';
import { createPatientAppState, clearPatientAuthMessages, patientAllowsDemoExtras, resetPatientSessionData } from './patientState.js';
import {
  authMessage,
  clearPatientSession,
  createPatientAuthClient,
  loadPatientCloudData,
  loginPatient,
  registerPatient,
  resendPatientVerification,
  savePatientSession,
  verifyPatientSession,
} from './patientApi.js';
import { colors, createPatientScreenRenderer, scoreTone } from './patientScreens.js';

const builtins = PATIENT_EXERCISES;
const byId = PATIENT_EXERCISE_BY_ID;
const state = createPatientAppState();
const patientAuth = createPatientAuthClient();
const app = document.querySelector('#app');

const renderer = createPatientScreenRenderer({
  app,
  state,
  builtins,
  authMessage,
  startLivePractice,
});

const practiceRuntime = createPatientPracticeRuntime({
  colors,
  scoreTone,
  isActive: (exercise) => state.screen === 'practice' && state.exercise?.id === exercise?.id,
  onStatus: renderer.setPracticeStatus,
  onFrame: ({ exercise, snapshot, liveAngles }) => renderer.updatePracticeFrameUi(exercise, snapshot, liveAngles),
});

const poseEngine = practiceRuntime.poseEngine;

async function loadCloudData() {
  Object.assign(state, await loadPatientCloudData());
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
    const session = mode === 'login'
      ? await loginPatient(patientAuth, state.auth)
      : await registerPatient(patientAuth, state.auth);
    savePatientSession(state, patientAuth, session);
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

function clearPracticeRuntime() {
  practiceRuntime.stop();
}

async function startLivePractice(ex) {
  const reference = referenceForExercise(ex, state.references);
  if (!isUsablePracticeReference(reference, ex)) {
    renderer.setPracticeStatus('ยังไม่มี reference จากนักกายภาพ');
    return;
  }
  const video = app.querySelector('[data-practice-video]');
  const canvas = app.querySelector('[data-practice-overlay]');
  if (!video || !canvas) return;
  await practiceRuntime.start({ exercise: ex, reference, video, canvas });
}

function finishLivePracticeSession() {
  const run = practiceRuntime.finish();
  if (!run) return null;
  state.practiceRun = run;
  return run;
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
  state.lastSummary = await savePracticeSession({
    exercise: state.exercise,
    planItems: state.plan.items,
    run,
    endedAt,
  });
  state.sessions = [
    state.lastSummary,
    ...state.sessions.filter((session) => session.id !== state.lastSummary.id),
  ];
  state.screen = 'summary';
}

async function route(action, target) {
  if (target?.matches?.('[data-auth-field]')) updateAuthField(target);
  const leavingPractice = state.screen === 'practice' && action !== 'summary';
  if (leavingPractice) clearPracticeRuntime();

  if (action === 'welcome') state.screen = 'welcome';
  if (action === 'login') {
    clearPatientAuthMessages(state);
    state.screen = 'login';
  }
  if (action === 'register') {
    clearPatientAuthMessages(state);
    state.screen = 'register';
  }
  if (action === 'logout') {
    clearPracticeRuntime();
    clearPatientSession(state, patientAuth);
    resetPatientSessionData(state);
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
    if (!planItem && !patientAllowsDemoExtras(state)) return;
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
      await resendPatientVerification(patientAuth, state.auth);
      state.auth.info = 'ส่งลิงก์ยืนยันใหม่แล้ว กรุณาเช็กอีเมล';
    } catch (error) {
      state.auth.error = authMessage(error);
    }
  }
  render();
}

function render() {
  renderer.render();
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
  if (state.screen === 'practice') practiceRuntime.resizeCanvas();
});

window.addEventListener('beforeunload', () => {
  clearPracticeRuntime();
  poseEngine.close();
});

(async function boot() {
  render();
  const session = await verifyPatientSession(patientAuth);
  state.session = session;
  if (session) {
    state.screen = 'home';
    render();
    await loadCloudData();
  }
  render();
}());
