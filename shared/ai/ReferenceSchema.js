export const CURRENT_REFERENCE_VERSION = 3;
export const CURRENT_SCORING_VERSION = 3;

export function normalizeReferenceSchema(ref) {
  if (!ref) return null;
  const repJoints = ref.repJoints || ref.scoringJoints || ref.primaryJoints || [];
  const primaryJoints = ref.primaryJoints || repJoints || [];
  const scoringJoints = ref.scoringJoints || repJoints || primaryJoints || [];
  return {
    referenceVersion: Number(ref.referenceVersion) || 1,
    scoringVersion: Number(ref.scoringVersion) || 1,
    kind: ref.kind,
    exerciseId: ref.exerciseId,
    bodyRegion: ref.bodyRegion,
    movementPattern: ref.movementPattern,
    countMode: ref.countMode,
    repJoints,
    primaryJoints,
    scoringJoints,
    jointMotion: ref.jointMotion || {},
    sideMotions: ref.sideMotions || null,
    referenceSequence: ref.referenceSequence || null,
    targetJointAngles: ref.targetJointAngles || ref.holdTargetAngles || ref.jointAngles || null,
    restJointAngles: ref.restJointAngles || null,
    returnRestJointAngles: ref.returnRestJointAngles || null,
    targetLandmarks: ref.targetLandmarks || ref.holdTargetLandmarks || ref.landmarks || null,
    restLandmarks: ref.restLandmarks || null,
    capturedAt: ref.capturedAt || null,
    quality: ref.quality || null,
    raw: ref,
  };
}

export function upgradeReferenceSchema(ref, quality = null) {
  if (!ref) return null;
  return {
    ...ref,
    referenceVersion: CURRENT_REFERENCE_VERSION,
    scoringVersion: CURRENT_SCORING_VERSION,
    quality: quality || ref.quality || null,
  };
}
