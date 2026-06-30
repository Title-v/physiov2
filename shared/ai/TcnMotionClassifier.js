import { expectedMotionFeatureSizeForSchema, featureVectorsFromWindow, extractMotionFeatureWindow } from './MotionFeatureExtractor.js';
import { resolveBodyRegionLandmarkSchema } from './BodyRegionLandmarkSchema.js';

export const TCN_PHASES = ['rest', 'moving_to_target', 'target', 'returning'];
export const TCN_QUALITIES = ['good', 'incomplete', 'wrong_path', 'unstable'];

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
  if (!Array.isArray(vector) || !vector.length) return { index: null, confidence: 0 };
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

function bestEnum(vector, allowed) {
  const best = maxIndex(vector);
  const value = Number.isInteger(best.index) ? allowed[best.index] : null;
  return value ? { value, confidence: best.confidence } : null;
}

export function normalizeAiSignal(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (Array.isArray(raw[0]) || Array.isArray(raw[1])) {
      const phaseMax = bestEnum(vectorFromOutput(raw[0]), TCN_PHASES);
      const qualityMax = bestEnum(vectorFromOutput(raw[1]), TCN_QUALITIES);
      if (!phaseMax || !qualityMax) return null;
      return {
        phase: phaseMax.value,
        quality: qualityMax.value,
        confidence: Math.min(phaseMax.confidence, qualityMax.confidence),
      };
    }
    const flat = raw.flat(Infinity);
    if (!flat.length) return null;
    const phase = indexToEnum(flat[0], TCN_PHASES);
    const quality = indexToEnum(flat[1], TCN_QUALITIES);
    if (!phase || !quality) return null;
    return {
      phase,
      quality,
      confidence: clamp01(flat[2] ?? 0),
    };
  }
  const phase = normalizeEnum(raw.phase, TCN_PHASES, PHASE_ALIASES, null);
  const quality = normalizeEnum(raw.quality, TCN_QUALITIES, {}, null);
  if (!phase || !quality) return null;
  return {
    phase,
    quality,
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
      const manifest = model.__physioAiManifest || {};
      if (model.__physioAiManifest && manifest.approved !== true) {
        logger?.warn?.('TCN motion classifier is not approved; falling back to rule-based scoring.');
        return null;
      }
      const requestedSchema = options.landmarkSchemaId || options.exercise?.landmarkSchemaId || extractorOptions.landmarkSchemaId;
      const manifestSchema = manifest.landmarkSchemaId
        ? resolveBodyRegionLandmarkSchema(manifest.landmarkSchemaId, { fallback: false })
        : null;
      if (model.__physioAiManifest && !manifestSchema) {
        logger?.warn?.('TCN motion classifier manifest is missing or using an unknown landmark schema.');
        return null;
      }
      if (requestedSchema && !resolveBodyRegionLandmarkSchema(requestedSchema, { fallback: false })) {
        logger?.warn?.(`TCN motion classifier requested unknown landmark schema: ${requestedSchema}.`);
        return null;
      }
      if (requestedSchema && manifest.landmarkSchemaId && requestedSchema !== manifest.landmarkSchemaId) {
        logger?.warn?.(`TCN motion classifier schema mismatch: exercise ${requestedSchema}, model ${manifest.landmarkSchemaId}.`);
        return null;
      }
      const extractorConfig = {
        ...extractorOptions,
        ...(options.extractorOptions || {}),
        landmarkSchemaId: manifest.landmarkSchemaId || requestedSchema || undefined,
      };
      if (model.__physioAiManifest) {
        extractorConfig.landmarkSchemaId = manifest.landmarkSchemaId;
        extractorConfig.joints = manifest.jointNames || undefined;
      }
      const featureWindow = extractMotionFeatureWindow(frames, extractorConfig);
      let predictionWindow = featureWindow;
      if (model.__physioAiManifest) {
        const inputShape = manifest.inputShape;
        if (!Array.isArray(inputShape) || inputShape.length !== 2) {
          logger?.warn?.('TCN motion classifier manifest is missing inputShape.');
          return null;
        }
        const windowSize = Number(inputShape[0]);
        const featureSize = Number(inputShape[1]);
        const expectedFeatureSize = expectedMotionFeatureSizeForSchema({ landmarkSchema: manifestSchema });
        if (!Number.isInteger(windowSize) || windowSize <= 0 || featureSize !== expectedFeatureSize) {
          logger?.warn?.(`TCN motion classifier inputShape mismatch for ${manifest.landmarkSchemaId}.`);
          return null;
        }
        if (featureWindow.length < windowSize) return null;
        predictionWindow = featureWindow.slice(-windowSize);
        if (predictionWindow.some((features) => features.schemaMissing || features.featureVector.length !== featureSize)) {
          logger?.warn?.('TCN motion classifier feature window does not match manifest inputShape.');
          return null;
        }
      }
      const vectors = predictionWindow.map((features) => features.featureVector);
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
