// PhysioAI · Version-1 — Joint Angle Calculator (diagram node P1.3 / P2.3).
//
// Algorithm (math, not AI). Converts BlazePose's 33 landmarks into 12 joint
// angles via 2D inverse-trigonometry (atan2), so poses can be compared fairly
// across body sizes and camera distances. Owns JOINT_SPECS — the canonical
// definition of the tracked joints (vertex + the two rays it spans).

import { idx } from './Landmarks.js';

const MIN_VIS = 0.5;

// ─── The tracked joints (vertex b, with rays b→a and b→c) ─
export const JOINT_SPECS = [
  { joint: 'left_elbow',     a: 'left_shoulder',  b: 'left_elbow',     c: 'left_wrist',       label: 'L. elbow',    labelTh: 'ศอกซ้าย' },
  { joint: 'right_elbow',    a: 'right_shoulder', b: 'right_elbow',    c: 'right_wrist',      label: 'R. elbow',    labelTh: 'ศอกขวา' },
  { joint: 'left_shoulder',  a: 'left_elbow',     b: 'left_shoulder',  c: 'left_hip',         label: 'L. shoulder', labelTh: 'ไหล่ซ้าย' },
  { joint: 'right_shoulder', a: 'right_elbow',    b: 'right_shoulder', c: 'right_hip',        label: 'R. shoulder', labelTh: 'ไหล่ขวา' },
  { joint: 'left_hip',       a: 'left_shoulder',  b: 'left_hip',       c: 'left_knee',        label: 'L. hip',      labelTh: 'สะโพกซ้าย' },
  { joint: 'right_hip',      a: 'right_shoulder', b: 'right_hip',      c: 'right_knee',       label: 'R. hip',      labelTh: 'สะโพกขวา' },
  { joint: 'left_knee',      a: 'left_hip',       b: 'left_knee',      c: 'left_ankle',       label: 'L. knee',     labelTh: 'เข่าซ้าย' },
  { joint: 'right_knee',     a: 'right_hip',      b: 'right_knee',      c: 'right_ankle',      label: 'R. knee',     labelTh: 'เข่าขวา' },
  { joint: 'left_ankle',     a: 'left_knee',      b: 'left_ankle',     c: 'left_foot_index',  label: 'L. ankle',    labelTh: 'ข้อเท้าซ้าย' },
  { joint: 'right_ankle',    a: 'right_knee',     b: 'right_ankle',    c: 'right_foot_index', label: 'R. ankle',    labelTh: 'ข้อเท้าขวา' },
  { joint: 'back',           a: 'mid_shoulder',   b: 'mid_hip',        c: 'mid_knee',         label: 'Back',        labelTh: 'หลัง' },
  { joint: 'neck',           a: 'head_center',    b: 'mid_shoulder',   c: 'mid_hip',          label: 'Neck',        labelTh: 'คอ' },
];

// ─── Joint-angle math (atan2 form) ──────────────────────────
export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const cross = v1x * v2y - v1y * v2x;          // 2D cross magnitude
  if ((v1x === 0 && v1y === 0) || (v2x === 0 && v2y === 0)) return null;
  const deg = Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
  return Number.isFinite(deg) ? deg : null;
}

export function angleAt3D(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = (a.z ?? 0) - (b.z ?? 0);
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = (c.z ?? 0) - (b.z ?? 0);
  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const m1 = Math.sqrt(v1x ** 2 + v1y ** 2 + v1z ** 2);
  const m2 = Math.sqrt(v2x ** 2 + v2y ** 2 + v2z ** 2);
  if (m1 < 1e-6 || m2 < 1e-6) return null;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  const deg = Math.acos(cos) * 180 / Math.PI;
  return Number.isFinite(deg) ? deg : null;
}

function rawVisibleKp(landmarks, name, minVisibility = MIN_VIS) {
  const index = idx(name);
  if (index < 0) return null;
  const k = landmarks?.[index];
  if (!k) return null;
  if ((k.visibility ?? 1) < minVisibility) return null;
  return k;
}

function midpoint(landmarks, aName, bName, minVisibility = MIN_VIS) {
  const a = rawVisibleKp(landmarks, aName, minVisibility);
  const b = rawVisibleKp(landmarks, bName, minVisibility);
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function visibleKp(landmarks, name, minVisibility = MIN_VIS) {
  if (name === 'mid_shoulder') return midpoint(landmarks, 'left_shoulder', 'right_shoulder', minVisibility);
  if (name === 'mid_hip') return midpoint(landmarks, 'left_hip', 'right_hip', minVisibility);
  if (name === 'mid_knee') return midpoint(landmarks, 'left_knee', 'right_knee', minVisibility);
  if (name === 'head_center') return midpoint(landmarks, 'left_ear', 'right_ear', minVisibility) || rawVisibleKp(landmarks, 'nose', minVisibility);
  return rawVisibleKp(landmarks, name, minVisibility);
}

function fallbackKp() {
  return null;
}

export function jointAngleCalculatorDetailed(landmarks, { minVisibility = MIN_VIS, use3D = false } = {}) {
  const angles = {};
  const meta = {
    minVisibility,
    use3D: !!use3D,
    missingByJoint: {},
    visibleByJoint: {},
    usableJoints: [],
    unusableJoints: [],
  };

  for (const s of JOINT_SPECS) {
    const a = visibleKp(landmarks, s.a, minVisibility);
    const b = visibleKp(landmarks, s.b, minVisibility);
    const c = visibleKp(landmarks, s.c, minVisibility) || fallbackKp(landmarks, s, 'c', b);
    const missing = [];
    if (!a) missing.push(s.a);
    if (!b) missing.push(s.b);
    if (!c) missing.push(s.c);
    meta.visibleByJoint[s.joint] = {
      a: !!a,
      b: !!b,
      c: !!c,
    };
    if (missing.length) {
      angles[s.joint] = null;
      meta.missingByJoint[s.joint] = missing;
      meta.unusableJoints.push(s.joint);
      continue;
    }
    angles[s.joint] = use3D ? angleAt3D(a, b, c) : angleAt(a, b, c);
    if (Number.isFinite(angles[s.joint])) meta.usableJoints.push(s.joint);
    else meta.unusableJoints.push(s.joint);
  }

  meta.usableJointRatio = JOINT_SPECS.length ? meta.usableJoints.length / JOINT_SPECS.length : 0;
  return { angles, meta };
}

/** 33 landmarks → { jointName: degrees | null } for all tracked joints. */
export function jointAngleCalculator(landmarks, options = {}) {
  return jointAngleCalculatorDetailed(landmarks, options).angles;
}
