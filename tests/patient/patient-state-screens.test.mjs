import test from 'node:test';
import assert from 'node:assert/strict';
import { PATIENT_EXERCISES } from '../../shared/core/patient-exercises.js';
import { createPatientAppState, clearPatientAuthMessages, resetPatientSessionData } from '../../apps/patient/patientState.js';
import {
  completedPlanIdsForDate,
  escapeHtml,
  scoreRing,
  scoreTone,
} from '../../apps/patient/patientScreens.js';

test('createPatientAppState starts with patient defaults and first built-in exercise', () => {
  const state = createPatientAppState();
  assert.equal(state.screen, 'welcome');
  assert.equal(state.exercise, PATIENT_EXERCISES[0]);
  assert.deepEqual(state.plan, { items: [] });
  assert.deepEqual(state.auth, { name: '', email: '', password: '', confirm: '', error: '', info: '', busy: false });
});

test('patient state reset clears session-scoped patient data without touching auth fields', () => {
  const state = createPatientAppState();
  state.plan = { items: [{ exerciseId: 'shoulder' }] };
  state.sessions = [{ id: 's1' }];
  state.references = { shoulder: {} };
  state.practiceRun = { summary: {} };
  state.lastSummary = { id: 's1' };
  state.loadError = new Error('offline');
  state.auth.email = 'patient@example.com';
  state.auth.error = 'bad';
  state.auth.info = 'info';

  clearPatientAuthMessages(state);
  resetPatientSessionData(state);

  assert.deepEqual(state.plan, { items: [] });
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(state.references, {});
  assert.equal(state.practiceRun, null);
  assert.equal(state.lastSummary, null);
  assert.equal(state.loadError, null);
  assert.equal(state.auth.email, 'patient@example.com');
  assert.equal(state.auth.error, '');
  assert.equal(state.auth.info, '');
});

test('completedPlanIdsForDate counts only today plan sessions', () => {
  const now = new Date('2026-06-29T15:00:00+07:00');
  const today = new Date(now);
  today.setHours(9, 0, 0, 0);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const ids = completedPlanIdsForDate([
    { exerciseId: 'shoulder', endedAt: today.getTime(), kind: 'plan' },
    { exerciseId: 'knee', endedAt: today.getTime(), kind: 'extra' },
    { exerciseId: 'hip', endedAt: yesterday.getTime(), kind: 'plan' },
  ], now);

  assert.deepEqual([...ids], ['shoulder']);
});

test('patient screen helpers escape user content and clamp score rings', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(scoreTone(80), '#2F5D50');
  assert.equal(scoreTone(60), '#9C7344');
  assert.equal(scoreTone(20), '#8C4F40');

  const ring = scoreRing(140, 80);
  assert.match(ring, /score-value">100<\/span>/);
  assert.match(ring, /width:80px;height:80px/);
});
