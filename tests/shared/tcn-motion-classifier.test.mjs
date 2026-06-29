import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRegistry } from '../../shared/ai/ModelRegistry.js';
import {
  createTcnMotionClassifier,
  normalizeAiSignal,
} from '../../shared/ai/TcnMotionClassifier.js';

test('normalizeAiSignal maps aliases and clamps confidence', () => {
  assert.deepEqual(normalizeAiSignal({ phase: 'outbound', quality: 'wrong_path', confidence: 1.5 }), {
    phase: 'moving_to_target',
    quality: 'wrong_path',
    confidence: 1,
  });
  assert.deepEqual(normalizeAiSignal([2, 3, 0.42]), {
    phase: 'target',
    quality: 'unstable',
    confidence: 0.42,
  });
  assert.deepEqual(normalizeAiSignal([
    [[0.05, 0.1, 0.8, 0.05]],
    [[0.1, 0.05, 0.75, 0.05, 0.05]],
  ]), {
    phase: 'target',
    quality: 'wrong_path',
    confidence: 0.75,
  });
  assert.equal(normalizeAiSignal({ phase: 'unknown' }), null);
});

test('createTcnMotionClassifier predicts using lazy registry and extracted vectors', async () => {
  let received = null;
  const registry = createModelRegistry({
    models: {
      tcn: {
        async predictMotion(input) {
          received = input;
          return { phase: 'target', quality: 'good', confidence: 0.86 };
        },
      },
    },
    logger: { warn() {} },
  });
  const classifier = createTcnMotionClassifier({
    registry,
    modelName: 'tcn',
    extractorOptions: { joints: ['right_shoulder'], landmarkCount: 1 },
    logger: { warn() {} },
  });

  const signal = await classifier.predict([
    { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], jointAngles: { right_shoulder: 20 } },
    { t: 100, landmarks: [[0.2, 0.2, 0, 0.9]], jointAngles: { right_shoulder: 35 } },
  ]);

  assert.deepEqual(signal, { phase: 'target', quality: 'good', confidence: 0.86 });
  assert.equal(received.vectors.length, 2);
  assert.equal(received.vectors[0].length, 1 * 4 + 1 + 1 + 3);
});

test('createTcnMotionClassifier returns null instead of throwing when model is missing or fails', async () => {
  const logger = { warn() {} };
  const missing = createTcnMotionClassifier({
    registry: createModelRegistry({ logger }),
    modelName: 'missing',
    logger,
  });
  assert.equal(await missing.predict([{ t: 0 }]), null);

  const failing = createTcnMotionClassifier({
    registry: createModelRegistry({
      models: {
        tcn: {
          predict() {
            throw new Error('boom');
          },
        },
      },
      logger,
    }),
    modelName: 'tcn',
    logger,
  });
  assert.equal(await failing.predict([{ t: 0 }]), null);
});

test('createTcnMotionClassifier supports TFJS-style two-head tensor outputs lazily', async () => {
  const disposed = [];
  const registry = createModelRegistry({
    models: {
      tcn: {
        __physioAiManifest: { inputShape: [2, 9] },
        predict(input) {
          assert.equal(input.kind, 'tensor3d');
          return [
            { async data() { return [0.1, 0.7, 0.1, 0.1]; }, dispose() { disposed.push('phase'); } },
            { async data() { return [0.05, 0.05, 0.8, 0.05, 0.05]; }, dispose() { disposed.push('quality'); } },
          ];
        },
      },
    },
    logger: { warn() {} },
  });
  const classifier = createTcnMotionClassifier({
    registry,
    modelName: 'tcn',
    extractorOptions: { joints: ['right_shoulder'], landmarkCount: 1 },
    tf: {
      tensor3d(value) {
        return {
          kind: 'tensor3d',
          value,
          dispose() {
            disposed.push('input');
          },
        };
      },
    },
    logger: { warn() {} },
  });

  const signal = await classifier.predict([
    { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], jointAngles: { right_shoulder: 20 } },
    { t: 100, landmarks: [[0.2, 0.2, 0, 0.9]], jointAngles: { right_shoulder: 35 } },
  ]);

  assert.deepEqual(signal, { phase: 'moving_to_target', quality: 'wrong_path', confidence: 0.7 });
  assert.deepEqual(disposed.sort(), ['input', 'phase', 'quality']);
});
