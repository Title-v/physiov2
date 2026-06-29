// PhysioAI · Motion Quality Engine v2.
//
// Pure frame-by-frame practice engine shared by patient practice and therapist
// validation. Rep exercises require a therapist motion reference; hold exercises
// use a hold-pose reference. Completed bad reps are counted, then marked invalid.

import { jointAngleCalculatorDetailed } from './JointAngleCalculator.js';

export const REFERENCE_KINDS = {
  MOTION_CYCLE: 'motion_cycle',
  ALTERNATING_MOTION_CYCLE: 'alternating_motion_cycle',
  HOLD_POSE: 'hold_pose',
};

export const DEFAULT_MOTION_THRESHOLDS = Object.freeze({
  restPct: 20,
  leaveRestPct: 35,
  targetPct: 85,
  holdTargetMs: 120,
  holdRestMs: 120,
  minRepMs: 600,
  maxRepMs: 12000,
  validScore: 60,
  boundaryInsideRatio: 0.8,
  visibleJointRatio: 0.8,
  minUsableRangeDeg: 15,
  weights: {
    pose: 0.35,
    path: 0.25,
    targetReach: 0.15,
    visibility: 0.10,
    boundary: 0.10,
    tempo: 0.05,
  },
});

export const DEFAULT_HOLD_THRESHOLDS = Object.freeze({
  validScore: 60,
  boundaryInsideRatio: 0.8,
  visibleJointRatio: 0.8,
  stabilityTolDeg: 8,
  minHoldCompletionRatio: 0.85,
  weights: {
    pose: 0.55,
    stability: 0.15,
    visibility: 0.10,
    boundary: 0.15,
    duration: 0.05,
  },
});

export const DEFAULT_AI_FUSION_THRESHOLDS = Object.freeze({
  enabled: true,
  minConfidence: 0.75,
  minFrameRatio: 0.3,
  penaltyWeight: 0.2,
  qualityScores: {
    good: 100,
    incomplete: 55,
    wrong_path: 40,
    unstable: 50,
    out_of_frame: 30,
  },
  reasonByQuality: {
    incomplete: 'ai_incomplete',
    wrong_path: 'ai_wrong_path',
    unstable: 'ai_unstable',
    out_of_frame: 'ai_out_of_frame',
  },
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Number.isFinite(value) ? Math.round(value) : null;
const scoreClamp = (value) => round(clamp(value, 0, 100));
const isInside = (boundary) => boundary?.status === 'inside';

function mean(values) {
  const list = values.filter((value) => Number.isFinite(value));
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

function stdDev(values) {
  const list = values.filter((value) => Number.isFinite(value));
  if (list.length < 2) return 0;
  const avg = mean(list);
  return Math.sqrt(list.reduce((sum, value) => sum + (value - avg) ** 2, 0) / list.length);
}

function scoreFromDelta(delta, tolerance) {
  const tol = Math.max(1, Number(tolerance) || 15);
  return clamp((1 - Math.abs(delta) / (tol * 3)) * 100, 0, 100);
}

function knownJointsFrom(reference, exercise) {
  const fromReference = [
    ...(reference?.scoringJoints || []),
    ...(reference?.repJoints || []),
    ...(reference?.primaryJoints || []),
  ];
  const fromMotion = Object.keys(reference?.jointMotion || {});
  const fromExercise = [
    ...(exercise?.repJoints || []),
    ...(exercise?.primaryJoints || []),
    exercise?.dominantJoint,
    exercise?.primaryJoint,
  ].filter(Boolean);
  return [...new Set([...fromReference, ...fromMotion, ...fromExercise].filter(Boolean))];
}

function normalizeReference(reference, exercise = {}) {
  if (!reference) return null;
  const kind = reference.kind ||
    (exercise.type === 'hold' || reference.holdTargetAngles ? REFERENCE_KINDS.HOLD_POSE : null) ||
    (reference.referenceSequence
      ? (reference.movementPattern === 'alternating'
        ? REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE
        : REFERENCE_KINDS.MOTION_CYCLE)
      : null);
  return { ...reference, kind };
}

export function isUsablePracticeReference(reference, exercise = {}) {
  const ref = normalizeReference(reference, exercise);
  if (!ref?.kind) return false;
  if (ref.kind === REFERENCE_KINDS.HOLD_POSE) {
    const angles = ref.holdTargetAngles || ref.jointAngles || ref.targetJointAngles;
    return !!angles && knownJointsFrom(ref, exercise).some((joint) => Number.isFinite(angles[joint]));
  }
  const sequence = ref.referenceSequence;
  if (ref.kind === REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE) {
    const sides = ref.alternatingSides || Object.keys(ref.sideMotions || {});
    return !!sequence
      && Array.isArray(sequence.frames)
      && sequence.frames.length >= 2
      && sides.length >= 2
      && sides.every((side) => knownJointsFrom(sideReference(ref, side), exercise).length > 0);
  }
  return !!sequence
    && Array.isArray(sequence.frames)
    && sequence.frames.length >= 2
    && knownJointsFrom(ref, exercise).length > 0;
}

function jointMotionFor(reference, joint) {
  return reference?.jointMotion?.[joint] ||
    reference?.sideMotions?.left?.jointMotion?.[joint] ||
    reference?.sideMotions?.right?.jointMotion?.[joint] ||
    null;
}

function motionRange(motion) {
  return Math.max(
    Number(motion?.range) || 0,
    Number(motion?.trajectoryRange) || 0,
    Number.isFinite(motion?.target) && Number.isFinite(motion?.rest)
      ? Math.abs(motion.target - motion.rest)
      : 0,
  );
}

function progressForJoint(angle, motion) {
  const rest = Number(motion?.rest);
  const target = Number(motion?.target);
  const denom = target - rest;
  if (!Number.isFinite(angle) || !Number.isFinite(rest) || Math.abs(denom) < 1e-6) return null;
  return clamp((angle - rest) / denom, 0, 1);
}

function motionProgress(jointAngles, reference, joints) {
  let sum = 0;
  let weightSum = 0;
  for (const joint of joints) {
    const motion = jointMotionFor(reference, joint);
    if (!motion || motion.contributesToProgress === false) continue;
    const progress = progressForJoint(jointAngles?.[joint], motion);
    if (progress == null) continue;
    const weight = Math.max(0, Number(motion.weight) || motionRange(motion) || 1);
    sum += progress * weight;
    weightSum += weight;
  }
  if (weightSum > 0) return sum / weightSum;

  const primary = reference?.dominantJoint || reference?.primaryJoint || joints[0];
  return progressForJoint(jointAngles?.[primary], jointMotionFor(reference, primary));
}

function sideReference(reference, side) {
  const sideMotion = reference?.sideMotions?.[side] || {};
  const targetAngles = reference?.targetJointAnglesBySide?.[side] ||
    sideMotion.targetJointAngles ||
    reference?.targetJointAngles ||
    reference?.jointAngles ||
    null;
  const repJoints = sideMotion.repJoints ||
    sideMotion.primaryJoints ||
    Object.keys(sideMotion.jointMotion || {});
  return {
    ...reference,
    ...sideMotion,
    movementPattern: 'alternating',
    jointMotion: sideMotion.jointMotion || {},
    repJoints,
    primaryJoints: sideMotion.primaryJoints || repJoints,
    scoringJoints: sideMotion.scoringJoints || repJoints,
    dominantJoint: sideMotion.dominantJoint || repJoints[0] || reference?.dominantJoint,
    primaryJoint: sideMotion.primaryJoint || sideMotion.dominantJoint || repJoints[0] || reference?.primaryJoint,
    restJointAngles: reference?.restJointAngles,
    targetJointAngles: targetAngles,
    jointAngles: targetAngles,
    referenceSequence: sideMotion.referenceSequence || null,
  };
}

function sideProgresses(jointAngles, reference) {
  const sides = reference?.alternatingSides || Object.keys(reference?.sideMotions || {});
  return sides
    .map((side) => {
      const scoringReference = sideReference(reference, side);
      const scoringJoints = knownJointsFrom(scoringReference, {});
      const progress = motionProgress(jointAngles, scoringReference, scoringJoints);
      return { side, progress, progressPct: progress == null ? 0 : Math.round(progress * 100), reference: scoringReference, joints: scoringJoints };
    })
    .filter((row) => row.joints.length);
}

function strongestSide(progressRows) {
  return progressRows
    .filter((row) => row.progress != null)
    .sort((a, b) => b.progress - a.progress)[0] || null;
}

function expectedFrameForProgress(sequence, progress) {
  const frames = Array.isArray(sequence?.frames) ? sequence.frames : [];
  if (!frames.length) return null;
  let best = frames[0];
  let bestDistance = Infinity;
  for (const frame of frames) {
    const p = Number.isFinite(frame.p) ? frame.p : null;
    const distance = p == null ? Infinity : Math.abs(p - progress);
    if (distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return bestDistance === Infinity ? frames[0] : best;
}

function scorePathProgress(liveProgress, expectedProgress, tolerance = 0.15) {
  if (!Number.isFinite(liveProgress) || !Number.isFinite(expectedProgress)) return 0;
  const delta = Math.abs(liveProgress - expectedProgress);
  return scoreClamp((1 - delta / Math.max(0.01, tolerance)) * 100);
}

function interpolatedAnglesFor(reference, progress) {
  const rest = reference?.restJointAngles;
  const target = reference?.targetJointAngles || reference?.jointAngles;
  if (!rest || !target) return null;
  const out = {};
  const p = clamp(Number(progress) || 0, 0, 1);
  for (const joint of new Set([...Object.keys(rest), ...Object.keys(target)])) {
    const a = rest[joint];
    const b = target[joint];
    if (Number.isFinite(a) && Number.isFinite(b)) out[joint] = a + (b - a) * p;
  }
  return Object.keys(out).length ? out : null;
}

function expectedAnglesFor(reference, progress) {
  const frame = expectedFrameForProgress(reference?.referenceSequence, progress);
  return frame?.angles || interpolatedAnglesFor(reference, progress) || reference?.targetJointAngles || reference?.jointAngles || null;
}

function expectedPoseAnglesFor(reference, progress) {
  return interpolatedAnglesFor(reference, progress) || reference?.targetJointAngles || reference?.jointAngles || expectedAnglesFor(reference, progress);
}

function scoreTrajectoryFrame(liveAngles, reference, progress, joints) {
  const expectedFrame = expectedFrameForProgress(reference?.referenceSequence, progress);
  if (!expectedFrame?.angles) return null;
  return scoreAngles(liveAngles, expectedFrame.angles, reference, joints);
}

function scoreAngles(liveAngles, expectedAngles, reference, joints) {
  const rows = [];
  for (const joint of joints) {
    const live = liveAngles?.[joint];
    const expected = expectedAngles?.[joint];
    if (!Number.isFinite(live) || !Number.isFinite(expected)) continue;
    const motion = jointMotionFor(reference, joint);
    const tol = motion?.tol ?? reference?.plan?.tol ?? 15;
    const delta = Math.abs(live - expected);
    rows.push({
      joint,
      live,
      expected,
      delta,
      tol,
      score: scoreFromDelta(delta, tol),
    });
  }
  return {
    score: scoreClamp(mean(rows.map((row) => row.score)) ?? 0),
    rows,
    visibleRatio: joints.length ? rows.length / joints.length : 0,
    worst: rows.slice().sort((a, b) => (b.delta / b.tol) - (a.delta / a.tol))[0] || null,
  };
}

function countReasons(reps) {
  const reasons = {};
  for (const rep of reps) {
    for (const reason of rep.reasons || []) reasons[reason] = (reasons[reason] || 0) + 1;
  }
  return reasons;
}

function mergeCounts(...items) {
  const out = {};
  for (const item of items) {
    for (const [key, value] of Object.entries(item || {})) out[key] = (out[key] || 0) + value;
  }
  return out;
}

function visibleRatioFromAngleMeta(angleMeta, joints, fallbackRatio = 0) {
  if (!angleMeta) return fallbackRatio;
  const trackedJoints = joints.filter(Boolean);
  if (trackedJoints.length && Array.isArray(angleMeta.usableJoints)) {
    const usable = new Set(angleMeta.usableJoints);
    return trackedJoints.filter((joint) => usable.has(joint)).length / trackedJoints.length;
  }
  return Number.isFinite(angleMeta.usableJointRatio) ? angleMeta.usableJointRatio : fallbackRatio;
}

function aggregateReps(repSummaries, dose = {}) {
  const reps = repSummaries.length;
  const validReps = repSummaries.filter((rep) => rep.valid).length;
  const invalidRepCount = reps - validReps;
  const avg = (key) => scoreClamp(mean(repSummaries.map((rep) => rep[key])) ?? 0);
  const repOverallScores = repSummaries.map((rep) => rep.overallScore).filter(Number.isFinite);
  const avgRepQualityScore = scoreClamp(mean(repOverallScores) ?? 0);
  const prescribedReps = Math.max(1, Number(dose.reps) || Number(dose.targetReps) || reps || 1);
  const prescribedSets = Math.max(1, Number(dose.sets) || 1);
  const completionScore = scoreClamp((reps / (prescribedReps * prescribedSets)) * 100);
  const consistencyScore = scoreClamp(100 - stdDev(repOverallScores));
  const overallScore = scoreClamp(
    avgRepQualityScore * 0.75 +
    completionScore * 0.15 +
    consistencyScore * 0.10,
  );
  return {
    type: 'rep',
    reps,
    validReps,
    invalidRepCount,
    overallScore,
    avgScore: overallScore,
    avgRepQualityScore,
    completionScore,
    consistencyScore,
    avgPoseScore: avg('poseScore'),
    avgPathScore: avg('pathScore'),
    avgTargetReachScore: avg('targetReachScore'),
    avgBoundaryScore: avg('boundaryScore'),
    avgVisibilityScore: avg('visibilityScore'),
    avgTempoScore: avg('tempoScore'),
    avgAiQualityScore: avg('aiQualityScore'),
    aiSignalCounts: mergeCounts(...repSummaries.map((rep) => rep.aiSignalCounts)),
    invalidReasons: countReasons(repSummaries),
    repSummaries,
  };
}

function normalizeWeights(primary, extra) {
  const merged = { ...primary, ...extra };
  const total = Object.values(merged).reduce((sum, value) => sum + (Number(value) || 0), 0) || 1;
  const out = {};
  for (const [key, value] of Object.entries(merged)) out[key] = (Number(value) || 0) / total;
  return out;
}

function frameTimestamp(input) {
  const n = Number(input?.timestamp ?? input?.time ?? input?.now ?? Date.now());
  return Number.isFinite(n) ? n : Date.now();
}

function assessAiSignal(aiSignal, thresholds) {
  if (!thresholds.enabled || !aiSignal) return null;
  const confidence = Number(aiSignal.confidence);
  if (!Number.isFinite(confidence) || confidence < thresholds.minConfidence) return null;
  const quality = thresholds.qualityScores[aiSignal.quality] != null ? aiSignal.quality : 'good';
  const qualityScore = scoreClamp(thresholds.qualityScores[quality]);
  return {
    phase: aiSignal.phase || null,
    quality,
    confidence: clamp(confidence, 0, 1),
    qualityScore,
    reason: thresholds.reasonByQuality[quality] || null,
  };
}

function summarizeAiAssessments(frames, thresholds) {
  const assessments = frames.map((frame) => frame.aiAssessment).filter(Boolean);
  const counts = {};
  const reasonCounts = {};
  for (const item of assessments) {
    counts[item.quality] = (counts[item.quality] || 0) + 1;
    if (item.reason) reasonCounts[item.reason] = (reasonCounts[item.reason] || 0) + 1;
  }
  const confidentFrameRatio = frames.length ? assessments.length / frames.length : 0;
  const avgAiQualityScore = assessments.length ? scoreClamp(mean(assessments.map((item) => item.qualityScore)) ?? 100) : null;
  const strongestReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const reasonRatio = strongestReason && frames.length ? reasonCounts[strongestReason] / frames.length : 0;
  return {
    counts,
    avgAiQualityScore,
    confidentFrameRatio: Math.round(confidentFrameRatio * 1000) / 1000,
    reason: reasonRatio >= thresholds.minFrameRatio ? strongestReason : null,
    reasonRatio: Math.round(reasonRatio * 1000) / 1000,
  };
}

function fuseAssistiveAiScore(ruleScore, aiSummary, thresholds) {
  if (!Number.isFinite(ruleScore) || !aiSummary?.reason || !Number.isFinite(aiSummary.avgAiQualityScore)) return ruleScore;
  const weight = clamp(Number(thresholds.penaltyWeight) || 0, 0, 0.5);
  const fused = ruleScore * (1 - weight) + aiSummary.avgAiQualityScore * weight;
  return Math.min(scoreClamp(ruleScore), scoreClamp(fused));
}

export function createMotionQualityEngine({
  exercise = {},
  reference,
  dose = {},
  thresholds = {},
  lang = 'th',
} = {}) {
  const ref = normalizeReference(reference, exercise);
  const kind = ref?.kind;
  const motionThresholds = { ...DEFAULT_MOTION_THRESHOLDS, ...(thresholds.motion || thresholds) };
  motionThresholds.weights = normalizeWeights(DEFAULT_MOTION_THRESHOLDS.weights, thresholds.weights || thresholds.motion?.weights || {});
  const holdThresholds = { ...DEFAULT_HOLD_THRESHOLDS, ...(thresholds.hold || {}) };
  holdThresholds.weights = normalizeWeights(DEFAULT_HOLD_THRESHOLDS.weights, thresholds.hold?.weights || {});
  const aiThresholds = {
    ...DEFAULT_AI_FUSION_THRESHOLDS,
    ...(thresholds.ai || {}),
    qualityScores: {
      ...DEFAULT_AI_FUSION_THRESHOLDS.qualityScores,
      ...(thresholds.ai?.qualityScores || {}),
    },
    reasonByQuality: {
      ...DEFAULT_AI_FUSION_THRESHOLDS.reasonByQuality,
      ...(thresholds.ai?.reasonByQuality || {}),
    },
  };
  const joints = knownJointsFrom(ref, exercise);

  let phase = kind === REFERENCE_KINDS.HOLD_POSE ? 'holding' : 'waiting_rest';
  let targetSince = null;
  let restSince = null;
  let repStartedAt = null;
  let currentRepFrames = [];
  let repSummaries = [];
  let activeSide = null;
  let pendingCycleRep = null;
  let lastSnapshot = null;
  let lastFrameAt = null;
  let holdFrames = [];
  let holdStartedAt = null;

  function angleDataFromInput(input) {
    if (input?.jointAngles) return { jointAngles: input.jointAngles, angleMeta: input.angleMeta || null };
    if (input?.landmarks) {
      const detailed = jointAngleCalculatorDetailed(input.landmarks, {
        minVisibility: exercise.minVisibility,
        use3D: exercise.allow3D,
      });
      return { jointAngles: detailed.angles, angleMeta: detailed.meta };
    }
    return { jointAngles: null, angleMeta: null };
  }

  function buildCue(snapshot) {
    if (!snapshot.hasPose) return { id: 'no_pose', tone: 'none', text: lang === 'th' ? 'เข้ากรอบกล้องก่อน' : 'Step into frame' };
    if (snapshot.boundaryStatus !== 'inside') return { id: 'out_of_frame', tone: 'bad', text: lang === 'th' ? 'อยู่ในกรอบกล้องให้ครบตัว' : 'Stay inside the camera frame' };
    if (snapshot.phase === 'waiting_rest') return { id: 'start_rest', tone: 'none', text: lang === 'th' ? 'เริ่มจากท่าพัก' : 'Start from rest' };
    if (snapshot.phase === 'moving_to_target' && snapshot.progressPct < motionThresholds.targetPct) return { id: 'reach_target', tone: 'warn', text: lang === 'th' ? 'ขยับให้ถึงเป้าอีกนิด' : 'Reach a little further' };
    if (snapshot.phase === 'returning') return { id: 'return_rest', tone: 'none', text: lang === 'th' ? 'กลับสู่ท่าพัก' : 'Return to rest' };
    if (snapshot.overallScore != null && snapshot.overallScore < motionThresholds.validScore) return { id: 'adjust_form', tone: 'warn', text: lang === 'th' ? 'จัดท่าให้ใกล้ reference' : 'Match the reference form' };
    return { id: 'good', tone: 'good', text: lang === 'th' ? 'ดี ทำต่อได้' : 'Good, keep going' };
  }

  function summarizeCurrentRep(endTime) {
    const frames = currentRepFrames;
    const durationMs = Math.max(1, endTime - (repStartedAt ?? endTime));
    const avg = (key) => scoreClamp(mean(frames.map((frame) => frame[key])) ?? 0);
    const boundaryInsideRatio = frames.length ? frames.filter((frame) => frame.boundaryInside).length / frames.length : 0;
    const visibleJointRatio = mean(frames.map((frame) => frame.visibleJointRatio)) ?? 0;
    const targetReachScore = scoreClamp((Math.max(...frames.map((frame) => frame.progressPct), 0) / motionThresholds.targetPct) * 100);
    const expectedDuration = Number(ref?.referenceSequence?.durationMs) || durationMs;
    const tempoScore = scoreClamp(100 - Math.abs(durationMs - expectedDuration) / Math.max(1, expectedDuration) * 100);
    const poseScore = avg('poseScore');
    const pathScore = avg('pathScore');
    const boundaryScore = scoreClamp(boundaryInsideRatio * 100);
    const visibilityScore = avg('visibilityScore');
    const aiSummary = summarizeAiAssessments(frames, aiThresholds);
    const ruleOverallScore = scoreClamp(
      poseScore * motionThresholds.weights.pose +
      pathScore * motionThresholds.weights.path +
      targetReachScore * motionThresholds.weights.targetReach +
      visibilityScore * motionThresholds.weights.visibility +
      boundaryScore * motionThresholds.weights.boundary +
      tempoScore * motionThresholds.weights.tempo,
    );
    const overallScore = fuseAssistiveAiScore(ruleOverallScore, aiSummary, aiThresholds);
    const reasons = [];
    if (targetReachScore < motionThresholds.targetPct) reasons.push('incomplete_target');
    if (pathScore < motionThresholds.validScore) reasons.push('wrong_path');
    if (overallScore < motionThresholds.validScore) reasons.push('low_pose_score');
    if (boundaryInsideRatio < motionThresholds.boundaryInsideRatio) reasons.push('out_of_frame');
    if (visibleJointRatio < motionThresholds.visibleJointRatio) reasons.push('low_visibility');
    if (durationMs < motionThresholds.minRepMs) reasons.push('too_fast');
    if (durationMs > motionThresholds.maxRepMs) reasons.push('too_slow');
    if (aiSummary.reason) reasons.push(aiSummary.reason);
    const valid = !reasons.length;
    return {
      index: repSummaries.length + 1,
      valid,
      reasons,
      overallScore,
      ruleOverallScore,
      poseScore,
      pathScore,
      targetReachScore,
      boundaryScore,
      visibilityScore,
      tempoScore,
      aiQualityScore: aiSummary.avgAiQualityScore,
      aiSignalCounts: aiSummary.counts,
      aiReasonRatio: aiSummary.reasonRatio,
      durationMs,
      side: activeSide,
      boundaryInsideRatio: Math.round(boundaryInsideRatio * 1000) / 1000,
      visibleJointRatio: Math.round(visibleJointRatio * 1000) / 1000,
      frameCount: frames.length,
    };
  }

  function mergeCycleReps(first, second) {
    const sideChanged = first.side && second.side && first.side !== second.side;
    const reasons = [...new Set([
      ...(first.reasons || []),
      ...(second.reasons || []),
      ...(sideChanged ? [] : ['same_side_cycle']),
    ])];
    const durationMs = (first.durationMs || 0) + (second.durationMs || 0);
    const avg = (key) => scoreClamp(mean([first[key], second[key]]) ?? 0);
    const overallScore = avg('overallScore');
    return {
      index: repSummaries.length + 1,
      valid: sideChanged && first.valid && second.valid && !reasons.length,
      reasons,
      overallScore,
      ruleOverallScore: avg('ruleOverallScore'),
      poseScore: avg('poseScore'),
      pathScore: avg('pathScore'),
      targetReachScore: avg('targetReachScore'),
      boundaryScore: avg('boundaryScore'),
      visibilityScore: avg('visibilityScore'),
      tempoScore: avg('tempoScore'),
      aiQualityScore: avg('aiQualityScore'),
      aiSignalCounts: mergeCounts(first.aiSignalCounts, second.aiSignalCounts),
      aiReasonRatio: Math.round(mean([first.aiReasonRatio, second.aiReasonRatio]) * 1000) / 1000,
      durationMs,
      sides: [first.side, second.side].filter(Boolean),
      sideSummaries: [first, second],
      boundaryInsideRatio: Math.round(mean([first.boundaryInsideRatio, second.boundaryInsideRatio]) * 1000) / 1000,
      visibleJointRatio: Math.round(mean([first.visibleJointRatio, second.visibleJointRatio]) * 1000) / 1000,
      frameCount: (first.frameCount || 0) + (second.frameCount || 0),
    };
  }

  function commitCompletedRep(rep) {
    if (kind !== REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE || ref?.countMode !== 'cycle') {
      const completed = { ...rep, index: repSummaries.length + 1 };
      repSummaries.push(completed);
      return completed;
    }
    if (!pendingCycleRep) {
      pendingCycleRep = rep;
      return null;
    }
    const completed = mergeCycleReps(pendingCycleRep, rep);
    pendingCycleRep = null;
    repSummaries.push(completed);
    return completed;
  }

  function pushMotionFrame(input) {
    const timestamp = frameTimestamp(input);
    const aiSignal = input?.aiSignal || null;
    const aiAssessment = assessAiSignal(aiSignal, aiThresholds);
    lastFrameAt = timestamp;
    const { jointAngles, angleMeta } = angleDataFromInput(input);
    const hasPose = !!jointAngles;
    const boundaryStatus = input?.boundary?.status || 'unknown';
    const isAlternating = kind === REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE;
    const sideRows = hasPose && isAlternating ? sideProgresses(jointAngles, ref) : [];
    const strongest = strongestSide(sideRows);
    const activeRow = activeSide ? sideRows.find((row) => row.side === activeSide) : null;
    const scoringRow = activeRow || strongest;
    const scoringReference = isAlternating && scoringRow ? scoringRow.reference : ref;
    const scoringJoints = isAlternating && scoringRow?.joints?.length ? scoringRow.joints : joints;
    const progress = hasPose
      ? (isAlternating ? (scoringRow?.progress ?? null) : motionProgress(jointAngles, ref, joints))
      : null;
    const progressPct = progress == null ? 0 : Math.round(progress * 100);
    const poseExpectedAngles = expectedPoseAnglesFor(scoringReference, progress ?? 0);
    const poseScored = hasPose ? scoreAngles(jointAngles, poseExpectedAngles, scoringReference, scoringJoints) : { score: 0, rows: [], visibleRatio: 0, worst: null };
    const trajectoryScored = hasPose ? scoreTrajectoryFrame(jointAngles, scoringReference, progress ?? 0, scoringJoints) : null;
    const pathScore = trajectoryScored?.score ?? poseScored.score;
    const poseScore = poseScored.score;
    const visibleJointRatio = visibleRatioFromAngleMeta(angleMeta, scoringJoints, poseScored.visibleRatio);
    const visibilityScore = scoreClamp(visibleJointRatio * 100);
    const boundaryInside = isInside(input?.boundary);
    const frameScore = {
      timestamp,
      progressPct,
      poseScore,
      pathScore,
      boundaryInside,
      visibleJointRatio,
      visibilityScore,
      aiSignal,
      aiAssessment,
    };

    const atRest = progressPct <= motionThresholds.restPct;
    const leftRest = progressPct > motionThresholds.leaveRestPct;
    const atTarget = progressPct >= motionThresholds.targetPct;
    let completedRep = null;

    if (phase === 'waiting_rest') {
      if (atRest) restSince = restSince || timestamp;
      else restSince = null;
      if ((restSince && timestamp - restSince >= motionThresholds.holdRestMs) || leftRest) {
        if (leftRest) {
          phase = 'moving_to_target';
          repStartedAt = timestamp;
          currentRepFrames = [];
          if (isAlternating) activeSide = strongest?.side || activeSide;
          targetSince = null;
        }
      }
    }

    if (phase === 'moving_to_target') {
      currentRepFrames.push(frameScore);
      if (atTarget) targetSince = targetSince || timestamp;
      else targetSince = null;
      if (targetSince && timestamp - targetSince >= motionThresholds.holdTargetMs) {
        phase = 'returning';
        restSince = null;
      }
    } else if (phase === 'returning') {
      currentRepFrames.push(frameScore);
      if (atRest) restSince = restSince || timestamp;
      else restSince = null;
      if (restSince && timestamp - restSince >= motionThresholds.holdRestMs) {
        const sideRep = summarizeCurrentRep(timestamp);
        completedRep = commitCompletedRep(sideRep);
        phase = 'waiting_rest';
        currentRepFrames = [];
        repStartedAt = null;
        targetSince = null;
        activeSide = null;
      }
    }

    const aggregate = aggregateReps(repSummaries, dose);
    const ruleCurrentScore = scoreClamp(
      poseScore * motionThresholds.weights.pose +
      pathScore * motionThresholds.weights.path +
      Math.min(100, (progressPct / motionThresholds.targetPct) * 100) * motionThresholds.weights.targetReach +
      visibilityScore * motionThresholds.weights.visibility +
      (boundaryInside ? 100 : 0) * motionThresholds.weights.boundary +
      100 * motionThresholds.weights.tempo,
    );
    const currentScore = fuseAssistiveAiScore(
      ruleCurrentScore,
      aiAssessment?.reason ? { reason: aiAssessment.reason, avgAiQualityScore: aiAssessment.qualityScore } : null,
      aiThresholds,
    );
    const snapshot = {
      kind,
      phase,
      hasPose,
      boundaryStatus,
      aiSignal,
      aiAssessment,
      progressPct,
      currentScore,
      ruleCurrentScore,
      poseScore,
      pathScore,
      targetReachScore: Math.min(100, Math.round((progressPct / motionThresholds.targetPct) * 100)),
      visibilityScore,
      visibleJointRatio,
      boundaryScore: boundaryInside ? 100 : 0,
      tempoScore: 100,
      overallScore: currentScore,
      activeSide,
      strongestSide: strongest?.side || null,
      sideProgresses: sideRows.map((row) => ({ side: row.side, progressPct: row.progressPct })),
      pendingAlternatingSide: pendingCycleRep?.side || null,
      jointDeltas: poseScored.rows,
      worstJoint: poseScored.worst,
      repCount: aggregate.reps,
      reps: aggregate.reps,
      validReps: aggregate.validReps,
      invalidRepCount: aggregate.invalidRepCount,
      completedRep,
      repSummaries: aggregate.repSummaries,
      cue: null,
    };
    snapshot.cue = buildCue(snapshot);
    lastSnapshot = snapshot;
    return snapshot;
  }

  function pushHoldFrame(input) {
    const timestamp = frameTimestamp(input);
    const aiSignal = input?.aiSignal || null;
    const aiAssessment = assessAiSignal(aiSignal, aiThresholds);
    lastFrameAt = timestamp;
    const { jointAngles, angleMeta } = angleDataFromInput(input);
    const hasPose = !!jointAngles;
    const expectedAngles = ref?.holdTargetAngles || ref?.jointAngles || ref?.targetJointAngles || {};
    const scored = hasPose ? scoreAngles(jointAngles, expectedAngles, ref, joints) : { score: 0, rows: [], visibleRatio: 0, worst: null };
    if (holdStartedAt == null) holdStartedAt = timestamp;
    const boundaryInside = isInside(input?.boundary);
    const visibleJointRatio = visibleRatioFromAngleMeta(angleMeta, joints, scored.visibleRatio);
    const visibilityScore = scoreClamp(visibleJointRatio * 100);
    holdFrames.push({
      timestamp,
      poseScore: scored.score,
      boundaryInside,
      visibleJointRatio,
      visibilityScore,
      jointAngles,
      aiSignal,
      aiAssessment,
    });
    const summary = finishHoldSummary(timestamp);
    const snapshot = {
      kind,
      phase: 'holding',
      hasPose,
      aiSignal,
      aiAssessment,
      boundaryStatus: input?.boundary?.status || 'unknown',
      progressPct: summary.durationScore,
      repCount: summary.reps,
      reps: summary.reps,
      validReps: summary.validReps,
      invalidRepCount: summary.invalidRepCount,
      poseScore: summary.avgPoseScore,
      stabilityScore: summary.avgStabilityScore,
      boundaryScore: summary.avgBoundaryScore,
      visibilityScore: summary.avgVisibilityScore,
      durationScore: summary.durationScore,
      overallScore: summary.overallScore,
      currentScore: summary.overallScore,
      jointDeltas: scored.rows,
      worstJoint: scored.worst,
      cue: summary.overallScore >= holdThresholds.validScore
        ? { id: 'hold_good', tone: 'good', text: lang === 'th' ? 'ค้างได้ดี' : 'Good hold' }
        : { id: 'hold_adjust', tone: 'warn', text: lang === 'th' ? 'ค้างให้นิ่งและอยู่ในกรอบ' : 'Hold steady inside the frame' },
    };
    lastSnapshot = snapshot;
    return snapshot;
  }

  function finishHoldSummary(now = Date.now()) {
    const frames = holdFrames;
    const durationMs = Math.max(0, now - (holdStartedAt ?? now));
    const targetMs = Math.max(1, Number(dose.holdSec || exercise.holdSec || ref?.holdMinDurationMs / 1000 || 10) * 1000);
    const avgPoseScore = scoreClamp(mean(frames.map((frame) => frame.poseScore)) ?? 0);
    const boundaryInsideRatio = frames.length ? frames.filter((frame) => frame.boundaryInside).length / frames.length : 0;
    const avgBoundaryScore = scoreClamp(boundaryInsideRatio * 100);
    const visibleJointRatio = mean(frames.map((frame) => frame.visibleJointRatio)) ?? 0;
    const avgVisibilityScore = scoreClamp(mean(frames.map((frame) => frame.visibilityScore)) ?? 0);
    const jointStability = [];
    for (const joint of joints) {
      jointStability.push(stdDev(frames.map((frame) => frame.jointAngles?.[joint])));
    }
    const stabilitySpread = mean(jointStability) ?? 0;
    const avgStabilityScore = scoreClamp(100 - stabilitySpread / holdThresholds.stabilityTolDeg * 100);
    const durationScore = scoreClamp(durationMs / targetMs * 100);
    const aiSummary = summarizeAiAssessments(frames, aiThresholds);
    const ruleOverallScore = scoreClamp(
      avgPoseScore * holdThresholds.weights.pose +
      avgStabilityScore * holdThresholds.weights.stability +
      avgVisibilityScore * holdThresholds.weights.visibility +
      avgBoundaryScore * holdThresholds.weights.boundary +
      durationScore * holdThresholds.weights.duration,
    );
    const overallScore = fuseAssistiveAiScore(ruleOverallScore, aiSummary, aiThresholds);
    const reasons = [];
    if (overallScore < holdThresholds.validScore) reasons.push('low_pose_score');
    if (avgStabilityScore < holdThresholds.validScore) reasons.push('unstable_hold');
    if (boundaryInsideRatio < holdThresholds.boundaryInsideRatio) reasons.push('out_of_frame');
    if (visibleJointRatio < holdThresholds.visibleJointRatio) reasons.push('low_visibility');
    if (durationScore < holdThresholds.minHoldCompletionRatio * 100) reasons.push('incomplete_hold_duration');
    if (aiSummary.reason) reasons.push(aiSummary.reason);
    const valid = !reasons.length;
    return {
      type: 'hold',
      reps: durationMs > 0 ? 1 : 0,
      validReps: valid ? 1 : 0,
      invalidRepCount: valid ? 0 : 1,
      holdSecTarget: Math.round(targetMs / 1000),
      holdSecActual: Math.round(durationMs / 1000),
      overallScore,
      avgScore: overallScore,
      ruleOverallScore,
      avgPoseScore,
      avgStabilityScore,
      avgBoundaryScore,
      avgVisibilityScore,
      avgAiQualityScore: aiSummary.avgAiQualityScore,
      aiSignalCounts: aiSummary.counts,
      aiReasonRatio: aiSummary.reasonRatio,
      durationScore,
      boundaryInsideRatio: Math.round(boundaryInsideRatio * 1000) / 1000,
      visibleJointRatio: Math.round(visibleJointRatio * 1000) / 1000,
      invalidReasons: reasons.reduce((acc, reason) => ({ ...acc, [reason]: (acc[reason] || 0) + 1 }), {}),
      repSummaries: [{
        index: 1,
        valid,
        reasons,
        overallScore,
        ruleOverallScore,
        poseScore: avgPoseScore,
        stabilityScore: avgStabilityScore,
        boundaryScore: avgBoundaryScore,
        visibilityScore: avgVisibilityScore,
        aiQualityScore: aiSummary.avgAiQualityScore,
        aiSignalCounts: aiSummary.counts,
        aiReasonRatio: aiSummary.reasonRatio,
        durationScore,
        durationMs,
      }],
    };
  }

  function pushFrame(input) {
    if (!isUsablePracticeReference(ref, exercise)) {
      const snapshot = {
        kind: ref?.kind || null,
        phase: 'missing_reference',
        hasPose: false,
        aiSignal: input?.aiSignal || null,
        progressPct: 0,
        repCount: 0,
        reps: 0,
        validReps: 0,
        invalidRepCount: 0,
        overallScore: null,
        cue: { id: 'missing_reference', tone: 'bad', text: lang === 'th' ? 'ต้องมี reference จากนักกายภาพก่อน' : 'Therapist reference required' },
      };
      lastSnapshot = snapshot;
      return snapshot;
    }
    if (kind === REFERENCE_KINDS.HOLD_POSE) return pushHoldFrame(input);
    return pushMotionFrame(input);
  }

  function finishSummary() {
    if (kind === REFERENCE_KINDS.HOLD_POSE) return finishHoldSummary(lastFrameAt ?? Date.now());
    return aggregateReps(repSummaries, dose);
  }

  function reset() {
    phase = kind === REFERENCE_KINDS.HOLD_POSE ? 'holding' : 'waiting_rest';
    targetSince = null;
    restSince = null;
    repStartedAt = null;
    currentRepFrames = [];
    repSummaries = [];
    activeSide = null;
    pendingCycleRep = null;
    lastSnapshot = null;
    lastFrameAt = null;
    holdFrames = [];
    holdStartedAt = null;
  }

  return {
    kind,
    reference: ref,
    exercise,
    dose,
    pushFrame,
    finishSummary,
    getSnapshot: () => lastSnapshot,
    reset,
  };
}
