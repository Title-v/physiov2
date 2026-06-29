import { featureVectorsFromWindow, extractMotionFeatureWindow } from './MotionFeatureExtractor.js';

export const TCN_PHASES = ['rest', 'moving_to_target', 'target', 'returning'];
export const TCN_QUALITIES = ['good', 'incomplete', 'wrong_path', 'unstable', 'out_of_frame'];

const PHASE_ALIASES = {
  rest_start: 'rest',
  rest_end: 'rest',
  outbound: 'moving_to_target',
  moving: 'moving_to_target',
  return: 'returning',
};

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeEnum(value, allowed, aliases = {}, fallback = null) {
  const normalized = aliases[value] || value;
  return allowed.includes(normalized) ? normalized : fallback;
}

async function unwrapModelOutput(raw) {
  if (Array.isArray(raw)) {
    return Promise.all(raw.map((item) => unwrapModelOutput(item)));
  }
  if (raw && typeof raw.data === 'function') {
    const values = await raw.data();
    raw.dispose?.();
    return Array.from(values);
  }
  if (raw && typeof raw.array === 'function') {
    const values = await raw.array();
    raw.dispose?.();
    return values;
  }
  return raw;
}

function indexToEnum(index, allowed) {
  const n = Math.round(Number(index));
  return allowed[n] || null;
}

function vectorFromOutput(output) {
  if (!Array.isArray(output)) return [];
  let value = output;
  while (Array.isArray(value[0])) value = value[0];
  return value.map((item) => Number(item));
}

function maxIndex(vector) {
  let bestIndex = 0;
  let bestValue = -Infinity;
  vector.forEach((value, index) => {
    if (Number.isFinite(value) && value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  });
  return { index: bestIndex, confidence: clamp01(bestValue) };
}

export function normalizeAiSignal(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (Array.isArray(raw[0]) || Array.isArray(raw[1])) {
      const phaseMax = maxIndex(vectorFromOutput(raw[0]));
      const qualityMax = maxIndex(vectorFromOutput(raw[1]));
      return {
        phase: TCN_PHASES[phaseMax.index] || 'rest',
        quality: TCN_QUALITIES[qualityMax.index] || 'good',
        confidence: Math.min(phaseMax.confidence, qualityMax.confidence),
      };
    }
    const flat = raw.flat(Infinity);
    if (!flat.length) return null;
    return {
      phase: indexToEnum(flat[0], TCN_PHASES) || 'rest',
      quality: indexToEnum(flat[1], TCN_QUALITIES) || 'good',
      confidence: clamp01(flat[2] ?? 0),
    };
  }
  const phase = normalizeEnum(raw.phase, TCN_PHASES, PHASE_ALIASES, null);
  const quality = normalizeEnum(raw.quality, TCN_QUALITIES, {}, null);
  if (!phase && !quality) return null;
  return {
    phase: phase || 'rest',
    quality: quality || 'good',
    confidence: clamp01(raw.confidence ?? raw.score ?? 0),
  };
}

export function createTcnMotionClassifier({
  registry = null,
  modelName = 'motion-tcn',
  extractorOptions = {},
  tf = globalThis.tf,
  logger = console,
} = {}) {
  async function load() {
    if (!registry?.load) return null;
    return registry.load(modelName);
  }

  async function predict(frames = [], options = {}) {
    try {
      const model = await load();
      if (!model) return null;
      const featureWindow = extractMotionFeatureWindow(frames, {
        ...extractorOptions,
        ...(options.extractorOptions || {}),
      });
      const vectors = featureWindow.map((features) => features.featureVector);
      let raw = null;
      if (typeof model.predictMotion === 'function') {
        raw = await model.predictMotion({ frames, featureWindow, vectors, options });
      } else if (typeof model.predict === 'function') {
        const shouldUseTensor = model.__physioAiManifest && typeof tf?.tensor3d === 'function';
        const input = shouldUseTensor ? tf.tensor3d([vectors]) : vectors;
        try {
          raw = await model.predict(input, { frames, featureWindow, options });
        } finally {
          input?.dispose?.();
        }
      } else {
        return null;
      }
      return normalizeAiSignal(await unwrapModelOutput(raw));
    } catch (err) {
      logger?.warn?.('TCN motion classifier failed; falling back to rule-based scoring.', err);
      return null;
    }
  }

  return {
    modelName,
    load,
    predict,
    featureVectorsFromWindow: (frames, options = {}) => featureVectorsFromWindow(frames, {
      ...extractorOptions,
      ...options,
    }),
  };
}
