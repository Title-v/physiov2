export const MOTION_DATASET_SCHEMA_VERSION = 1;

const DEFAULT_SOURCE = 'therapist_capture';
const DEFAULT_LABEL = 'unlabeled';
const DEFAULT_SUBJECT_ID = 'anon_001';
const DEFAULT_DATA_QUALITY = 'usable';
const DEFAULT_LABEL_STATUS = 'draft';
const DEFAULT_COMPLETION_SOURCE = 'unknown';

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanObjectNumbers(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

export function landmarkToTuple(point) {
  if (Array.isArray(point)) {
    return [
      finiteNumber(point[0]),
      finiteNumber(point[1]),
      finiteNumber(point[2]),
      finiteNumber(point[3], 0),
    ];
  }
  return [
    finiteNumber(point?.x),
    finiteNumber(point?.y),
    finiteNumber(point?.z),
    finiteNumber(point?.visibility, 0),
  ];
}

export function normalizeDatasetLandmarks(landmarks = []) {
  if (!Array.isArray(landmarks)) return [];
  return landmarks.map(landmarkToTuple);
}

export function normalizeDatasetFrame(frame = {}, index = 0, firstT = 0) {
  const rawT = frame.tMs ?? frame.t ?? frame.timestamp ?? index;
  const t = Math.max(0, finiteNumber(rawT) - firstT);
  return {
    t,
    landmarks: normalizeDatasetLandmarks(frame.landmarks),
    angles: cleanObjectNumbers(frame.angles || frame.jointAngles || {}),
    phase: frame.phase || null,
    boundaryStatus: frame.boundaryStatus || frame.boundary?.status || null,
    dataQuality: frame.dataQuality || frame.safety?.dataQuality || null,
    safetyStatus: frame.safetyStatus || frame.safety?.status || null,
  };
}

export function buildMotionDatasetRow({
  exerciseId = null,
  label = DEFAULT_LABEL,
  motionLabel = null,
  suggestedLabel = null,
  dataQuality = DEFAULT_DATA_QUALITY,
  labelStatus = DEFAULT_LABEL_STATUS,
  trainable = false,
  scoreable = false,
  repComplete = false,
  completionSource = DEFAULT_COMPLETION_SOURCE,
  missingPrimary = [],
  missingStabilizer = [],
  landmarkSchemaId = null,
  bodyRegion = null,
  primaryRequiredLandmarks = [],
  stabilizerRequiredLandmarks = [],
  modelInputLandmarks = [],
  jointNames = [],
  phaseLabels = [],
  frames = [],
  source = DEFAULT_SOURCE,
  subjectId = DEFAULT_SUBJECT_ID,
  metadata = {},
} = {}) {
  const list = Array.isArray(frames) ? frames : [];
  const firstRawT = list.length ? finiteNumber(list[0]?.tMs ?? list[0]?.t ?? list[0]?.timestamp, 0) : 0;
  const normalizedFrames = list.map((frame, index) => normalizeDatasetFrame(frame, index, firstRawT));
  const phases = phaseLabels.length
    ? [...phaseLabels]
    : [...new Set(normalizedFrames.map((frame) => frame.phase).filter(Boolean))];
  const complete = repComplete === true;

  return {
    version: MOTION_DATASET_SCHEMA_VERSION,
    exerciseId: exerciseId || metadata?.exerciseId || 'unknown',
    label: label || DEFAULT_LABEL,
    motionLabel,
    suggestedLabel,
    dataQuality,
    labelStatus,
    trainable: trainable === true && complete,
    scoreable: scoreable === true && complete,
    repComplete: complete,
    completionSource: completionSource || DEFAULT_COMPLETION_SOURCE,
    missingPrimary: [...new Set(missingPrimary || [])],
    missingStabilizer: [...new Set(missingStabilizer || [])],
    landmarkSchemaId: landmarkSchemaId || metadata?.landmarkSchemaId || null,
    bodyRegion: bodyRegion || metadata?.bodyRegion || null,
    primaryRequiredLandmarks: [...new Set(primaryRequiredLandmarks || metadata?.primaryRequiredLandmarks || [])],
    stabilizerRequiredLandmarks: [...new Set(stabilizerRequiredLandmarks || metadata?.stabilizerRequiredLandmarks || [])],
    modelInputLandmarks: [...new Set(modelInputLandmarks || metadata?.modelInputLandmarks || [])],
    jointNames: [...new Set(jointNames || metadata?.jointNames || [])],
    phaseLabels: phases,
    frames: normalizedFrames,
    source: source || DEFAULT_SOURCE,
    subjectId: subjectId || DEFAULT_SUBJECT_ID,
    metadata: {
      ...metadata,
      landmarkSchemaId: landmarkSchemaId || metadata?.landmarkSchemaId || null,
      bodyRegion: bodyRegion || metadata?.bodyRegion || null,
      repComplete: complete,
      completionSource: completionSource || DEFAULT_COMPLETION_SOURCE,
      primaryRequiredLandmarks: [...new Set(primaryRequiredLandmarks || metadata?.primaryRequiredLandmarks || [])],
      stabilizerRequiredLandmarks: [...new Set(stabilizerRequiredLandmarks || metadata?.stabilizerRequiredLandmarks || [])],
      modelInputLandmarks: [...new Set(modelInputLandmarks || metadata?.modelInputLandmarks || [])],
      jointNames: [...new Set(jointNames || metadata?.jointNames || [])],
      featureSchemaVersion: metadata?.featureSchemaVersion ?? MOTION_DATASET_SCHEMA_VERSION,
    },
  };
}

export function buildMotionDatasetRowFromSkeletonPayload(payload, options = {}) {
  return buildMotionDatasetRow({
    exerciseId: payload?.exercise?.id || options.exerciseId,
    label: options.label || DEFAULT_LABEL,
    motionLabel: options.motionLabel || null,
    suggestedLabel: options.suggestedLabel || null,
    dataQuality: options.dataQuality || DEFAULT_DATA_QUALITY,
    labelStatus: options.labelStatus || DEFAULT_LABEL_STATUS,
    trainable: options.trainable === true,
    scoreable: options.scoreable === true,
    repComplete: options.repComplete === true,
    completionSource: options.completionSource || 'debug_skeleton_export',
    missingPrimary: options.missingPrimary || [],
    missingStabilizer: options.missingStabilizer || [],
    landmarkSchemaId: options.landmarkSchemaId || payload?.exercise?.landmarkSchemaId || payload?.flags?.landmarkSchemaId || null,
    bodyRegion: options.bodyRegion || payload?.exercise?.bodyRegion || payload?.flags?.bodyRegion || null,
    primaryRequiredLandmarks: options.primaryRequiredLandmarks || payload?.exercise?.primaryRequiredLandmarks || [],
    stabilizerRequiredLandmarks: options.stabilizerRequiredLandmarks || payload?.exercise?.stabilizerRequiredLandmarks || [],
    modelInputLandmarks: options.modelInputLandmarks || payload?.exercise?.modelInputLandmarks || [],
    jointNames: options.jointNames || payload?.exercise?.jointNames || [],
    phaseLabels: options.phaseLabels || [],
    frames: payload?.frames || [],
    source: options.source || DEFAULT_SOURCE,
    subjectId: options.subjectId || DEFAULT_SUBJECT_ID,
    metadata: {
      schema: payload?.schema || null,
      exportedAt: payload?.exportedAt || null,
      bodyRegion: payload?.exercise?.bodyRegion || payload?.flags?.bodyRegion || null,
      movementPattern: payload?.exercise?.movementPattern || null,
      selectedOverlayJoints: payload?.exercise?.selectedOverlayJoints || [],
      selectedRepJoints: payload?.exercise?.selectedRepJoints || [],
      clip: payload?.clip || null,
      ...(options.metadata || {}),
    },
  });
}

export function motionDatasetRowToJsonl(row) {
  return `${JSON.stringify(row)}\n`;
}

export function motionDatasetRowsToJsonl(rows = []) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

export function parseMotionDatasetJsonl(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
