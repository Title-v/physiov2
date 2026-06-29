import {
  buildAlternatingReferenceMotion,
  buildAlternatingReferenceTrajectory,
  buildReferenceMotion,
  buildReferenceTrajectory,
} from '../../../../shared/ai/MultiJointMotion.js';
import { REFERENCE_KINDS } from '../../../../shared/ai/MotionQualityEngine.js';
import { upgradeReferenceSchema } from '../../../../shared/ai/ReferenceSchema.js';
import { validateReferenceQuality } from '../../../../shared/validation/referenceValidation.js';

export function sideCandidateJointsForAlternating(exercise, bodyRegion, side, { candidateJoints = [], regionJoints = {} } = {}) {
  const fromExercise = candidateJoints
    .filter((joint) => joint.startsWith(`${side}_`));
  if (fromExercise.length) return fromExercise;
  return (regionJoints[bodyRegion] || regionJoints.full || [])
    .filter((joint) => joint.startsWith(`${side}_`));
}

export function movementMagnitude(restAngles, angles, joints) {
  const values = joints
    .map((joint) => {
      const rest = restAngles?.[joint];
      const live = angles?.[joint];
      return Number.isFinite(rest) && Number.isFinite(live) ? Math.abs(live - rest) : null;
    })
    .filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function inferTargetIndexForJoints(frames, startIdx, endIdx, restAngles, joints) {
  const start = Math.max(1, Math.min(frames.length - 2, Math.round(startIdx)));
  const end = Math.max(start, Math.min(frames.length - 2, Math.round(endIdx)));
  let bestIdx = start;
  let bestMagnitude = -Infinity;
  for (let i = start; i <= end; i++) {
    const magnitude = movementMagnitude(restAngles, frames[i]?.jointAngles, joints);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function buildSequenceMotionReference({
  frames,
  exercise,
  referenceExercise,
  targetOffset = null,
  captureRegion,
  candidateJoints = [],
  regionJoints = {},
}) {
  if (!frames?.length) return { ok: false, reason: 'missing_frames' };
  const first = frames[0];
  const last = frames[frames.length - 1];
  const hasCycleTarget = Number.isInteger(targetOffset);
  const targetIdx = hasCycleTarget
    ? Math.max(1, Math.min(frames.length - 2, targetOffset))
    : frames.length - 1;
  const target = frames[targetIdx];
  if (exercise.movementPattern === 'alternating') {
    const leftJoints = sideCandidateJointsForAlternating(referenceExercise, captureRegion, 'left', {
      candidateJoints,
      regionJoints,
    });
    const rightJoints = sideCandidateJointsForAlternating(referenceExercise, captureRegion, 'right', {
      candidateJoints,
      regionJoints,
    });
    if (!leftJoints.length || !rightJoints.length) return { ok: false, reason: 'missing-side-joints' };
    const mid = Math.floor((frames.length - 1) / 2);
    const leftTargetIdx = inferTargetIndexForJoints(frames, 1, Math.max(1, mid), first.jointAngles, leftJoints);
    const rightTargetIdx = inferTargetIndexForJoints(
      frames,
      Math.min(frames.length - 2, Math.max(leftTargetIdx + 2, mid)),
      frames.length - 2,
      first.jointAngles,
      rightJoints,
    );
    if (leftTargetIdx >= rightTargetIdx) return { ok: false, reason: 'bad-alternating-sequence' };
    const leftTarget = frames[leftTargetIdx];
    const rightTarget = frames[rightTargetIdx];
    const motion = buildAlternatingReferenceMotion({
      exercise: referenceExercise,
      restAngles: first.jointAngles,
      leftTargetAngles: leftTarget.jointAngles,
      rightTargetAngles: rightTarget.jointAngles,
      restLandmarks: first.landmarks,
      leftTargetLandmarks: leftTarget.landmarks,
      rightTargetLandmarks: rightTarget.landmarks,
    });
    const referenceSequence = buildAlternatingReferenceTrajectory({ frames, motion, leftTargetIdx, rightTargetIdx });
    if (!referenceSequence) return { ok: false, reason: 'bad-alternating-trajectory' };
    return {
      ok: true,
      motion,
      targetAngles: leftTarget.jointAngles,
      targetLandmarks: leftTarget.landmarks,
      boundary: { status: 'inside', willExit: false },
      source: 'sequence:live-alternating-cycle',
      referenceSequence,
      bodyRegion: captureRegion,
      returnRestAngles: last.jointAngles,
      returnRestLandmarks: last.landmarks,
      targetIndexes: { leftTargetIdx, rightTargetIdx },
    };
  }
  const motion = buildReferenceMotion({
    exercise: referenceExercise,
    restAngles: first.jointAngles,
    targetAngles: target.jointAngles,
    restLandmarks: first.landmarks,
    targetLandmarks: target.landmarks,
  });
  const referenceSequence = buildReferenceTrajectory({
    frames,
    motion,
    targetFrameIndex: hasCycleTarget ? targetIdx : null,
    targetFrameT: hasCycleTarget ? target.t : null,
  });
  if (!referenceSequence) return { ok: false, reason: 'bad-sequence' };
  return {
    ok: true,
    motion,
    targetAngles: target.jointAngles,
    targetLandmarks: target.landmarks,
    boundary: { status: 'inside', willExit: false },
    source: hasCycleTarget ? 'sequence:live-cycle' : 'sequence:live',
    referenceSequence,
    bodyRegion: captureRegion,
    returnRestAngles: hasCycleTarget ? last.jointAngles : null,
    returnRestLandmarks: hasCycleTarget ? last.landmarks : null,
    targetIndexes: { targetIdx },
  };
}

export function buildHoldPoseReference({
  exercise,
  updatedExercise = exercise,
  exerciseId,
  variant,
  source = null,
  captureRegion,
  primaryJoint,
  scoringJoints = [],
  jointAngles = {},
  landmarks = [],
  boundary = {},
  tol,
}) {
  const planTol = tol ?? updatedExercise?.tol ?? exercise?.tol;
  return {
    kind: REFERENCE_KINDS.HOLD_POSE,
    referenceVersion: 2,
    scoringVersion: 2,
    capturedAt: new Date().toISOString(),
    variant,
    exerciseId,
    source,
    exercise: updatedExercise?.source === 'custom' ? updatedExercise : undefined,
    bodyRegion: captureRegion,
    movementPattern: 'hold',
    countMode: updatedExercise?.countMode,
    primaryJoint,
    dominantJoint: primaryJoint,
    repMode: 'hold',
    scoringJoints,
    repJoints: scoringJoints,
    primaryJoints: scoringJoints,
    holdTargetAngles: jointAngles,
    holdTargetLandmarks: landmarks,
    holdMinDurationMs: Math.max(1, Number(updatedExercise?.holdSec || exercise?.holdSec || 10)) * 1000,
    targetJointAngles: jointAngles,
    targetLandmarks: landmarks,
    jointAngles,
    landmarks,
    jointMotion: Object.fromEntries(scoringJoints.map((joint) => [joint, { tol: planTol ?? 15, usedForScoring: true }])),
    boundaryStatus: boundary.status,
    boundaryBoxRatio: boundary.boundaryBoxRatio,
    boundaryWillExit: !!boundary.willExit,
    plan: {
      tol: planTol,
      targetAngle: Math.round(jointAngles[primaryJoint] ?? updatedExercise?.target),
      restAngle: updatedExercise?.rest,
      dir: updatedExercise?.dir,
    },
  };
}

export function buildMotionCycleReference({
  exercise,
  updatedExercise = exercise,
  exerciseId,
  variant,
  motion,
  targetAngles,
  targetLandmarks,
  boundary = {},
  source = null,
  referenceSequence = null,
  bodyRegion = null,
  returnRestAngles = null,
  returnRestLandmarks = null,
  tol,
}) {
  const referenceKind = motion.movementPattern === 'alternating'
    ? REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE
    : REFERENCE_KINDS.MOTION_CYCLE;
  return {
    kind: referenceKind,
    referenceVersion: 2,
    scoringVersion: 2,
    capturedAt: new Date().toISOString(),
    variant,
    exerciseId,
    source,
    exercise: updatedExercise?.source === 'custom' ? updatedExercise : undefined,
    bodyRegion,
    movementPattern: motion.movementPattern,
    alternatingSides: motion.alternatingSides,
    countMode: motion.countMode,
    jointAngles: targetAngles,
    landmarks: targetLandmarks,
    restJointAngles: motion.restJointAngles,
    targetJointAngles: motion.targetJointAngles,
    targetJointAnglesBySide: motion.targetJointAnglesBySide,
    restLandmarks: motion.restLandmarks,
    targetLandmarks: motion.targetLandmarks,
    targetLandmarksBySide: motion.targetLandmarksBySide,
    returnRestJointAngles: returnRestAngles,
    returnRestLandmarks,
    repMode: motion.repMode,
    repJoints: motion.repJoints,
    primaryJoints: motion.primaryJoints,
    scoringJoints: motion.repJoints,
    requestedRepJoints: motion.requestedRepJoints,
    jointRoles: motion.jointRoles,
    dominantJoint: motion.dominantJoint,
    primaryJoint: motion.primaryJoint,
    jointMotion: motion.jointMotion,
    sideMotions: motion.sideMotions,
    boundaryStatus: boundary.status,
    boundaryBoxRatio: boundary.boundaryBoxRatio,
    boundaryWillExit: !!boundary.willExit,
    referenceSequence,
    targetReachThreshold: 0.85,
    restThreshold: 0.2,
    plan: { tol, targetAngle: motion.targetAngle, restAngle: motion.restAngle, dir: motion.dir },
  };
}

export function prepareReferenceForSave(ref, exercise) {
  const validation = validateReferenceQuality(ref, exercise);
  if (!validation.ok) {
    return {
      ok: false,
      reason: 'validation_failed',
      validation,
      issues: validation.issues,
    };
  }
  return {
    ok: true,
    validation,
    reference: upgradeReferenceSchema(ref, validation.quality),
  };
}

export async function persistCaptureReference({
  ref,
  exercise,
  exerciseId,
  patientId = null,
  saveReference,
}) {
  const prepared = prepareReferenceForSave(ref, exercise);
  if (!prepared.ok) return prepared;
  try {
    await saveReference(exerciseId, prepared.reference, patientId);
  } catch (error) {
    return {
      ok: false,
      reason: 'save_failed',
      error,
      validation: prepared.validation,
      reference: prepared.reference,
    };
  }
  return {
    ok: true,
    validation: prepared.validation,
    reference: prepared.reference,
  };
}

export async function persistReferenceForCapture({
  state,
  ref,
  exercise,
  exerciseId,
  patientId = null,
  saveReference,
}) {
  const result = await persistCaptureReference({
    ref,
    exercise,
    exerciseId,
    patientId,
    saveReference,
  });
  if (result.ok) {
    state.reference = result.reference;
    state.captureDraft = null;
  }
  return result;
}

export async function saveHoldReferenceForCapture({
  state,
  exercise,
  exerciseId,
  variant,
  landmarks,
  jointAngles,
  boundary,
  source = null,
  candidateRepJointsForExercise,
  cleanLandmarks,
  updateCustomExercise,
  saveReference,
  patientId = null,
  boundaryBoxRatio,
}) {
  const captureRegion = state.romBodyRegion || exercise.bodyRegion || 'full';
  const scoringJoints = candidateRepJointsForExercise(exercise, captureRegion)
    .filter((joint) => Number.isFinite(jointAngles?.[joint]));
  const primaryJoint = exercise.dominantJoint || exercise.primaryJoint || scoringJoints[0];
  if (!primaryJoint || !Number.isFinite(jointAngles?.[primaryJoint])) {
    return { ok: false, reason: 'missing_hold_angles' };
  }
  const clean = cleanLandmarks(landmarks);
  const updatedExercise = exercise.source === 'custom'
    ? updateCustomExercise(exerciseId, {
        bodyRegion: captureRegion,
        jointAngles,
        landmarks: clean,
        targetJointAngles: jointAngles,
        targetLandmarks: clean,
        target: Math.round(jointAngles[primaryJoint] ?? exercise.target),
        tol: state.plan?.tol ?? exercise.tol,
        repMode: 'hold',
        primaryJoint,
        dominantJoint: primaryJoint,
        repJoints: scoringJoints,
        primaryJoints: scoringJoints,
        pendingAutoPrimary: false,
      })
    : exercise;
  const ref = buildHoldPoseReference({
    exercise,
    updatedExercise,
    exerciseId,
    variant,
    source,
    captureRegion,
    primaryJoint,
    scoringJoints,
    jointAngles,
    landmarks: clean,
    boundary: { ...boundary, boundaryBoxRatio },
    tol: state.plan?.tol ?? updatedExercise.tol,
  });
  return await persistReferenceForCapture({
    state,
    ref,
    exercise,
    exerciseId,
    patientId,
    saveReference,
  });
}

export function motionReferenceSuccessText({
  patientId = null,
  lang = 'en',
  motion = {},
  referenceSequence = null,
}) {
  const th = lang === 'th';
  const seqText = referenceSequence
    ? (th ? ` · trajectory ${referenceSequence.sampleCount} เฟรม` : ` · ${referenceSequence.sampleCount} trajectory frames`)
    : '';
  const baseText = !patientId
    ? (th ? 'บันทึกในคลังท่าแล้ว' : 'Saved to library')
    : (th ? 'บันทึกแล้ว' : 'Reference saved');
  return th
    ? `${baseText} · ใช้ ${motion.repJoints?.length || 0} rep joints${seqText}`
    : `${baseText} · ${motion.repJoints?.length || 0} rep joints${seqText}`;
}

export async function saveMotionReferenceForCapture({
  state,
  exercise,
  exerciseId,
  variant,
  motion,
  targetAngles,
  targetLandmarks,
  boundary,
  source = null,
  referenceSequence = null,
  bodyRegion = null,
  returnRestAngles = null,
  returnRestLandmarks = null,
  updateCustomExercise,
  saveReference,
  patientId = null,
  boundaryBoxRatio,
  lang = 'en',
}) {
  const tol = state.plan?.tol ?? exercise.tol;
  const captureRegion = bodyRegion || exercise.bodyRegion || 'full';
  if (exercise.type !== 'hold' && !referenceSequence) {
    return { ok: false, reason: 'motion_requires_sequence' };
  }
  const updatedExercise = exercise.source === 'custom'
    ? updateCustomExercise(exerciseId, {
        ...motion,
        bodyRegion: captureRegion,
        jointAngles: targetAngles,
        landmarks: targetLandmarks,
        referenceSequence,
        returnRestJointAngles: returnRestAngles,
        returnRestLandmarks,
        target: motion.targetAngle,
        rest: motion.restAngle,
        tol,
        pendingAutoPrimary: false,
        autoPrimaryJoint: true,
      })
    : exercise;
  const ref = buildMotionCycleReference({
    exercise,
    updatedExercise,
    exerciseId,
    variant,
    motion,
    targetAngles,
    targetLandmarks,
    boundary: { ...boundary, boundaryBoxRatio },
    source,
    referenceSequence,
    bodyRegion: captureRegion,
    returnRestAngles,
    returnRestLandmarks,
    tol,
  });
  const result = await persistReferenceForCapture({
    state,
    ref,
    exercise,
    exerciseId,
    patientId,
    saveReference,
  });
  if (result.ok) {
    result.successText = motionReferenceSuccessText({ patientId, lang, motion, referenceSequence });
  }
  return result;
}

export async function saveSequenceReferenceForCapture({
  state,
  exercise,
  exerciseId,
  variant,
  frames,
  targetOffset = null,
  regionFlag = null,
  referenceExerciseForCapture,
  candidateRepJointsForExercise,
  regionJoints,
  updateCustomExercise,
  saveReference,
  patientId = null,
  boundaryBoxRatio,
  lang = 'en',
}) {
  const captureRegion = regionFlag?.id || state.romBodyRegion || exercise.bodyRegion || 'full';
  const referenceExercise = referenceExerciseForCapture(exercise, captureRegion);
  const built = buildSequenceMotionReference({
    frames,
    exercise: referenceExercise,
    referenceExercise,
    targetOffset,
    captureRegion,
    candidateJoints: candidateRepJointsForExercise(referenceExercise, captureRegion, []),
    regionJoints,
  });
  if (!built.ok) {
    return { ok: false, reason: 'bad_sequence', buildReason: built.reason };
  }
  return await saveMotionReferenceForCapture({
    state,
    exercise,
    exerciseId,
    variant,
    ...built,
    updateCustomExercise,
    saveReference,
    patientId,
    boundaryBoxRatio,
    lang,
  });
}
