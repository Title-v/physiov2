import { normalizeReferenceSchema } from '../ai/ReferenceSchema.js';

function finiteAngleCount(angles = {}, joints = []) {
  return joints.filter((joint) => Number.isFinite(angles?.[joint])).length;
}

function motionRanges(ref) {
  return Object.values(ref?.jointMotion || {})
    .map((motion) => Math.max(
      Number(motion?.range) || 0,
      Number(motion?.trajectoryRange) || 0,
      Number.isFinite(motion?.target) && Number.isFinite(motion?.rest)
        ? Math.abs(motion.target - motion.rest)
        : 0,
    ))
    .filter((value) => Number.isFinite(value));
}

export function scoreReferenceQuality(ref, exercise = {}) {
  const normalized = normalizeReferenceSchema(ref);
  if (!normalized) {
    return {
      score: 0,
      frameCount: 0,
      durationMs: 0,
      trackedJointCount: 0,
      maxRangeDeg: 0,
    };
  }
  const frames = normalized.referenceSequence?.frames || [];
  const ranges = motionRanges(normalized);
  const trackedJointCount = normalized.scoringJoints.length || normalized.repJoints.length;
  const targetAngles = normalized.targetJointAngles || {};
  const usableTargetRatio = trackedJointCount
    ? finiteAngleCount(targetAngles, normalized.scoringJoints.length ? normalized.scoringJoints : normalized.repJoints) / trackedJointCount
    : 0;
  const frameScore = exercise.type === 'hold'
    ? 100
    : Math.min(100, (frames.length / 8) * 100);
  const rangeScore = exercise.type === 'hold'
    ? 100
    : Math.min(100, (Math.max(...ranges, 0) / Math.max(1, Number(exercise.minROMDeg) || 15)) * 100);
  const usableScore = Math.min(100, usableTargetRatio * 100);
  const score = Math.round(frameScore * 0.35 + rangeScore * 0.35 + usableScore * 0.30);
  return {
    score,
    frameCount: frames.length,
    durationMs: Number(normalized.referenceSequence?.durationMs) || 0,
    trackedJointCount,
    maxRangeDeg: Math.round(Math.max(...ranges, 0) * 10) / 10,
    usableTargetRatio: Math.round(usableTargetRatio * 1000) / 1000,
  };
}

export function validateReferenceQuality(ref, exercise = {}) {
  const normalized = normalizeReferenceSchema(ref);
  const issues = [];
  const warnings = [];
  if (!normalized) issues.push('missing_reference');
  if (!normalized?.kind) issues.push('missing_kind');
  const scoringJoints = normalized?.scoringJoints || normalized?.repJoints || [];
  if (!scoringJoints.length) issues.push('missing_scoring_joints');
  if (exercise.type !== 'hold' && !normalized?.referenceSequence?.frames?.length) {
    issues.push('missing_reference_sequence');
  }
  const frames = normalized?.referenceSequence?.frames || [];
  if (frames.length && frames.length < 8) issues.push('too_few_frames');
  if (exercise.type !== 'hold') {
    const minROMDeg = Number(exercise.minROMDeg) || 15;
    const maxRange = Math.max(...motionRanges(normalized), 0);
    if (maxRange < minROMDeg) issues.push('insufficient_rom');
  }
  const targetAngles = normalized?.targetJointAngles || {};
  if (scoringJoints.length && finiteAngleCount(targetAngles, scoringJoints) < Math.max(1, Math.ceil(scoringJoints.length * 0.5))) {
    warnings.push('few_target_angles');
  }
  const quality = scoreReferenceQuality(ref, exercise);
  return {
    ok: issues.length === 0,
    issues,
    warnings,
    quality,
    reference: normalized,
  };
}
