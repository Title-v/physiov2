import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataHandlers } from '../../shared/api/handlers/data-routes.js';
import {
  validateCreatePatientPayload,
  validateAiModelPayload,
  validateDatasetPayload,
  validateDeleteReferencePayload,
  validatePatientLookupPayload,
  validatePlanPayload,
  validateReferencePayload,
  validateSessionPayload,
} from '../../shared/api/handlers/payload-validation.js';

const TABLES = {
  sessions: 'sessions',
  datasets: 'motion_datasets',
  aiModels: 'ai_models',
  therapistPatients: 'therapist_patients',
  profiles: 'profiles',
  plans: 'plans',
  references: 'references',
};

function createNoWriteDb(calls = []) {
  return {
    calls,
    from(table) {
      calls.push({ table, op: 'from' });
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: null, error: null }),
        upsert(payload) {
          calls.push({ table, op: 'upsert', payload });
          return this;
        },
        insert(payload) {
          calls.push({ table, op: 'insert', payload });
          return this;
        },
        delete() {
          calls.push({ table, op: 'delete' });
          return this;
        },
        single: async () => ({ data: null, error: null }),
      };
    },
  };
}

function validDatasetPayload() {
  return {
    id: 'ds_1',
    exerciseId: 'shoulder',
    landmarkSchemaId: 'right_arm.v1',
    motionLabel: 'good',
    label: 'good',
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    scoreable: true,
    missingPrimary: [],
    missingStabilizer: [],
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    frames: [{ t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 40 } }],
  };
}

function validAiModelPayload() {
  return {
    id: 'right_arm_tcn_v1',
    exerciseId: 'shoulder',
    version: 'v1',
    landmarkSchemaId: 'right_arm.v1',
    inputShape: [30, 31],
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable'],
    approved: false,
  };
}

function createHandlers() {
  const calls = [];
  const db = createNoWriteDb(calls);
  const handlers = createDataHandlers({
    supabaseReady: () => true,
    supabaseClient: () => db,
    TABLES,
  });
  return { calls, db, handlers };
}

function therapistRequest(body = {}, query = {}) {
  return {
    body,
    query,
    auth: {
      user: { id: 'therapist-1', role: 'therapist' },
      db: createNoWriteDb(),
    },
  };
}

function patientRequest(body = {}, query = {}) {
  return {
    body,
    query,
    auth: {
      user: { id: 'patient-1', role: 'patient' },
      db: createNoWriteDb(),
    },
  };
}

test('data payload validators accept the current patient/therapist API shapes', () => {
  assert.deepEqual(validatePatientLookupPayload({ patientId: 'patient-1' }).value, { patientId: 'patient-1', email: '' });
  assert.deepEqual(validatePatientLookupPayload({ email: ' P@EXAMPLE.COM ' }).value, { patientId: '', email: 'p@example.com' });
  assert.equal(validateCreatePatientPayload({ name: 'Patient', email: 'p@example.com', password: 'pw' }).ok, true);
  assert.equal(validatePlanPayload({ items: [{ exerciseId: 'shoulder', reps: 8, sets: 2 }] }, 'patient-1').ok, true);
  assert.equal(validateReferencePayload({ exerciseId: 'shoulder', kind: 'motion_cycle', referenceSequence: { frames: [] } }).ok, true);
  assert.equal(validateDeleteReferencePayload({ query: { exerciseId: 'shoulder' } }).ok, true);
  assert.equal(validateSessionPayload({ exerciseId: 'shoulder', endedAt: 1000, score: 88, summary: {} }).ok, true);
  assert.equal(validateDatasetPayload(validDatasetPayload()).ok, true);
  assert.equal(validateAiModelPayload(validAiModelPayload()).ok, true);
});

test('data payload validators reject malformed payloads with field-specific issues', () => {
  assert.deepEqual(validatePatientLookupPayload({ email: 'bad' }).issues, ['email:invalid']);
  assert.deepEqual(validateCreatePatientPayload({ name: 'Patient', email: 'bad', password: 'pw' }).issues, ['email:invalid']);
  assert.deepEqual(validatePlanPayload({ items: [{ reps: 'abc' }] }).issues, ['items.0.exerciseId:required', 'items.0.reps:number_required']);
  assert.deepEqual(validateReferencePayload({ exerciseId: 'bad id' }).issues, ['exerciseId:invalid']);
  assert.deepEqual(validateDeleteReferencePayload({ body: { exerciseId: 'bad id' } }).issues, ['exerciseId:invalid']);
  assert.deepEqual(validateSessionPayload({ exerciseId: 'shoulder', summary: [] }).issues, ['summary:object_required']);
  assert.equal(validateDatasetPayload({ ...validDatasetPayload(), labelStatus: 'draft' }).issues.includes('labelStatus:reviewed_required'), true);
  assert.equal(validateDatasetPayload({ ...validDatasetPayload(), motionLabel: 'unlabeled' }).issues.includes('motionLabel:invalid'), true);
  assert.equal(validateAiModelPayload({ ...validAiModelPayload(), inputShape: [0] }).issues.includes('inputShape:invalid'), true);
  assert.equal(validateAiModelPayload({ ...validAiModelPayload(), approved: true }).issues.includes('approval:failed'), true);
});

test('data handlers reject invalid create/link patient payloads before database writes', async () => {
  const { calls, handlers } = createHandlers();

  const linkResult = await handlers.linkPatient(therapistRequest({ email: 'bad' }));
  const createResult = await handlers.createPatient(therapistRequest({ name: 'Patient', email: 'bad', password: 'pw' }));

  assert.equal(linkResult.status, 400);
  assert.equal(linkResult.body.error, 'invalid_payload');
  assert.equal(createResult.status, 400);
  assert.equal(createResult.body.error, 'invalid_payload');
  assert.deepEqual(calls, []);
});

test('data handlers reject invalid plan/reference/session payloads before writes', async () => {
  const { calls, handlers } = createHandlers();

  const planResult = await handlers.putPlan(patientRequest({ items: [{ exerciseId: 'shoulder', reps: 'lots' }] }));
  const refResult = await handlers.postReference(patientRequest({ exerciseId: 'bad id' }));
  const deleteResult = await handlers.deleteReference(patientRequest({}, { exerciseId: 'bad id' }));
  const sessionResult = await handlers.postSession(patientRequest({ exerciseId: 'shoulder', scoreBreakdown: [] }));
  const datasetResult = await handlers.postDataset(therapistRequest({ ...validDatasetPayload(), trainable: false }));
  const modelResult = await handlers.postAiModel(therapistRequest({ ...validAiModelPayload(), inputShape: [] }));

  assert.equal(planResult.status, 400);
  assert.equal(planResult.body.error, 'invalid_payload');
  assert.equal(refResult.status, 400);
  assert.equal(refResult.body.error, 'invalid_payload');
  assert.equal(deleteResult.status, 400);
  assert.equal(deleteResult.body.error, 'invalid_payload');
  assert.equal(sessionResult.status, 400);
  assert.equal(sessionResult.body.error, 'invalid_payload');
  assert.equal(datasetResult.status, 400);
  assert.equal(datasetResult.body.error, 'invalid_payload');
  assert.equal(modelResult.status, 400);
  assert.equal(modelResult.body.error, 'invalid_payload');
  assert.deepEqual(calls, []);
});
