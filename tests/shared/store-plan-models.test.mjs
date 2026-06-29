import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlanFull,
  mergePlanExerciseSnapshot,
} from '../../shared/core/store.js';

function installLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return () => {
    if (original) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  };
}

test('mergePlanExerciseSnapshot preserves verified model fields from stored plan item snapshot', () => {
  const merged = mergePlanExerciseSnapshot({
    id: 'cust_reach',
    source: 'custom',
    activeModelId: null,
    modelStatus: 'collecting_data',
  }, {
    id: 'cust_reach',
    source: 'custom',
    activeModelId: 'right_arm_tcn_v1',
    modelStatus: 'deployed',
    modelBaseUrl: '/shared/models/right_arm_tcn_v1',
  });

  assert.equal(merged.activeModelId, 'right_arm_tcn_v1');
  assert.equal(merged.modelStatus, 'deployed');
  assert.equal(merged.modelBaseUrl, '/shared/models/right_arm_tcn_v1');
});

test('getPlanFull keeps active model metadata on custom exercise snapshots', () => {
  const restore = installLocalStorage({
    'physioai.v1.exercises.custom': [{
      id: 'cust_reach',
      key: 'cust_reach',
      source: 'custom',
      label: 'Reach',
      bodyRegion: 'right_arm',
      primaryJoint: 'right_shoulder',
      type: 'rep',
      reps: 8,
      sets: 2,
      holdSec: 1,
      tol: 10,
      activeModelId: null,
      modelStatus: 'collecting_data',
      landmarkSchemaId: 'right_arm.v1',
    }],
    'physioai.v1.plans': {
      patient_1: {
        patientId: 'patient_1',
        items: [{
          exerciseId: 'cust_reach',
          reps: 8,
          sets: 2,
          holdSec: 1,
          tol: 10,
          exercise: {
            id: 'cust_reach',
            key: 'cust_reach',
            source: 'custom',
            label: 'Reach',
            bodyRegion: 'right_arm',
            activeModelId: 'right_arm_tcn_v1',
            modelStatus: 'deployed',
            modelBaseUrl: '/shared/models/right_arm_tcn_v1',
          },
        }],
      },
    },
  });
  try {
    const plan = getPlanFull('patient_1');

    assert.equal(plan.items[0].exercise.activeModelId, 'right_arm_tcn_v1');
    assert.equal(plan.items[0].exercise.modelStatus, 'deployed');
    assert.equal(plan.items[0].exercise.modelBaseUrl, '/shared/models/right_arm_tcn_v1');
  } finally {
    restore();
  }
});
