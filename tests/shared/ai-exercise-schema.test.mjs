import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiExerciseReadiness,
  createAiExerciseDefinition,
} from '../../shared/ai/AiExerciseSchema.js';

test('createAiExerciseDefinition stamps schema metadata for custom AI exercises', () => {
  const exercise = createAiExerciseDefinition({
    id: 'ai_ex_001',
    label: 'Shoulder raise',
    bodyRegion: 'right_arm',
  });

  assert.equal(exercise.source, 'ai_custom');
  assert.equal(exercise.status, 'collecting_data');
  assert.equal(exercise.landmarkSchemaId, 'right_arm.v1');
  assert.deepEqual(exercise.primaryRequiredLandmarks, ['right_shoulder', 'right_elbow', 'right_wrist']);
  assert.deepEqual(exercise.stabilizerRequiredLandmarks, ['left_shoulder', 'right_hip']);
});

test('aiExerciseReadiness accepts approved schema-compatible model or reference fallback', () => {
  const exercise = createAiExerciseDefinition({
    id: 'ai_ex_001',
    label: 'Shoulder raise',
    bodyRegion: 'right_arm',
  });

  assert.equal(aiExerciseReadiness({ exercise }).ok, false);
  assert.equal(aiExerciseReadiness({ exercise, reference: { id: 'ref_1' } }).reason, 'reference_fallback_ready');
  assert.equal(aiExerciseReadiness({
    exercise,
    modelManifest: { approved: true, landmarkSchemaId: 'right_arm.v1' },
  }).reason, 'model_ready');
  assert.equal(aiExerciseReadiness({
    exercise,
    modelManifest: { approved: true, landmarkSchemaId: 'right_leg.v1' },
  }).modelReady, false);
});
