import { buildMotionDatasetRow } from './MotionDataset.js';
import { evaluateMotionSafetyGate } from './MotionSafetyGate.js';
import { normalizeMotionLabel } from './DatasetLabeler.js';

function dataQualityFromFrames(frames) {
  const safetyFrames = frames.map((frame) => frame.safety).filter(Boolean);
  if (!safetyFrames.length) return 'no_pose';
  const failed = safetyFrames.find((safety) => safety.dataQuality && safety.dataQuality !== 'usable');
  return failed?.dataQuality || 'usable';
}

function missingFromFrames(frames, key) {
  return [...new Set(frames.flatMap((frame) => frame.safety?.[key] || []))];
}

export function createMotionDatasetRecorder({
  exercise = {},
  landmarkSchemaId = exercise?.landmarkSchemaId || null,
  labelTarget = 'good',
  targetReps = 10,
  subjectId = 'anon_001',
  source = 'therapist_dataset',
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

  function completeRep({ suggestedLabel = normalizedLabel, reviewed = false } = {}) {
    const repFrames = frames.slice();
    frames = [];
    const dataQuality = dataQualityFromFrames(repFrames);
    const missingPrimary = missingFromFrames(repFrames, 'missingPrimary');
    const missingStabilizer = missingFromFrames(repFrames, 'missingStabilizer');
    const trainable = dataQuality === 'usable' && reviewed && !!normalizedLabel && !missingPrimary.length && !missingStabilizer.length;
    const row = buildMotionDatasetRow({
      exerciseId: exercise.id,
      label: reviewed ? normalizedLabel : 'unlabeled',
      motionLabel: reviewed ? normalizedLabel : null,
      suggestedLabel,
      labelStatus: reviewed ? 'reviewed' : (dataQuality === 'usable' ? 'draft' : 'auto_rejected'),
      dataQuality,
      trainable,
      scoreable: trainable,
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
      metadata: { exerciseId: exercise.id, targetReps },
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
