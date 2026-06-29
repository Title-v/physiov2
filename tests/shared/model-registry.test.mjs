import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRegistry } from '../../shared/ai/ModelRegistry.js';

test('createModelRegistry lazily loads and caches model promises', async () => {
  let calls = 0;
  const registry = createModelRegistry({
    loaders: {
      tcn: async () => {
        calls += 1;
        return { id: 'model-v1' };
      },
    },
    metadata: {
      tcn: { version: 'v1', inputShape: [30, 139] },
    },
    logger: { warn() {} },
  });

  const [a, b] = await Promise.all([registry.load('tcn'), registry.load('tcn')]);

  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.deepEqual(registry.getMetadata('tcn'), { version: 'v1', inputShape: [30, 139] });
  assert.equal(registry.get('tcn').id, 'model-v1');
});

test('createModelRegistry can register direct models and update metadata', async () => {
  const registry = createModelRegistry({ logger: { warn() {} } });

  registry.register('motion', { id: 'direct' }, { accuracy: 0.91 });
  registry.setMetadata('motion', { exerciseScope: ['shoulder'] });

  assert.deepEqual(await registry.load('motion'), { id: 'direct' });
  assert.deepEqual(registry.getMetadata('motion'), {
    accuracy: 0.91,
    exerciseScope: ['shoulder'],
  });
});

test('createModelRegistry clears failed loads so a retry can succeed', async () => {
  let calls = 0;
  const registry = createModelRegistry({
    loaders: {
      tcn: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary failure');
        return { id: 'ok' };
      },
    },
    logger: { warn() {} },
  });

  await assert.rejects(() => registry.load('tcn'), /temporary failure/);
  const model = await registry.load('tcn');

  assert.equal(calls, 2);
  assert.deepEqual(model, { id: 'ok' });
});
