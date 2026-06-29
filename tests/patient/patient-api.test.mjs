import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authMessage,
  clearPatientSession,
  loadPatientCloudData,
  loginPatient,
  normalizePlan,
  normalizeReferences,
  normalizeSessions,
  registerPatient,
  resendPatientVerification,
  savePatientSession,
  toMs,
} from '../../apps/patient/patientApi.js';

test('normalizeReferences maps reference arrays by exercise id', () => {
  const shoulder = { exerciseId: 'shoulder', kind: 'motion_cycle' };
  const knee = { exerciseId: 'knee', kind: 'motion_cycle' };
  assert.deepEqual(normalizeReferences([shoulder, {}, knee]), { shoulder, knee });
  assert.deepEqual(normalizeReferences({ balance: { kind: 'hold_pose' } }), { balance: { kind: 'hold_pose' } });
  assert.deepEqual(normalizeReferences(null), {});
});

test('normalizePlan attaches normalized exercises and references', () => {
  const reference = { exerciseId: 'shoulder', kind: 'motion_cycle', referenceSequence: { frames: [{ p: 0 }] } };
  const plan = normalizePlan({
    items: [
      { exerciseId: 'shoulder', reps: 8, sets: 2 },
      { exercise: { id: 'custom', title: 'Custom reach', source: 'custom', bodyRegion: 'right_arm' }, reps: 5 },
    ],
  }, { shoulder: reference });

  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].exercise.id, 'shoulder');
  assert.equal(plan.items[0].exercise.reps, 8);
  assert.equal(plan.items[0].reference, reference);
  assert.equal(plan.items[0].exercise.reference, reference);
  assert.equal(plan.items[1].exercise.source, 'custom');
});

test('normalizePlan preserves active AI model metadata from therapist plan snapshot', () => {
  const plan = normalizePlan({
    items: [{
      exercise: {
        id: 'custom_ai',
        title: 'Custom reach',
        source: 'custom',
        bodyRegion: 'right_arm',
        landmarkSchemaId: 'right_arm.v1',
        activeModelId: 'right_arm_tcn_v1',
        modelStatus: 'deployed',
        modelBaseUrl: '/shared/models/right_arm_tcn_v1',
      },
      reps: 5,
      sets: 2,
    }],
  });

  assert.equal(plan.items[0].exercise.activeModelId, 'right_arm_tcn_v1');
  assert.equal(plan.items[0].exercise.modelStatus, 'deployed');
  assert.equal(plan.items[0].exercise.modelBaseUrl, '/shared/models/right_arm_tcn_v1');
});

test('normalizeSessions converts persisted endedAt values to milliseconds', () => {
  assert.equal(toMs('1970-01-01T00:00:02.000Z'), 2000);
  assert.equal(toMs(3000), 3000);
  assert.deepEqual(normalizeSessions([{ id: 's1', endedAt: '1970-01-01T00:00:01.000Z' }]), [{ id: 's1', endedAt: 1000 }]);
  assert.deepEqual(normalizeSessions(null), []);
});

test('loadPatientCloudData normalizes plan sessions and references together', async () => {
  const calls = [];
  const reference = { exerciseId: 'shoulder', kind: 'motion_cycle' };
  const result = await loadPatientCloudData({
    get: async (path) => {
      calls.push(path);
      if (path === '/plans') return { items: [{ exerciseId: 'shoulder', reps: 6 }] };
      if (path === '/sessions') return [{ id: 's1', exerciseId: 'shoulder', endedAt: '1970-01-01T00:00:04.000Z' }];
      if (path === '/references') return [reference];
      throw new Error(path);
    },
  });

  assert.deepEqual(calls.sort(), ['/plans', '/references', '/sessions']);
  assert.equal(result.loadError, null);
  assert.equal(result.references.shoulder, reference);
  assert.equal(result.plan.items[0].exercise.reference, reference);
  assert.equal(result.sessions[0].endedAt, 4000);
});

test('loadPatientCloudData returns empty patient data on API failure', async () => {
  const result = await loadPatientCloudData({
    get: async () => { throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' }); },
  });

  assert.deepEqual(result.references, {});
  assert.deepEqual(result.plan, { items: [] });
  assert.deepEqual(result.sessions, []);
  assert.equal(result.loadError.code, 'unauthorized');
});

test('patient auth helpers validate input and call the role auth client', async () => {
  const calls = [];
  const auth = {
    login: async (payload) => {
      calls.push(['login', payload]);
      return { id: 'p1', email: payload.email, role: 'patient' };
    },
    register: async (payload) => {
      calls.push(['register', payload]);
      return { id: 'p2', email: payload.email, role: 'patient' };
    },
    resendVerification: async (email) => {
      calls.push(['resend', email]);
      return { ok: true };
    },
  };

  assert.equal((await loginPatient(auth, { email: ' P@EXAMPLE.COM ', password: 'pw' })).email, 'p@example.com');
  assert.equal((await registerPatient(auth, { name: ' Patient ', email: ' N@EXAMPLE.COM ', password: 'pw', confirm: 'pw' })).email, 'n@example.com');
  await resendPatientVerification(auth, { email: ' V@EXAMPLE.COM ' });

  assert.deepEqual(calls, [
    ['login', { email: 'p@example.com', password: 'pw' }],
    ['register', { name: 'Patient', email: 'n@example.com', password: 'pw' }],
    ['resend', 'v@example.com'],
  ]);
});

test('registerPatient rejects password mismatch before API call', async () => {
  await assert.rejects(
    () => registerPatient({ register: async () => { throw new Error('should_not_call'); } }, {
      name: 'Patient',
      email: 'p@example.com',
      password: 'one',
      confirm: 'two',
    }),
    { code: 'match' },
  );
});

test('patient session helpers keep app state and auth storage in sync', () => {
  const state = { session: null };
  const calls = [];
  const auth = {
    saveSession: (session) => {
      calls.push(['save', session]);
      return session;
    },
    clearSession: () => calls.push(['clear']),
  };

  const session = { id: 'p1', role: 'patient' };
  assert.equal(savePatientSession(state, auth, session), session);
  assert.equal(state.session, session);
  clearPatientSession(state, auth);
  assert.equal(state.session, null);
  assert.deepEqual(calls, [['save', session], ['clear']]);
});

test('authMessage exposes patient-facing auth errors', () => {
  assert.equal(authMessage('not_patient'), 'บัญชีนี้ไม่ใช่บัญชีผู้ป่วย');
  assert.equal(authMessage({ code: 'jwt_expired' }), 'กรุณาเข้าสู่ระบบอีกครั้ง');
});
