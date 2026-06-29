import { createModelRegistry } from './ModelRegistry.js';

export const DEFAULT_MOTION_TCN_BASE_URL = '/shared/models/motion-tcn';

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return null;
  const res = await fetchImpl(url);
  if (!res?.ok) return null;
  return res.json();
}

export function createMotionTcnModelRegistry({
  baseUrl = DEFAULT_MOTION_TCN_BASE_URL,
  fetchImpl = globalThis.fetch,
  tf = globalThis.tf,
  logger = console,
} = {}) {
  return createModelRegistry({
    loaders: {
      'motion-tcn': async () => {
        const root = String(baseUrl).replace(/\/$/, '');
        const manifest = await fetchJson(`${root}/manifest.json`, fetchImpl);
        if (!manifest?.modelPath) return null;
        const loader = tf?.loadLayersModel || tf?.loadGraphModel;
        if (typeof loader !== 'function') return null;
        const modelUrl = manifest.modelPath.startsWith('http') || manifest.modelPath.startsWith('/')
          ? manifest.modelPath
          : `${root}/${manifest.modelPath.replace(/^\.\//, '')}`;
        const model = await loader.call(tf, modelUrl);
        model.__physioAiManifest = manifest;
        return model;
      },
    },
    metadata: {
      'motion-tcn': {
        baseUrl,
        optional: true,
        source: 'shared-models',
      },
    },
    logger,
  });
}
