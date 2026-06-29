// PhysioAI · Multi-joint motion model for Therapist web capture.

const CANDIDATE_JOINTS = {
  upper: ['neck', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow'],
  lower: ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
  shoulder: ['neck', 'left_shoulder', 'right_shoulder'],
  left_arm: ['left_shoulder', 'left_elbow'],
  right_arm: ['right_shoulder', 'right_elbow'],
  left_leg: ['left_hip', 'left_knee', 'left_ankle'],
  right_leg: ['right_hip', 'right_knee', 'right_ankle'],
  full: [
    'back', 'neck',
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
    'left_ankle', 'right_ankle',
  ],
};

const BODY_REGION_ALIASES = {
  whole: 'full',
  whole_body: 'full',
  full_body: 'full',
};

const MIN_RANGE_DEG = 15;
const MIN_WEIGHT_RANGE_DEG = 15;
const KEEP_RATIO = 0.45;
const MAX_REP_JOINTS = 4;
const SIDES = ['left', 'right'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function effectiveRange(motion) {
  return Math.max(
    Number.isFinite(motion?.range) ? motion.range : 0,
    Number.isFinite(motion?.trajectoryRange) ? motion.trajectoryRange : 0,
    Number.isFinite(motion?.target) && Number.isFinite(motion?.rest) ? Math.abs(motion.target - motion.rest) : 0,
  );
}

function roleForRange(range, isDominant = false) {
  if (range >= MIN_RANGE_DEG) return isDominant ? 'primary_motion' : 'coordinated_motion';
  return 'reference_pattern';
}

export function candidateJoints(bodyRegion = 'full') {
  const region = BODY_REGION_ALIASES[bodyRegion] || bodyRegion;
  return CANDIDATE_JOINTS[region] || CANDIDATE_JOINTS.full;
}

function sideOf(joint) {
  if (joint?.startsWith('left_')) return 'left';
  if (joint?.startsWith('right_')) return 'right';
  return null;
}

function jointKind(joint) {
  return joint?.replace(/^(left|right)_/, '') || '';
}

function inferMovementPattern(repJoints, explicit) {
  if (explicit) return explicit;
  const pairs = new Set();
  for (const joint of repJoints || []) {
    const side = sideOf(joint);
    if (!side) continue;
    const other = `${side === 'left' ? 'right' : 'left'}_${jointKind(joint)}`;
    if (repJoints.includes(other)) pairs.add(jointKind(joint));
  }
  return pairs.size ? 'bilateralSync' : 'unilateral';
}

export function selectRepJoints(restAngles, targetAngles, bodyRegion = 'full', side = null, preferredJoints = null) {
  const hasPreferred = Array.isArray(preferredJoints) && preferredJoints.length;
  const jointPool = [...new Set((Array.isArray(preferredJoints) && preferredJoints.length ? preferredJoints : candidateJoints(bodyRegion))
    .filter(Boolean))];
  const motions = jointPool
    .filter((joint) => !side || sideOf(joint) === side)
    .map((joint) => {
      const rest = restAngles?.[joint];
      const target = targetAngles?.[joint];
      const range = Math.abs((target ?? NaN) - (rest ?? NaN));
      return { joint, rest, target, range };
    })
    .filter((m) => Number.isFinite(m.rest) && Number.isFinite(m.target) && (hasPreferred || m.range >= MIN_RANGE_DEG))
    .sort((a, b) => b.range - a.range);

  const maxRange = motions[0]?.range || 0;
  const selected = hasPreferred
    ? jointPool
      .map((joint) => motions.find((m) => m.joint === joint))
      .filter(Boolean)
      .slice(0, MAX_REP_JOINTS)
    : motions
      .filter((m) => m.range >= Math.max(MIN_RANGE_DEG, maxRange * KEEP_RATIO))
      .slice(0, MAX_REP_JOINTS);

  return { repJoints: selected.map((m) => m.joint), motions, dominantJoint: selected[0]?.joint || null, jointPool };
}

function buildJointMotion(repJoints, restAngles, targetAngles) {
  const totalRange = repJoints.reduce((sum, joint) => {
    return sum + Math.max(MIN_WEIGHT_RANGE_DEG, Math.abs(targetAngles[joint] - restAngles[joint]));
  }, 0) || 1;
  const jointMotion = {};
  for (const joint of repJoints) {
    const rest = restAngles[joint];
    const target = targetAngles[joint];
    const range = Math.abs(target - rest);
    jointMotion[joint] = {
      rest,
      target,
      range,
      endpointRange: range,
      dir: target >= rest ? 'up' : 'down',
      tol: joint.includes('elbow') || joint === 'back' || joint === 'neck' ? 12 : 15,
      weight: Math.max(MIN_WEIGHT_RANGE_DEG, range) / totalRange,
      role: 'reference_pattern',
      contributesToProgress: false,
      usedForScoring: true,
      usedForTrajectory: true,
    };
  }
  return jointMotion;
}

function trajectoryStatsForJoint(frames, joint, rest) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const frame of frames || []) {
    const value = frame?.jointAngles?.[joint];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    count++;
  }
  if (!count || !Number.isFinite(rest)) return null;
  const up = Math.abs(max - rest);
  const down = Math.abs(min - rest);
  const target = up >= down ? max : min;
  return {
    min,
    max,
    target,
    range: Math.max(up, down),
  };
}

function refreshJointWeights(repJoints, jointMotion) {
  const totalRange = repJoints.reduce((sum, joint) => {
    return sum + Math.max(MIN_WEIGHT_RANGE_DEG, jointMotion?.[joint]?.range || 0);
  }, 0) || 1;
  for (const joint of repJoints) {
    if (!jointMotion?.[joint]) continue;
    jointMotion[joint].weight = Math.max(MIN_WEIGHT_RANGE_DEG, jointMotion[joint].range || 0) / totalRange;
  }
}

function assignJointRoles(motion) {
  const repJoints = motion?.repJoints || [];
  const jointMotion = motion?.jointMotion || {};
  if (!repJoints.length) return;
  const dominantJoint = motion.dominantJoint || repJoints
    .slice()
    .sort((a, b) => effectiveRange(jointMotion[b]) - effectiveRange(jointMotion[a]))[0];
  const jointRoles = {};
  for (const joint of repJoints) {
    const jm = jointMotion[joint];
    if (!jm) continue;
    const range = effectiveRange(jm);
    const role = roleForRange(range, joint === dominantJoint);
    jm.role = role;
    jm.contributesToProgress = role !== 'reference_pattern';
    jm.usedForScoring = true;
    jm.usedForTrajectory = true;
    jointRoles[joint] = {
      role,
      range: Math.round(range * 10) / 10,
      weight: jm.weight,
      contributesToProgress: jm.contributesToProgress,
      usedForScoring: true,
      usedForTrajectory: true,
    };
  }
  motion.dominantJoint = dominantJoint;
  motion.primaryJoint = dominantJoint;
  motion.jointRoles = jointRoles;
}

function applyTrajectoryRanges(motion, frames) {
  const repJoints = motion?.repJoints || [];
  const jointMotion = motion?.jointMotion || {};
  if (!repJoints.length || !Array.isArray(frames) || frames.length < 2) return;
  let changed = false;
  for (const joint of repJoints) {
    const jm = jointMotion[joint];
    if (!jm) continue;
    const stats = trajectoryStatsForJoint(frames, joint, jm.rest);
    if (!stats) continue;
    jm.trajectoryRange = Math.round(stats.range * 10) / 10;
    jm.trajectoryMin = Math.round(stats.min * 10) / 10;
    jm.trajectoryMax = Math.round(stats.max * 10) / 10;
    if (stats.range > (jm.range || 0)) {
      jm.target = stats.target;
      jm.range = stats.range;
      jm.dir = stats.target >= jm.rest ? 'up' : 'down';
      changed = true;
    }
    jm.range = Math.max(jm.range || 0, jm.trajectoryRange || 0);
  }
  if (changed) {
    refreshJointWeights(repJoints, jointMotion);
    const dominantJoint = repJoints
      .slice()
      .sort((a, b) => (jointMotion[b]?.range || 0) - (jointMotion[a]?.range || 0))[0];
    if (dominantJoint) {
      motion.dominantJoint = dominantJoint;
      motion.primaryJoint = dominantJoint;
      motion.restAngle = Math.round(jointMotion[dominantJoint].rest);
      motion.targetAngle = Math.round(jointMotion[dominantJoint].target);
      motion.dir = jointMotion[dominantJoint].dir;
    }
  }
  assignJointRoles(motion);
}

function normalizeWeights(repJoints, jointMotion) {
  const values = repJoints.map((joint) => jointMotion?.[joint]?.weight ?? jointMotion?.[joint]?.range ?? 1);
  const sum = values.reduce((acc, value) => acc + (Number.isFinite(value) ? Math.max(0, value) : 0), 0) || 1;
  return values.map((value) => (Number.isFinite(value) ? Math.max(0, value) / sum : 0));
}

function progressForJoint(angle, motion) {
  const denom = motion.target - motion.rest;
  if (!Number.isFinite(angle) || Math.abs(denom) < 1e-6) return null;
  return (angle - motion.rest) / denom;
}

function frameProgress(jointAngles, repJoints, jointMotion, weights) {
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < repJoints.length; i++) {
    const joint = repJoints[i];
    if (jointMotion?.[joint]?.contributesToProgress === false) continue;
    const progress = progressForJoint(jointAngles?.[joint], jointMotion?.[joint]);
    if (progress == null) continue;
    const weight = weights[i] ?? 1 / repJoints.length;
    sum += clamp(progress, 0, 1) * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? sum / weightSum : null;
}

function compactFrames(frames, maxSamples) {
  if (frames.length <= maxSamples) return frames;
  const out = [];
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.round((i / (maxSamples - 1)) * (frames.length - 1));
    out.push(frames[idx]);
  }
  return out;
}

export function buildReferenceTrajectory({ frames, motion, maxSamples = null, targetFrameIndex = null, targetFrameT = null }) {
  const repJoints = motion?.repJoints || [];
  const jointMotion = motion?.jointMotion || {};
  if (!Array.isArray(frames) || frames.length < 2 || !repJoints.length) return null;

  applyTrajectoryRanges(motion, frames);
  const weights = normalizeWeights(repJoints, jointMotion);
  const firstT = Number(frames[0]?.t) || 0;
  const lastT = Number(frames[frames.length - 1]?.t) || firstT;
  const durationMs = Math.max(1, lastT - firstT);
  const rawTargetT = Number.isFinite(targetFrameT)
    ? Number(targetFrameT)
    : (Number.isInteger(targetFrameIndex) ? Number(frames[targetFrameIndex]?.t) : NaN);
  const targetAtMs = Number.isFinite(rawTargetT)
    ? Math.max(0, Math.round(rawTargetT - firstT))
    : null;
  const sourceFrames = Number.isFinite(maxSamples) && maxSamples > 1
    ? compactFrames(frames, maxSamples)
    : frames;
  const sampled = sourceFrames
    .map((frame) => {
      const angles = {};
      for (const joint of repJoints) {
        const value = frame?.jointAngles?.[joint];
        if (Number.isFinite(value)) angles[joint] = Math.round(value * 10) / 10;
      }
      const p = frameProgress(frame?.jointAngles, repJoints, jointMotion, weights);
      return {
        t: Math.max(0, Math.round((Number(frame?.t) || firstT) - firstT)),
        p: p == null ? null : Math.round(clamp(p, 0, 1) * 1000) / 1000,
        angles,
      };
    })
    .filter((frame) => Object.keys(frame.angles).length);

  if (sampled.length < 2) return null;
  sampled[0].p = 0;
  let targetSampleIndex = null;
  if (targetAtMs != null) {
    let bestDistance = Infinity;
    for (let i = 0; i < sampled.length; i++) {
      const distance = Math.abs(sampled[i].t - targetAtMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        targetSampleIndex = i;
      }
    }
    if (targetSampleIndex != null) sampled[targetSampleIndex].p = 1;
  } else {
    sampled[sampled.length - 1].p = 1;
  }
  return {
    version: targetAtMs != null ? 2 : 1,
    kind: 'angle-trajectory',
    cycle: targetAtMs != null ? 'rest-target-rest' : 'rest-target',
    durationMs,
    sampleCount: sampled.length,
    targetAtMs,
    targetSampleIndex,
    phases: targetAtMs != null
      ? { restStartMs: 0, targetMs: targetAtMs, restEndMs: durationMs }
      : null,
    repJoints,
    dominantJoint: motion.dominantJoint,
    movementPattern: motion.movementPattern,
    frames: sampled,
  };
}

function alternatingMovementMagnitude(restAngles, angles, joints) {
  const values = joints
    .map((joint) => {
      const rest = restAngles?.[joint];
      const live = angles?.[joint];
      return Number.isFinite(rest) && Number.isFinite(live) ? Math.abs(live - rest) : null;
    })
    .filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function inferAlternatingMiddleRestIndex(frames, leftTargetIdx, rightTargetIdx, restAngles, joints) {
  const start = Math.max(leftTargetIdx + 1, 1);
  const end = Math.max(start, Math.min(rightTargetIdx - 1, frames.length - 2));
  let bestIdx = Math.round((leftTargetIdx + rightTargetIdx) / 2);
  let bestMagnitude = Infinity;
  for (let i = start; i <= end; i++) {
    const magnitude = alternatingMovementMagnitude(restAngles, frames[i]?.jointAngles, joints);
    if (magnitude < bestMagnitude) {
      bestMagnitude = magnitude;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function alternatingMotionProgress(angles, jointMotion = {}, joints = []) {
  let sum = 0;
  let weightSum = 0;
  for (const joint of joints) {
    const motion = jointMotion[joint];
    const rest = Number(motion?.rest);
    const target = Number(motion?.target);
    const live = Number(angles?.[joint]);
    const denom = target - rest;
    if (!Number.isFinite(live) || !Number.isFinite(rest) || Math.abs(denom) < 1e-6) continue;
    const progress = Math.max(0, Math.min(1, (live - rest) / denom));
    const weight = Math.max(0, Number(motion.weight) || Number(motion.range) || 1);
    sum += progress * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? sum / weightSum : 0;
}

export function buildAlternatingReferenceTrajectory({ frames, motion, leftTargetIdx, rightTargetIdx, minFrames = 8 }) {
  const repJoints = motion?.repJoints || [];
  if (!Array.isArray(frames) || frames.length < minFrames || !repJoints.length) return null;
  const firstT = Number(frames[0]?.t) || 0;
  const lastT = Number(frames[frames.length - 1]?.t) || firstT;
  const durationMs = Math.max(1, lastT - firstT);
  const middleRestIdx = inferAlternatingMiddleRestIndex(frames, leftTargetIdx, rightTargetIdx, frames[0]?.jointAngles, repJoints);
  const markerMs = (idx) => Math.max(0, Math.round((Number(frames[idx]?.t) || firstT) - firstT));
  const sampled = frames
    .map((frame, index) => {
      const angles = {};
      for (const joint of repJoints) {
        const value = frame?.jointAngles?.[joint];
        if (Number.isFinite(value)) angles[joint] = Math.round(value * 10) / 10;
      }
      if (!Object.keys(angles).length) return null;
      const leftProgress = alternatingMotionProgress(angles, motion.sideMotions?.left?.jointMotion, motion.sideMotions?.left?.repJoints);
      const rightProgress = alternatingMotionProgress(angles, motion.sideMotions?.right?.jointMotion, motion.sideMotions?.right?.repJoints);
      let phase = 'rest';
      if (index > 0 && index < leftTargetIdx) phase = 'left_outbound';
      else if (index === leftTargetIdx) phase = 'left_target';
      else if (index > leftTargetIdx && index < middleRestIdx) phase = 'left_return';
      else if (index === middleRestIdx) phase = 'middle_rest';
      else if (index > middleRestIdx && index < rightTargetIdx) phase = 'right_outbound';
      else if (index === rightTargetIdx) phase = 'right_target';
      else if (index > rightTargetIdx && index < frames.length - 1) phase = 'right_return';
      const p = index === 0 || index === middleRestIdx || index === frames.length - 1
        ? 0
        : Math.max(leftProgress, rightProgress);
      return {
        t: Math.max(0, Math.round((Number(frame?.t) || firstT) - firstT)),
        p: Math.round(Math.max(0, Math.min(1, p)) * 1000) / 1000,
        side: leftProgress >= rightProgress ? 'left' : 'right',
        phase,
        angles,
        sideProgress: {
          left: Math.round(leftProgress * 1000) / 1000,
          right: Math.round(rightProgress * 1000) / 1000,
        },
      };
    })
    .filter(Boolean);
  if (sampled.length < minFrames) return null;
  sampled[0].p = 0;
  sampled[sampled.length - 1].p = 0;
  return {
    version: 3,
    kind: 'angle-trajectory',
    cycle: 'rest-left-rest-right-rest',
    durationMs,
    sampleCount: sampled.length,
    targetAtMs: null,
    phases: {
      restStartMs: 0,
      leftTargetMs: markerMs(leftTargetIdx),
      middleRestMs: markerMs(middleRestIdx),
      rightTargetMs: markerMs(rightTargetIdx),
      restEndMs: durationMs,
    },
    repJoints,
    dominantJoint: motion.dominantJoint,
    movementPattern: 'alternating',
    frames: sampled,
  };
}

export function buildReferenceMotion({ exercise, restAngles, targetAngles, restLandmarks, targetLandmarks }) {
  const bodyRegion = exercise?.bodyRegion || 'full';
  const requestedRepJoints = Array.isArray(exercise?.preferredRepJoints) && exercise.preferredRepJoints.length
    ? [...new Set(exercise.preferredRepJoints.filter(Boolean))]
    : null;
  const selected = selectRepJoints(restAngles, targetAngles, bodyRegion, null, requestedRepJoints);
  const dominantSide = sideOf(selected.dominantJoint);
  const repJoints = exercise?.movementPattern === 'unilateral' && dominantSide
    ? selected.repJoints.filter((joint) => sideOf(joint) === dominantSide)
    : selected.repJoints;
  const dominantJoint = repJoints[0] || selected.dominantJoint;
  if (!repJoints.length || !dominantJoint) {
    const err = new Error('insufficient-motion');
    err.code = 'insufficient-motion';
    throw err;
  }

  const jointMotion = buildJointMotion(repJoints, restAngles, targetAngles);
  const movementPattern = inferMovementPattern(repJoints, exercise?.movementPattern);
  const motion = {
    movementPattern,
    repMode: repJoints.length > 1 ? 'multi' : 'single',
    repJoints,
    primaryJoints: repJoints,
    requestedRepJoints,
    dominantJoint,
    primaryJoint: dominantJoint,
    jointMotion,
    restJointAngles: restAngles,
    targetJointAngles: targetAngles,
    restLandmarks,
    targetLandmarks,
    restAngle: Math.round(restAngles[dominantJoint]),
    targetAngle: Math.round(targetAngles[dominantJoint]),
    dir: targetAngles[dominantJoint] >= restAngles[dominantJoint] ? 'up' : 'down',
  };
  assignJointRoles(motion);
  return motion;
}

export function buildAlternatingReferenceMotion({ exercise, restAngles, leftTargetAngles, rightTargetAngles, restLandmarks, leftTargetLandmarks, rightTargetLandmarks }) {
  const bodyRegion = exercise?.bodyRegion || 'full';
  const alternatingSides = exercise?.alternatingSides || SIDES;
  const requestedRepJoints = Array.isArray(exercise?.preferredRepJoints) && exercise.preferredRepJoints.length
    ? [...new Set(exercise.preferredRepJoints.filter(Boolean))]
    : null;
  const targetBySide = { left: leftTargetAngles, right: rightTargetAngles };
  const targetLandmarksBySide = { left: leftTargetLandmarks, right: rightTargetLandmarks };
  const sideMotions = {};
  const jointMotion = {};
  const repJoints = [];
  const primaryJoints = [];

  for (const side of alternatingSides) {
    const targetAngles = targetBySide[side];
    const { repJoints: sideJoints, dominantJoint } = selectRepJoints(restAngles, targetAngles, bodyRegion, side, requestedRepJoints);
    if (!sideJoints.length || !dominantJoint) {
      const err = new Error(`insufficient-motion-${side}`);
      err.code = 'insufficient-motion';
      err.side = side;
      throw err;
    }
    const sideJointMotion = buildJointMotion(sideJoints, restAngles, targetAngles);
    const sideMotion = {
      repJoints: sideJoints,
      primaryJoints: sideJoints,
      dominantJoint,
      jointMotion: sideJointMotion,
      targetJointAngles: targetAngles,
      targetLandmarks: targetLandmarksBySide[side],
    };
    assignJointRoles(sideMotion);
    sideMotions[side] = sideMotion;
    for (const joint of sideJoints) {
      if (!repJoints.includes(joint)) repJoints.push(joint);
      if (!primaryJoints.includes(joint)) primaryJoints.push(joint);
      jointMotion[joint] = sideJointMotion[joint];
    }
  }

  const firstSide = alternatingSides[0];
  const dominantJoint = sideMotions[firstSide].dominantJoint;
  const firstTargetAngles = targetBySide[firstSide];
  const motion = {
    movementPattern: 'alternating',
    alternatingSides,
    countMode: exercise?.countMode || 'per_side',
    repMode: 'alternating',
    repJoints,
    primaryJoints,
    requestedRepJoints,
    dominantJoint,
    primaryJoint: dominantJoint,
    jointMotion,
    sideMotions,
    restJointAngles: restAngles,
    targetJointAngles: firstTargetAngles,
    targetJointAnglesBySide: targetBySide,
    restLandmarks,
    targetLandmarks: targetLandmarksBySide[firstSide],
    targetLandmarksBySide,
    restAngle: Math.round(restAngles[dominantJoint]),
    targetAngle: Math.round(firstTargetAngles[dominantJoint]),
    dir: firstTargetAngles[dominantJoint] >= restAngles[dominantJoint] ? 'up' : 'down',
  };
  assignJointRoles(motion);
  return motion;
}
