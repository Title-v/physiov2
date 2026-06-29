import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getValidationFrameProcessor,
  validationDoseFor,
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
    'shoulder|2026-06-29T08:00:00.000Z|motion_cycle|3|20',
  );
  assert.equal(
    validationReferenceKey({}, { ...ref, referenceSequence: { sampleCount: 25 } }, 'fallback'),
    'fallback|2026-06-29T08:00:00.000Z|motion_cycle|3|25',
  );
});

test('validationScoreColors follows therapist validation score thresholds', () => {
  assert.deepEqual(validationScoreColors(90), ['#2F5D50', '#7BA88F']);
  assert.deepEqual(validationScoreColors(50), ['#9C7344', '#C8955A']);
  assert.deepEqual(validationScoreColors(49), ['#8C4F40', '#B86C5A']);
  assert.deepEqual(validationScoreColors(null), ['#8C4F40', '#B86C5A']);
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
  const exercise = { id: 'shoulder', reps: 8, sets: 2, holdSec: 1.5 };
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
  assert.deepEqual(calls[0][1].dose, { reps: 8, sets: 2, holdSec: 1.5 });
  assert.equal(calls[0][1].lang, 'th');
  assert.equal(state.validationKey, 'shoulder|2026-06-29T08:00:00.000Z|motion_cycle|3|13');
});
