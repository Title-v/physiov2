import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getValidationFrameProcessor,
  validationDoseFor,
  validationFeedbackText,
  validationModelBaseUrlForExercise,
  validationReferenceKey,
  validationScoreColors,
} from '../../src/app/therapist/capture/validationController.js';

test('validationDoseFor normalizes exercise dose defaults for motion preview validation', () => {
  assert.deepEqual(validationDoseFor({ reps: 12, sets: 3, holdSec: 4 }), { reps: 12, sets: 3, holdSec: 4 });
  assert.deepEqual(validationDoseFor({ reps: 0, sets: null, holdSec: undefined }), { reps: 1, sets: 1, holdSec: 10 });
});

test('validationReferenceKey changes when the validation reference shape changes', () => {
  const ref = {
    capturedAt: '2026-06-29T08:00:00.000Z',
    kind: 'motion_cycle',
    referenceVersion: 3,
    referenceSequence: { sampleCount: 20 },
  };

  assert.equal(
    validationReferenceKey({ id: 'shoulder' }, ref),
    'shoulder|2026-06-29T08:00:00.000Z|motion_cycle|3|20|||',
  );
  assert.equal(
    validationReferenceKey({}, { ...ref, referenceSequence: { sampleCount: 25 } }, 'fallback'),
    'fallback|2026-06-29T08:00:00.000Z|motion_cycle|3|25|||',
  );
  assert.equal(
    validationReferenceKey({ id: 'shoulder', landmarkSchemaId: 'right_arm.v1', activeModelId: 'right_arm_tcn_v2', modelStatus: 'deployed' }, ref),
    'shoulder|2026-06-29T08:00:00.000Z|motion_cycle|3|20|right_arm.v1|right_arm_tcn_v2|deployed',
  );
});

test('validationScoreColors follows therapist validation score thresholds', () => {
  assert.deepEqual(validationScoreColors(90), ['#2F5D50', '#7BA88F']);
  assert.deepEqual(validationScoreColors(50), ['#9C7344', '#C8955A']);
  assert.deepEqual(validationScoreColors(49), ['#8C4F40', '#B86C5A']);
  assert.deepEqual(validationScoreColors(null), ['#8C4F40', '#B86C5A']);
});

test('validationFeedbackText exposes live AI phase quality confidence and reps', () => {
  assert.equal(validationFeedbackText(null, 'fallback'), 'fallback');
  assert.equal(
    validationFeedbackText({
      aiSignal: { phase: 'target', quality: 'wrong_path', confidence: 0.874 },
      aiRepCount: 2,
    }, 'fallback'),
    'AI target · wrong_path · 87% confidence · AI reps 2',
  );
});

test('getValidationFrameProcessor returns null for references that cannot be practiced', () => {
  const state = {};
  const processor = getValidationFrameProcessor(state, { id: 'shoulder' }, null, {
    usableReferenceCheck: () => false,
    motionEngineFactory: () => { throw new Error('should_not_create_engine'); },
    frameProcessorFactory: () => { throw new Error('should_not_create_processor'); },
  });

  assert.equal(processor, null);
  assert.equal(state.validationEngine, undefined);
});

test('getValidationFrameProcessor caches engines by exercise and reference key', () => {
  const state = {};
  const calls = [];
  const exercise = {
    id: 'shoulder',
    reps: 8,
    sets: 2,
    holdSec: 1.5,
    landmarkSchemaId: 'right_arm.v1',
    activeModelId: 'right_arm_tcn_v1',
    modelStatus: 'deployed',
  };
  const reference = {
    capturedAt: '2026-06-29T08:00:00.000Z',
    kind: 'motion_cycle',
    referenceVersion: 3,
    referenceSequence: { sampleCount: 12 },
  };
  const options = {
    lang: () => 'th',
    usableReferenceCheck: () => true,
    motionEngineFactory: (config) => {
      calls.push(['engine', config]);
      return { id: `engine-${calls.length}` };
    },
    frameProcessorFactory: (config) => {
      calls.push(['processor', config]);
      return { id: `processor-${calls.length}`, motionEngine: config.motionEngine };
    },
    modelRegistryFactory: (config) => {
      calls.push(['registry', config]);
      return { id: `registry-${calls.length}` };
    },
    motionClassifierFactory: (config) => {
      calls.push(['classifier', config]);
      return { id: `classifier-${calls.length}` };
    },
  };

  const first = getValidationFrameProcessor(state, exercise, reference, options);
  const second = getValidationFrameProcessor(state, exercise, reference, options);
  const changed = getValidationFrameProcessor(state, exercise, {
    ...reference,
    referenceSequence: { sampleCount: 13 },
  }, options);

  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.equal(calls.filter((call) => call[0] === 'engine').length, 2);
  assert.equal(calls.filter((call) => call[0] === 'processor').length, 2);
  assert.equal(calls.filter((call) => call[0] === 'registry').length, 2);
  assert.equal(calls.filter((call) => call[0] === 'classifier').length, 2);
  assert.deepEqual(calls[0][1].dose, { reps: 8, sets: 2, holdSec: 1.5 });
  assert.equal(calls[0][1].lang, 'th');
  const firstProcessorConfig = calls.find((call) => call[0] === 'processor')[1];
  assert.equal(firstProcessorConfig.motionClassifier.id, 'classifier-3');
  assert.deepEqual(firstProcessorConfig.classifierOptions, { landmarkSchemaId: 'right_arm.v1' });
  assert.deepEqual(calls.find((call) => call[0] === 'registry')[1], { baseUrl: '/shared/models/right_arm_tcn_v1' });
  assert.equal(state.validationKey, 'shoulder|2026-06-29T08:00:00.000Z|motion_cycle|3|13|right_arm.v1|right_arm_tcn_v1|deployed');
});

test('validationModelBaseUrlForExercise prefers explicit url then active model id', () => {
  assert.equal(validationModelBaseUrlForExercise({ modelBaseUrl: '/custom/model' }), '/custom/model');
  assert.equal(validationModelBaseUrlForExercise({ modelUrl: '/legacy/model' }), '/legacy/model');
  assert.equal(validationModelBaseUrlForExercise({ activeModelId: 'right_arm_tcn_v1' }), '/shared/models/right_arm_tcn_v1');
  assert.equal(validationModelBaseUrlForExercise({}), undefined);
});
