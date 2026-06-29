import { BODY_REGIONS } from '../../../../shared/core/exercises.js';
import { JOINT_SPECS } from '../../../../shared/ai/JointAngleCalculator.js';

export const ANGLE_PICKER_JOINTS = [
  'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'back', 'neck',
];

export const ROM_BODY_REGION_IDS = ['full', 'upper', 'lower', 'shoulder', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];

export const ROM_REGION_JOINTS = {
  full: ANGLE_PICKER_JOINTS,
  upper: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'back', 'neck'],
  lower: ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  shoulder: ['left_shoulder', 'right_shoulder'],
  left_arm: ['left_shoulder', 'left_elbow'],
  right_arm: ['right_shoulder', 'right_elbow'],
  left_leg: ['left_hip', 'left_knee'],
  right_leg: ['right_hip', 'right_knee'],
};

export const ROM_REGION_PRIMARY = {
  full: null,
  upper: 'right_shoulder',
  lower: 'right_knee',
  shoulder: 'right_shoulder',
  left_arm: 'left_shoulder',
  right_arm: 'right_shoulder',
  left_leg: 'left_knee',
  right_leg: 'right_knee',
};

export function isKnownJoint(joint) {
  return JOINT_SPECS.some((spec) => spec.joint === joint);
}

export function defaultOverlayJoint(reference, exercise = {}) {
  return reference?.dominantJoint || reference?.primaryJoint || exercise.dominantJoint || exercise.primaryJoint;
}

export function activeOverlayJoints({ selectedJoints = [], reference = null, exercise = {} } = {}) {
  const selected = selectedJoints.filter(isKnownJoint);
  if (selected.length) return [...new Set(selected)];
  return [defaultOverlayJoint(reference, exercise)].filter(Boolean);
}

export function bodyRegionFlag(regionId, source = 'motion_setup') {
  const region = BODY_REGIONS.find((item) => item.id === regionId);
  if (!region) return null;
  const joints = (ROM_REGION_JOINTS[region.id] || []).filter(isKnownJoint);
  return {
    required: true,
    selected: true,
    id: region.id,
    label: region.label,
    labelTh: region.labelTh,
    source,
    primaryJoint: ROM_REGION_PRIMARY[region.id] || null,
    joints,
    usedForBoundary: true,
    usedForRepScoring: true,
  };
}

export function candidateRepJointsForExercise(exercise = {}, { bodyRegion = null, overlayJoints = [], romBodyRegion = null } = {}) {
  const selected = (overlayJoints || []).filter(isKnownJoint);
  const explicitRegion = bodyRegion || romBodyRegion;
  const region = explicitRegion || exercise.bodyRegion || 'full';
  const regional = (ROM_REGION_JOINTS[region] || []).filter(isKnownJoint);
  if (explicitRegion && regional.length) return [...new Set(regional)];
  const fallback = exercise.repJoints || exercise.primaryJoints || [exercise.dominantJoint || exercise.primaryJoint].filter(Boolean);
  return [...new Set((selected.length ? selected : (regional.length ? regional : fallback)).filter(Boolean))];
}

export function referenceExerciseForCapture(exercise = {}, { bodyRegion = null, romBodyRegion = null, overlayJoints = [] } = {}) {
  const captureRegion = bodyRegion || romBodyRegion || exercise.bodyRegion || 'full';
  const base = { ...exercise, bodyRegion: captureRegion };
  return {
    ...base,
    preferredRepJoints: candidateRepJointsForExercise(base, {
      bodyRegion: captureRegion,
      overlayJoints,
      romBodyRegion,
    }),
  };
}

export function cleanLandmarks(landmarks = []) {
  return landmarks.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  }));
}

export function cleanAngles(jointAngles = {}) {
  const out = {};
  for (const spec of JOINT_SPECS) {
    const value = jointAngles?.[spec.joint];
    if (Number.isFinite(value)) out[spec.joint] = Math.round(value * 10) / 10;
  }
  return out;
}

export function toleranceOverride(exercise = {}, reference = null, plan = null) {
  const joints = reference?.repJoints || exercise.repJoints || [reference?.dominantJoint || reference?.primaryJoint || exercise.primaryJoint].filter(Boolean);
  const out = {};
  for (const joint of joints) out[joint] = reference?.jointMotion?.[joint]?.tol ?? plan?.tol ?? exercise.tol;
  return out;
}
