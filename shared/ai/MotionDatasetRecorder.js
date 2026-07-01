import { buildMotionDatasetRow } from './MotionDataset.js';
import { evaluateMotionSafetyGate } from './MotionSafetyGate.js';
import { normalizeMotionLabel } from './DatasetLabeler.js';

export const DEFAULT_DATASET_REP_THRESHOLDS = Object.freeze({
  minUsableFrameRatio: 0.9,
  maxMissingFrameRatio: 0.1,
});

function qualityStatus(safety = {}) {
  if (safety.dataQuality && safety.dataQuality !== 'ready') return safety.dataQuality;
  if (safety.status && safety.status !== 'ready') return safety.status;
  return 'usable';
}

function mostCommon(values, fallback = 'usable') {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;
}

function dataQualityFromFrames(frames, { minUsableFrameRatio = DEFAULT_DATASET_REP_THRESHOLDS.minUsableFrameRatio } = {}) {
  const safetyFrames = frames.map((frame) => frame.safety).filter(Boolean);
  if (!safetyFrames.length) return 'no_pose';
  const statuses = safetyFrames.map(qualityStatus);
  const usable = statuses.filter((status) => status === 'usable' || status === 'ready').length;
  if (usable / safetyFrames.length >= minUsableFrameRatio) return 'usable';
  return mostCommon(statuses.filter((status) => status !== 'usable' && status !== 'ready'), 'no_pose');
}

function missingFromFrames(frames, key, { maxMissingFrameRatio = DEFAULT_DATASET_REP_THRESHOLDS.maxMissingFrameRatio } = {}) {
  const safetyFrames = frames.map((frame) => frame.safety).filter(Boolean);
  if (!safetyFrames.length) return [];
  const counts = new Map();
  for (const safety of safetyFrames) {
    for (const name of safety?.[key] || []) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count / safetyFrames.length > maxMissingFrameRatio)
    .map(([name]) => name);
}

export function createMotionDatasetRecorder({
  exercise = {},
  landmarkSchemaId = exercise?.landmarkSchemaId || null,
  labelTarget = 'good',
  targetReps = 10,
  subjectId = 'anon_001',
  source = 'therapist_dataset',
  thresholds = DEFAULT_DATASET_REP_THRESHOLDS,
  now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
} = {}) {
  let active = false;
  let frames = [];
  let rows = [];
  const normalizedLabel = normalizeMotionLabel(labelTarget);

  function start() {
    active = true;
    frames = [];
  }

  function stop() {
    active = false;
    return { frames: frames.slice(), rows: rows.slice() };
  }

  function pushFrame(frame = {}) {
    if (!active) return null;
    const safety = frame.safety || evaluateMotionSafetyGate(frame.landmarks, {
      exercise,
      landmarkSchemaId,
      boundaryBox: frame.boundary?.box,
    });
    const next = {
      ...frame,
      tMs: frame.tMs ?? frame.timestamp ?? now(),
      safety,
      dataQuality: safety.dataQuality,
      missingPrimary: safety.missingPrimary || [],
      missingStabilizer: safety.missingStabilizer || [],
      landmarkSchemaId: safety.schemaId || landmarkSchemaId,
    };
    frames.push(next);
    return next;
  }

  function completeRep({
    suggestedLabel = normalizedLabel,
    reviewed = false,
    repComplete = true,
    completionSource = 'rule_completed_rep',
  } = {}) {
    const repFrames = frames.slice();
    frames = [];
    const dataQuality = dataQualityFromFrames(repFrames, thresholds);
    const missingPrimary = missingFromFrames(repFrames, 'missingPrimary', thresholds);
    const missingStabilizer = missingFromFrames(repFrames, 'missingStabilizer', thresholds);
    const complete = repComplete === true;
    const rejected = !complete || dataQuality !== 'usable' || missingPrimary.length > 0 || missingStabilizer.length > 0;
    const trainable = !rejected && reviewed && !!normalizedLabel;
    const labelStatus = !complete
      ? 'draft'
      : (dataQuality !== 'usable' || missingPrimary.length > 0 || missingStabilizer.length > 0)
        ? 'auto_rejected'
        : (reviewed ? 'reviewed' : 'draft');
    const row = buildMotionDatasetRow({
      exerciseId: exercise.id,
      label: trainable ? normalizedLabel : 'unlabeled',
      motionLabel: trainable ? normalizedLabel : null,
      suggestedLabel,
      labelStatus,
      dataQuality,
      trainable,
      scoreable: trainable,
      repComplete: complete,
      completionSource,
      missingPrimary,
      missingStabilizer,
      landmarkSchemaId,
      bodyRegion: exercise.bodyRegion || null,
      primaryRequiredLandmarks: exercise.primaryRequiredLandmarks || [],
      stabilizerRequiredLandmarks: exercise.stabilizerRequiredLandmarks || [],
      modelInputLandmarks: exercise.modelInputLandmarks || [],
      jointNames: exercise.jointNames || [],
      frames: repFrames,
      source,
      subjectId,
      metadata: { exerciseId: exercise.id, targetReps, datasetThresholds: thresholds },
    });
    rows.push(row);
    return row;
  }

  return {
    start,
    stop,
    pushFrame,
    completeRep,
    get active() { return active; },
    get frames() { return frames.slice(); },
    get rows() { return rows.slice(); },
    clearRows() { rows = []; },
  };
}
