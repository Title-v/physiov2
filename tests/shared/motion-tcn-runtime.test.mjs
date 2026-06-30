import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionTcnModelRegistry } from '../../shared/ai/MotionTcnRuntime.js';

test('createMotionTcnModelRegistry returns null when manifest is missing', async () => {
  const registry = createMotionTcnModelRegistry({
    fetchImpl: async () => ({ ok: false }),
    tf: null,
    logger: { warn() {} },
  });

  assert.equal(await registry.load('motion-tcn'), null);
});

test('createMotionTcnModelRegistry lazy-loads model from manifest when TFJS is present', async () => {
  const loaded = [];
  const registry = createMotionTcnModelRegistry({
    baseUrl: '/shared/models/motion-tcn',
    fetchImpl: async (url) => ({
      ok: true,
      async json() {
        assert.equal(url, '/shared/models/motion-tcn/manifest.json');
        return { version: 'v1', modelPath: './model.json', inputShape: [30, 139], approved: true };
      },
    }),
    tf: {
      async loadLayersModel(url) {
        loaded.push(url);
        return { id: 'model' };
      },
    },
    logger: { warn() {} },
  });

  const model = await registry.load('motion-tcn');

  assert.deepEqual(loaded, ['/shared/models/motion-tcn/model.json']);
  assert.equal(model.id, 'model');
  assert.deepEqual(model.__physioAiManifest.inputShape, [30, 139]);
});
