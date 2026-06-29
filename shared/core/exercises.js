// PhysioAI · Version-1 — seed exercise library.
// Each seed exercise has a primary joint fallback; captured references may track multiple rep joints.
// `target` = peak joint-angle to reach; `rest` = relaxed joint-angle.
// `dir`: 'up' (angle increases to peak) | 'down' (decreases to peak) | 'hold' (static).
// These are sensible defaults; a therapist Capture overrides them with a measured reference.

import {
  defaultLandmarkSchemaIdForBodyRegion,
  landmarkSchemaMetadataForExercise,
} from '../ai/BodyRegionLandmarkSchema.js';

const DEFAULT_EXERCISE_METADATA = Object.freeze({
  templateOnly: true,
  landmarkSchemaId: null,
  activeModelId: null,
  modelStatus: 'not_trained',
  cameraOrientation: 'front',
  cameraSide: 'any',
  recommendedCameraDistanceM: [1.5, 3.0],
  recommendedCameraHeight: 'chest',
  minVisibility: 0.6,
  minUsableJointRatio: 0.8,
  minROMDeg: 15,
  minRepMs: 600,
  maxRepMs: 12000,
  feedbackProfile: 'simple_patient',
  allow3D: false,
  allowMirror: true,
  allowSeated: true,
  contraindicationNote: '',
});

const EXERCISE_METADATA = {
  shoulder: {
    requiredJoints: ['right_shoulder', 'right_elbow', 'right_hip'],
    optionalJoints: ['right_wrist', 'left_shoulder'],
    movementPlane: 'frontal',
    movementPattern: 'unilateral',
    scoringProfile: 'upper_limb_rom',
    setupInstructionTh: 'ยืนหันหน้าเข้ากล้อง ให้เห็นไหล่ ศอก และสะโพกขวาชัดเจน',
    setupInstructionEn: 'Face the camera and keep the right shoulder, elbow, and hip visible.',
  },
  knee: {
    requiredJoints: ['right_hip', 'right_knee', 'right_ankle'],
    optionalJoints: ['right_foot_index', 'left_hip'],
    movementPlane: 'sagittal',
    movementPattern: 'unilateral',
    scoringProfile: 'lower_limb_rom',
    setupInstructionTh: 'นั่งหรือยืนให้กล้องเห็นสะโพก เข่า และข้อเท้าขวา',
    setupInstructionEn: 'Keep the right hip, knee, and ankle visible to the camera.',
  },
  hip: {
    requiredJoints: ['right_shoulder', 'right_hip', 'right_knee', 'right_ankle'],
    optionalJoints: ['left_hip'],
    movementPlane: 'frontal',
    movementPattern: 'unilateral',
    scoringProfile: 'lower_limb_rom',
    setupInstructionTh: 'ยืนหันหน้าเข้ากล้อง ให้เห็นลำตัว สะโพก เข่า และข้อเท้าขวา',
    setupInstructionEn: 'Face the camera and keep the trunk, right hip, knee, and ankle visible.',
  },
  squat: {
    requiredJoints: ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
    optionalJoints: ['left_shoulder', 'right_shoulder'],
    movementPlane: 'sagittal',
    movementPattern: 'bilateralSync',
    scoringProfile: 'bilateral_lower_limb',
    recommendedCameraDistanceM: [2.0, 3.5],
    setupInstructionTh: 'ถอยให้เห็นสะโพก เข่า และข้อเท้าทั้งสองข้างเต็มตัว',
    setupInstructionEn: 'Step back so both hips, knees, and ankles are fully visible.',
  },
  balance: {
    requiredJoints: ['right_hip', 'right_knee', 'right_ankle'],
    optionalJoints: ['left_hip', 'left_knee', 'left_ankle'],
    movementPlane: 'frontal',
    movementPattern: 'hold',
    scoringProfile: 'static_hold',
    minROMDeg: 0,
    minRepMs: 1000,
    maxRepMs: 60000,
    setupInstructionTh: 'ยืนให้นิ่งในกรอบกล้องและให้เห็นสะโพก เข่า ข้อเท้าขวา',
    setupInstructionEn: 'Stand still in frame with the right hip, knee, and ankle visible.',
  },
};

function withProductionMetadata(ex) {
  const metadata = EXERCISE_METADATA[ex.id] || {};
  const merged = { ...DEFAULT_EXERCISE_METADATA, ...ex, ...metadata };
  return { ...merged, ...landmarkSchemaMetadataForExercise(merged) };
}

export const EXERCISES = [
  {
    id: 'shoulder', key: 'shoulder', icon: 'body', accent: '#7BA88F',
    primaryJoint: 'right_shoulder', bodyRegion: 'right_arm', dir: 'up',
    target: 158, rest: 22, tol: 15,
    reps: 12, sets: 3, holdSec: 1.5, type: 'rep',
  },
  {
    id: 'knee', key: 'knee', icon: 'body', accent: '#7BA88F',
    primaryJoint: 'right_knee', bodyRegion: 'right_leg', dir: 'up',
    target: 172, rest: 92, tol: 15,
    reps: 15, sets: 2, holdSec: 1.0, type: 'rep',
  },
  {
    id: 'hip', key: 'hip', icon: 'body', accent: '#7BA88F',
    primaryJoint: 'right_hip', bodyRegion: 'right_leg', dir: 'down',
    target: 148, rest: 176, tol: 15,
    reps: 12, sets: 2, holdSec: 1.0, type: 'rep',
  },
  {
    id: 'squat', key: 'squat', icon: 'body', accent: '#7BA88F',
    primaryJoint: 'right_knee', bodyRegion: 'full', dir: 'down',
    target: 96, rest: 170, tol: 15,
    reps: 10, sets: 3, holdSec: 1.0, type: 'rep',
  },
  {
    id: 'balance', key: 'balance', icon: 'body', accent: '#7BA88F',
    primaryJoint: 'right_knee', bodyRegion: 'right_leg', dir: 'hold',
    target: 70, rest: 70, tol: 18,
    reps: 1, sets: 2, holdSec: 20, type: 'hold',
  },
].map(withProductionMetadata);

// The seed library = built-in popular exercises (used for demo + patient-selectable
// "extras"). Therapist-captured custom exercises will carry source:'custom' and are
// plan-only (never shown to patients as free extras).
for (const e of EXERCISES) e.source = e.source || 'builtin';
export const isBuiltin = (ex) => (ex?.source ?? 'builtin') === 'builtin';

export const BODY_REGIONS = [
  { id: 'full', label: 'Whole Body', labelTh: 'ทั้งตัว' },
  { id: 'upper', label: 'Upper Body', labelTh: 'ส่วนบน' },
  { id: 'lower', label: 'Lower Body', labelTh: 'ส่วนล่าง' },
  { id: 'shoulder', label: 'Shoulder', labelTh: 'ไหล่' },
  { id: 'left_arm', label: 'Left Arm', labelTh: 'แขนซ้าย' },
  { id: 'right_arm', label: 'Right Arm', labelTh: 'แขนขวา' },
  { id: 'left_leg', label: 'Left Leg', labelTh: 'ขาซ้าย' },
  { id: 'right_leg', label: 'Right Leg', labelTh: 'ขาขวา' },
];
export const MOVEMENT_PATTERNS = [
  { id: 'bilateralSync', label: 'Both sides together / auto', labelTh: 'สองข้างพร้อมกัน / อัตโนมัติ' },
  { id: 'unilateral', label: 'One side', labelTh: 'ข้างเดียว' },
  { id: 'alternating', label: 'Alternating left/right', labelTh: 'สลับซ้าย/ขวา' },
];
export const COUNT_MODES = [
  { id: 'per_side', label: 'Count each side', labelTh: 'นับทีละข้าง' },
  { id: 'cycle', label: 'Left + right = 1 rep', labelTh: 'ซ้าย+ขวา = 1 ครั้ง' },
];
const BODY_REGION_ALIASES = {
  whole: 'full',
  whole_body: 'full',
  full_body: 'full',
};
export function normalizeBodyRegionId(bodyRegion = 'full') {
  const id = BODY_REGION_ALIASES[bodyRegion] || bodyRegion;
  return BODY_REGIONS.some((r) => r.id === id) ? id : 'full';
}
export function defaultPrimaryJoint(bodyRegion = 'full') {
  const region = normalizeBodyRegionId(bodyRegion);
  if (region === 'upper' || region === 'shoulder' || region === 'right_arm') return 'right_shoulder';
  if (region === 'left_arm') return 'left_shoulder';
  if (region === 'lower' || region === 'right_leg') return 'right_knee';
  if (region === 'left_leg') return 'left_knee';
  return 'right_knee';
}
export function inferBodyRegion(primaryJoint) {
  if (!primaryJoint) return 'full';
  if (primaryJoint === 'neck') return 'shoulder';
  if (primaryJoint === 'left_shoulder' || primaryJoint === 'left_elbow') return 'left_arm';
  if (primaryJoint === 'right_shoulder' || primaryJoint === 'right_elbow') return 'right_arm';
  if (primaryJoint.includes('shoulder')) return 'shoulder';
  if (primaryJoint === 'left_hip' || primaryJoint === 'left_knee' || primaryJoint === 'left_ankle') return 'left_leg';
  if (primaryJoint === 'right_hip' || primaryJoint === 'right_knee' || primaryJoint === 'right_ankle') return 'right_leg';
  return 'full';
}
export function getBodyRegion(ex) {
  return ex?.bodyRegion ? normalizeBodyRegionId(ex.bodyRegion) : inferBodyRegion(ex?.primaryJoint);
}

export function exerciseMetadata(ex = {}) {
  return { ...DEFAULT_EXERCISE_METADATA, ...(EXERCISE_METADATA[ex.id] || {}), ...ex };
}

export function requiredJointsForExercise(ex = {}) {
  const metadata = exerciseMetadata(ex);
  if (Array.isArray(metadata.requiredJoints) && metadata.requiredJoints.length) {
    return [...new Set(metadata.requiredJoints.filter(Boolean))];
  }
  return [metadata.primaryJoint || defaultPrimaryJoint(metadata.bodyRegion)].filter(Boolean);
}

export function scoringProfileForExercise(ex = {}) {
  return exerciseMetadata(ex).scoringProfile || (ex.type === 'hold' ? 'static_hold' : 'default_rep');
}

// ── Custom exercises (therapist-created via Capture) — persisted locally ──
// Kept separate from the built-in seed list and merged in via getExercises().
// When assigned in Plan Builder, a snapshot is embedded in the patient plan.
const CUSTOM_KEY = 'physioai.v1.exercises.custom';
function readCustom() {
  try { const r = localStorage.getItem(CUSTOM_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeCustom(list) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch {} }

export function getCustomExercises() { return readCustom(); }
// Full library shown in the pickers = built-in seed + therapist's custom exercises.
export function getExercises() { return [...EXERCISES, ...readCustom()]; }
export const exerciseExists = (id) => getExercises().some((e) => e.id === id);
export function getExercise(id) {
  return getExercises().find((e) => e.id === id) || EXERCISES[0];
}

export function updateCustomExercise(id, patch) {
  const list = readCustom();
  const idx = list.findIndex((e) => e.id === id);
  if (idx < 0) { const err = new Error('not-found'); err.code = 'not-found'; throw err; }
  const merged = { ...list[idx], ...patch, id: list[idx].id, source: 'custom' };
  if (!merged.landmarkSchemaId && merged.bodyRegion) {
    merged.landmarkSchemaId = defaultLandmarkSchemaIdForBodyRegion(merged.bodyRegion);
  }
  const next = { ...merged, ...landmarkSchemaMetadataForExercise(merged) };
  const out = list.slice();
  out[idx] = next;
  writeCustom(out);
  return next;
}

export function exerciseSnapshot(ex) {
  if (!ex || ex.source !== 'custom') return null;
  return {
    id: ex.id, key: ex.key, source: 'custom',
    label: ex.label, labelTh: ex.labelTh,
    icon: ex.icon, accent: ex.accent, category: ex.category,
    primaryJoint: ex.primaryJoint,
    bodyRegion: ex.bodyRegion,
    type: ex.type, dir: ex.dir,
    target: ex.target, rest: ex.rest, tol: ex.tol,
    reps: ex.reps, sets: ex.sets, holdSec: ex.holdSec,
    repMode: ex.repMode,
    movementPattern: ex.movementPattern,
    alternatingSides: ex.alternatingSides,
    countMode: ex.countMode,
    repJoints: ex.repJoints,
    primaryJoints: ex.primaryJoints,
    requestedRepJoints: ex.requestedRepJoints,
    dominantJoint: ex.dominantJoint,
    jointMotion: ex.jointMotion,
    sideMotions: ex.sideMotions,
    jointAngles: ex.jointAngles,
    restJointAngles: ex.restJointAngles,
    targetJointAngles: ex.targetJointAngles,
    targetJointAnglesBySide: ex.targetJointAnglesBySide,
    landmarks: ex.landmarks,
    restLandmarks: ex.restLandmarks,
    targetLandmarks: ex.targetLandmarks,
    targetLandmarksBySide: ex.targetLandmarksBySide,
    returnRestJointAngles: ex.returnRestJointAngles,
    returnRestLandmarks: ex.returnRestLandmarks,
    referenceSequence: ex.referenceSequence,
    cameraOrientation: ex.cameraOrientation,
    cameraSide: ex.cameraSide,
    recommendedCameraDistanceM: ex.recommendedCameraDistanceM,
    recommendedCameraHeight: ex.recommendedCameraHeight,
    requiredJoints: ex.requiredJoints,
    optionalJoints: ex.optionalJoints,
    landmarkSchemaId: ex.landmarkSchemaId,
    templateOnly: ex.templateOnly,
    activeModelId: ex.activeModelId,
    modelStatus: ex.modelStatus,
    primaryRequiredLandmarks: ex.primaryRequiredLandmarks,
    stabilizerRequiredLandmarks: ex.stabilizerRequiredLandmarks,
    modelInputLandmarks: ex.modelInputLandmarks,
    jointNames: ex.jointNames,
    featureSchemaVersion: ex.featureSchemaVersion,
    minVisibility: ex.minVisibility,
    minUsableJointRatio: ex.minUsableJointRatio,
    minROMDeg: ex.minROMDeg,
    minRepMs: ex.minRepMs,
    maxRepMs: ex.maxRepMs,
    movementPlane: ex.movementPlane,
    scoringProfile: ex.scoringProfile,
    feedbackProfile: ex.feedbackProfile,
    allow3D: ex.allow3D,
    allowMirror: ex.allowMirror,
    allowSeated: ex.allowSeated,
    setupInstructionTh: ex.setupInstructionTh,
    setupInstructionEn: ex.setupInstructionEn,
    contraindicationNote: ex.contraindicationNote,
  };
}

// Display label: custom exercises carry their own typed name; built-ins use i18n keys.
export function exLabel(ex, t) {
  if (!ex) return '';
  return ex.source === 'custom' ? (ex.label || ex.id) : t('ex_' + ex.key);
}

// Create + persist a custom exercise from Capture's "New exercise" form.
// Input { label, bodyRegion, type:'rep'|'hold' } → full exercise object (also returned).
// For rep exercises, Capture records rest + target and then auto-selects the
// multi-joint rep model from the chosen body region.
export function saveCustomExercise({ label, bodyRegion, type = 'rep', movementPattern = 'bilateralSync', countMode = 'per_side' }) {
  const name = (label || '').trim();
  const region = normalizeBodyRegionId(bodyRegion);
  if (!name || !bodyRegion || !BODY_REGIONS.some((r) => r.id === region)) { const err = new Error('required'); err.code = 'required'; throw err; }
  const pattern = MOVEMENT_PATTERNS.some((p) => p.id === movementPattern) ? movementPattern : 'bilateralSync';
  const mode = COUNT_MODES.some((m) => m.id === countMode) ? countMode : 'per_side';
  const primaryJoint = defaultPrimaryJoint(region);
  const id = 'cust_' + Date.now().toString(36);
  const hold = type === 'hold';
  const ex = {
    ...DEFAULT_EXERCISE_METADATA,
    id, key: id, source: 'custom', icon: 'body', accent: '#7BA88F',
    label: name, labelTh: name,
    primaryJoint, bodyRegion: region, type: hold ? 'hold' : 'rep', dir: hold ? 'hold' : 'up',
    templateOnly: false,
    landmarkSchemaId: defaultLandmarkSchemaIdForBodyRegion(region),
    activeModelId: null,
    modelStatus: 'collecting_data',
    target: hold ? 90 : 120, rest: hold ? 90 : 30,
    tol: primaryJoint.includes('elbow') || primaryJoint === 'back' || primaryJoint === 'neck' ? 12 : 15,
    reps: 10, sets: 3, holdSec: hold ? 10 : 1.5,
    autoPrimaryJoint: true,
    pendingAutoPrimary: !hold,
    repMode: hold ? 'single' : (pattern === 'alternating' ? 'alternating' : 'multi'),
    movementPattern: hold ? 'unilateral' : pattern,
    alternatingSides: pattern === 'alternating' ? ['left', 'right'] : undefined,
    countMode: pattern === 'alternating' ? mode : undefined,
    requiredJoints: [primaryJoint, ...(region.includes('arm') ? [primaryJoint.replace('shoulder', 'elbow')] : [])].filter(Boolean),
    optionalJoints: [],
    movementPlane: region.includes('arm') || region === 'shoulder' ? 'frontal' : 'sagittal',
    scoringProfile: hold ? 'static_hold' : 'default_rep',
    setupInstructionTh: `จัดตำแหน่งให้กล้องเห็น${name}ชัดเจน`,
    setupInstructionEn: `Set up so the camera can clearly see ${name}.`,
  };
  const withSchema = { ...ex, ...landmarkSchemaMetadataForExercise(ex) };
  writeCustom([...readCustom().filter((e) => e.id !== id), withSchema]);
  return withSchema;
}
export function deleteCustomExercise(id) {
  writeCustom(readCustom().filter((e) => e.id !== id));
}
