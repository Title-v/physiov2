import { PATIENT_EXERCISES } from '../../shared/core/patient-exercises.js';

export function createPatientAppState({
  initialScreen = 'welcome',
  initialExercise = PATIENT_EXERCISES[0],
} = {}) {
  return {
    screen: initialScreen,
    session: null,
    exercise: initialExercise,
    plan: { items: [] },
    sessions: [],
    references: {},
    practiceRun: null,
    lastSummary: null,
    loadError: null,
    auth: { name: '', email: '', password: '', confirm: '', error: '', info: '', busy: false },
  };
}

export function clearPatientAuthMessages(state) {
  if (!state?.auth) return;
  state.auth.error = '';
  state.auth.info = '';
}

export function resetPatientSessionData(state) {
  if (!state) return;
  state.plan = { items: [] };
  state.sessions = [];
  state.references = {};
  state.practiceRun = null;
  state.lastSummary = null;
  state.loadError = null;
}
