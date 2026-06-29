import { BODY_REGIONS, EXERCISES } from './exercises.js';
import { idx } from '../ai/Landmarks.js';
import { jointAngleCalculator } from '../ai/JointAngleCalculator.js';
import { evaluateBoundaryBox } from '../ai/BoundaryBoxGate.js';

export const PATIENT_EXERCISE_COPY = Object.freeze({
  shoulder: { title: 'ยกแขนขึ้น', titleEn: 'Shoulder raise', score: 54 },
  knee: { title: 'เหยียดเข่า', titleEn: 'Knee extension', score: 62 },
  hip: { title: 'กางสะโพก', titleEn: 'Hip abduction', score: 76 },
  squat: { title: 'สควอทช่วยพยุง', titleEn: 'Assisted squat', score: 58 },
  balance: { title: 'ยืนขาเดียว', titleEn: 'Single-leg balance', score: 82 },
});

const regionById = new Map(BODY_REGIONS.map((region) => [region.id, region]));

export function doseText(ex = {}) {
  const reps = Number(ex.reps ?? 10);
  const sets = Number(ex.sets ?? 3);
  const holdSec = Number(ex.holdSec ?? 0);
  return ex.type === 'hold'
    ? `${holdSec}วิ ค้างไว้ · ${sets} เซ็ต`
    : `${reps} ครั้ง · ${sets} เซ็ต`;
}

export function toPatientExercise(ex = {}) {
  const copy = PATIENT_EXERCISE_COPY[ex.id] || {};
  const region = regionById.get(ex.bodyRegion);
  return {
    ...ex,
    title: copy.title || ex.labelTh || ex.label || ex.id,
    titleEn: copy.titleEn || ex.label || ex.id,
    desc: doseText(ex),
    angle: Number(ex.rest ?? 32),
    score: Number(copy.score ?? 58),
    bodyRegionLabel: region?.labelTh || region?.label || ex.bodyRegion || 'ทั้งตัว',
    category: ex.category || 'exercise',
  };
}

export const PATIENT_EXERCISES = EXERCISES.map(toPatientExercise);
export const PATIENT_EXERCISE_BY_ID = new Map(PATIENT_EXERCISES.map((ex) => [ex.id, ex]));

export function normalizePatientExercise(raw = {}, overrides = {}, catalog = PATIENT_EXERCISE_BY_ID) {
  const base = catalog.get(raw?.id || overrides.exerciseId) || {};
  const source = raw?.source === 'custom' ? 'custom' : base.source || raw?.source || 'builtin';
  const title = raw?.labelTh || raw?.title || raw?.label || base.title || raw?.id || overrides.exerciseId || 'Exercise';
  const reps = Number.isFinite(Number(overrides.reps)) ? Number(overrides.reps) : Number(raw?.reps ?? base.reps ?? 10);
  const sets = Number.isFinite(Number(overrides.sets)) ? Number(overrides.sets) : Number(raw?.sets ?? base.sets ?? 3);
  const holdSec = Number.isFinite(Number(overrides.holdSec)) ? Number(overrides.holdSec) : Number(raw?.holdSec ?? base.holdSec ?? 0);
  const bodyRegion = raw?.bodyRegion || base.bodyRegion || 'full';
  const region = regionById.get(bodyRegion);
  return {
    ...base,
    ...raw,
    id: raw?.id || overrides.exerciseId || base.id,
    source,
    title,
    reps,
    sets,
    holdSec,
    target: Number(raw?.target ?? base.target ?? 120),
    angle: Number(base.angle ?? raw?.rest ?? 32),
    score: Number(base.score ?? 48),
    bodyRegion,
    bodyRegionLabel: raw?.bodyRegionLabel || base.bodyRegionLabel || region?.labelTh || region?.label || bodyRegion,
    category: raw?.category || base.category || 'exercise',
    desc: holdSec > 0 && raw?.type === 'hold'
      ? `${holdSec}วิ ค้างไว้ · ${sets} เซ็ต`
      : `${reps} ครั้ง · ${sets} เซ็ต`,
  };
}

function point(x, y, visibility = 0.95) {
  return { x, y, z: 0, visibility };
}

function setPoint(points, name, x, y, visibility = 0.95) {
  const index = idx(name);
  if (index >= 0) points[index] = point(x, y, visibility);
}

export function syntheticPoseForExercise(ex = {}) {
  const points = Array.from({ length: 33 }, () => point(0.5, 0.5, 0.92));
  setPoint(points, 'nose', 0.5, 0.18);
  setPoint(points, 'left_ear', 0.45, 0.2);
  setPoint(points, 'right_ear', 0.55, 0.2);
  setPoint(points, 'left_shoulder', 0.38, 0.36);
  setPoint(points, 'right_shoulder', 0.62, 0.36);
  setPoint(points, 'left_elbow', 0.29, 0.5);
  setPoint(points, 'right_elbow', 0.71, 0.5);
  setPoint(points, 'left_wrist', 0.25, 0.64);
  setPoint(points, 'right_wrist', 0.75, 0.64);
  setPoint(points, 'left_hip', 0.43, 0.62);
  setPoint(points, 'right_hip', 0.57, 0.62);
  setPoint(points, 'left_knee', 0.42, 0.78);
  setPoint(points, 'right_knee', 0.58, 0.78);
  setPoint(points, 'left_ankle', 0.4, 0.93);
  setPoint(points, 'right_ankle', 0.6, 0.93);
  setPoint(points, 'left_foot_index', 0.36, 0.95);
  setPoint(points, 'right_foot_index', 0.64, 0.95);

  const joint = ex.primaryJoint || 'right_shoulder';
  if (joint === 'left_shoulder') {
    setPoint(points, 'left_elbow', 0.25, 0.3);
    setPoint(points, 'left_wrist', 0.2, 0.2);
  } else if (joint === 'right_shoulder') {
    setPoint(points, 'right_elbow', 0.75, 0.3);
    setPoint(points, 'right_wrist', 0.8, 0.2);
  } else if (joint === 'left_elbow') {
    setPoint(points, 'left_elbow', 0.28, 0.42);
    setPoint(points, 'left_wrist', 0.22, 0.32);
  } else if (joint === 'right_elbow') {
    setPoint(points, 'right_elbow', 0.72, 0.42);
    setPoint(points, 'right_wrist', 0.78, 0.32);
  } else if (joint === 'left_hip') {
    setPoint(points, 'left_knee', 0.3, 0.72);
    setPoint(points, 'left_ankle', 0.25, 0.88);
  } else if (joint === 'right_hip') {
    setPoint(points, 'right_knee', 0.7, 0.72);
    setPoint(points, 'right_ankle', 0.75, 0.88);
  } else if (joint === 'left_knee') {
    setPoint(points, 'left_knee', 0.38, 0.76);
    setPoint(points, 'left_ankle', 0.28, 0.86);
  } else if (joint === 'right_knee') {
    setPoint(points, 'right_knee', 0.62, 0.76);
    setPoint(points, 'right_ankle', 0.72, 0.86);
  } else if (joint === 'back') {
    setPoint(points, 'left_shoulder', 0.34, 0.34);
    setPoint(points, 'right_shoulder', 0.58, 0.34);
    setPoint(points, 'left_hip', 0.45, 0.62);
    setPoint(points, 'right_hip', 0.59, 0.62);
  } else if (joint === 'neck') {
    setPoint(points, 'nose', 0.48, 0.14);
    setPoint(points, 'left_ear', 0.43, 0.19);
    setPoint(points, 'right_ear', 0.53, 0.18);
  }
  return points;
}

export function overlayJointsForExercise(ex = {}) {
  if (Array.isArray(ex.repJoints) && ex.repJoints.length) return ex.repJoints.slice(0, 2);
  if (Array.isArray(ex.reference?.repJoints) && ex.reference.repJoints.length) return ex.reference.repJoints.slice(0, 2);
  if (Array.isArray(ex.reference?.scoringJoints) && ex.reference.scoringJoints.length) return ex.reference.scoringJoints.slice(0, 2);
  return [ex.dominantJoint || ex.primaryJoint || 'right_shoulder'];
}

export function referenceForExercise(ex = {}, references = {}) {
  return ex?.reference || references?.[ex?.id] || null;
}

export function practiceDose(ex = {}) {
  return {
    reps: Number(ex?.reps) || 1,
    sets: Number(ex?.sets) || 1,
    holdSec: Number(ex?.holdSec) || 10,
  };
}

export function practicePreviewData(ex = {}, references = {}) {
  const reference = referenceForExercise(ex, references);
  const landmarks = reference?.holdTargetLandmarks || reference?.targetLandmarks || reference?.landmarks || syntheticPoseForExercise(ex);
  const angles = reference?.holdTargetAngles || reference?.targetJointAngles || reference?.jointAngles || jointAngleCalculator(landmarks);
  const boundary = evaluateBoundaryBox(landmarks, null, ex);
  return { landmarks, angles, boundary, joints: overlayJointsForExercise(ex) };
}

export function practiceAngle(ex = {}, references = {}) {
  const data = practicePreviewData(ex, references);
  const joint = data.joints[0];
  return Math.round(data.angles[joint] ?? ex.angle ?? ex.rest ?? 0);
}
