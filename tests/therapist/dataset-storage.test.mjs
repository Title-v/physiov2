import test from 'node:test';
import assert from 'node:assert/strict';
import {
  datasetStoragePath,
  reviewedTrainableDatasetRows,
  saveReviewedDatasetRows,
} from '../../src/app/therapist/capture/datasetStorage.js';

function row(overrides = {}) {
  return {
    id: 'rep_1',
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
    frames: [{ t: 0 }],
    ...overrides,
  };
}

test('datasetStoragePath targets patient-specific dataset API when patient is selected', () => {
  assert.equal(datasetStoragePath(), '/datasets');
  assert.equal(datasetStoragePath('patient 1'), '/datasets?patientId=patient%201');
});

test('reviewedTrainableDatasetRows filters out draft skipped and rejected rows', () => {
  const rows = [
    row({ id: 'ready' }),
    row({ id: 'draft', labelStatus: 'draft', trainable: false }),
    row({ id: 'skipped', labelStatus: 'skipped', trainable: false }),
    row({ id: 'missing_schema', landmarkSchemaId: null }),
    row({ id: 'missing_stabilizer', missingStabilizer: ['left_shoulder'] }),
  ];

  assert.deepEqual(reviewedTrainableDatasetRows(rows).map((item) => item.id), ['ready']);
});

test('saveReviewedDatasetRows posts only reviewed trainable rows', async () => {
  const calls = [];
  const result = await saveReviewedDatasetRows({
    rows: [
      row({ id: 'ready_1' }),
      row({ id: 'draft', labelStatus: 'draft', trainable: false }),
      row({ id: 'ready_2', motionLabel: 'unstable', label: 'unstable' }),
    ],
    patientId: 'patient-1',
    postDataset: async (path, body) => {
      calls.push({ path, id: body.id });
      return { id: `saved_${body.id}` };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempted, 2);
  assert.equal(result.saved, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(calls, [
    { path: '/datasets?patientId=patient-1', id: 'ready_1' },
    { path: '/datasets?patientId=patient-1', id: 'ready_2' },
  ]);
});

test('saveReviewedDatasetRows reports partial save failures without retrying side effects', async () => {
  const result = await saveReviewedDatasetRows({
    rows: [row({ id: 'ready_1' }), row({ id: 'ready_2' })],
    postDataset: async (_path, body) => {
      if (body.id === 'ready_2') throw new Error('supabase_error');
      return { id: 'saved_ready_1' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempted, 2);
  assert.equal(result.saved, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row.id, 'ready_2');
});
