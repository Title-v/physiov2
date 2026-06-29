export const MOTION_DATASET_SCHEMA_VERSION = 1;

const DEFAULT_SOURCE = 'therapist_capture';
const DEFAULT_LABEL = 'unlabeled';
const DEFAULT_SUBJECT_ID = 'anon_001';

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
  };
}

export function buildMotionDatasetRow({
  exerciseId = null,
  label = DEFAULT_LABEL,
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

  return {
    version: MOTION_DATASET_SCHEMA_VERSION,
    exerciseId: exerciseId || metadata?.exerciseId || 'unknown',
    label: label || DEFAULT_LABEL,
    phaseLabels: phases,
    frames: normalizedFrames,
    source: source || DEFAULT_SOURCE,
    subjectId: subjectId || DEFAULT_SUBJECT_ID,
    metadata: { ...metadata },
  };
}

export function buildMotionDatasetRowFromSkeletonPayload(payload, options = {}) {
  return buildMotionDatasetRow({
    exerciseId: payload?.exercise?.id || options.exerciseId,
    label: options.label || DEFAULT_LABEL,
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
