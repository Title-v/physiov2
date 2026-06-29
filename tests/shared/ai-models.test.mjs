import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exerciseWithModelManifest,
  fetchAiModels,
  modelManifestId,
  selectModelManifestForExercise,
} from '../../shared/core/ai-models.js';

const exercise = {
  id: 'shoulder_ai',
  landmarkSchemaId: 'right_arm.v1',
};

test('modelManifestId normalizes persisted model identifiers', () => {
  assert.equal(modelManifestId({ id: 'm1' }), 'm1');
  assert.equal(modelManifestId({ modelId: 'm2' }), 'm2');
  assert.equal(modelManifestId({ name: 'm3' }), 'm3');
  assert.equal(modelManifestId({}), null);
});

test('selectModelManifestForExercise prefers explicit active model id even when schema mismatch needs surfacing', () => {
  const selected = selectModelManifestForExercise({
    ...exercise,
    activeModelId: 'right_arm_tcn_v1',
  }, [
    { id: 'compatible_latest', exerciseId: 'shoulder_ai', approved: true, landmarkSchemaId: 'right_arm.v1' },
    { id: 'right_arm_tcn_v1', exerciseId: 'shoulder_ai', approved: true, landmarkSchemaId: 'right_leg.v1' },
  ]);

  assert.equal(selected.id, 'right_arm_tcn_v1');
  assert.equal(selected.landmarkSchemaId, 'right_leg.v1');
});

test('selectModelManifestForExercise chooses approved schema-compatible model when no active id is set', () => {
  const selected = selectModelManifestForExercise(exercise, [
    { id: 'draft', exerciseId: 'shoulder_ai', approved: false, landmarkSchemaId: 'right_arm.v1' },
    { id: 'wrong_exercise', exerciseId: 'knee_ai', approved: true, landmarkSchemaId: 'right_arm.v1' },
    { id: 'approved', exerciseId: 'shoulder_ai', approved: true, landmarkSchemaId: 'right_arm.v1' },
  ]);

  assert.equal(selected.id, 'approved');
});

test('exerciseWithModelManifest enriches runtime exercise with selected model path fields', () => {
  const next = exerciseWithModelManifest(exercise, {
    id: 'right_arm_tcn_v1',
    approved: true,
    modelBaseUrl: '/models/right-arm',
  });

  assert.equal(next.activeModelId, 'right_arm_tcn_v1');
  assert.equal(next.modelStatus, 'deployed');
  assert.equal(next.modelBaseUrl, '/models/right-arm');
});

test('fetchAiModels builds model metadata query parameters', async () => {
  const paths = [];
  const rows = await fetchAiModels({
    exerciseId: 'shoulder_ai',
    landmarkSchemaId: 'right_arm.v1',
    get: async (path) => {
      paths.push(path);
      return [{ id: 'm1' }];
    },
  });

  assert.deepEqual(rows, [{ id: 'm1' }]);
  assert.deepEqual(paths, ['/ai-models?exerciseId=shoulder_ai&landmarkSchemaId=right_arm.v1']);
});
