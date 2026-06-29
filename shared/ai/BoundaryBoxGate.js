// PhysioAI · Therapist web boundary box gate.
// Uses normalized BlazePose landmarks, so it works across live video, still images,
// and synthetic demo frames drawn into any canvas size.

import { idx } from './Landmarks.js';
import { getBodyRegionLandmarkSchema } from './BodyRegionLandmarkSchema.js';
import { evaluateMotionSafetyGate } from './MotionSafetyGate.js';
import { exerciseMetadata } from '../core/exercises.js';

export const BOUNDARY_BOX_RATIO = 0.95;

const VIS_OK = 0.35;

const CORE = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'];
const DISTAL = ['left_wrist', 'right_wrist', 'left_ankle', 'right_ankle'];
const REGION_KEYS = {
  upper: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  lower: ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
  shoulder: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow'],
  left_arm: ['left_shoulder', 'left_elbow', 'left_wrist'],
  right_arm: ['right_shoulder', 'right_elbow', 'right_wrist'],
  left_leg: ['left_hip', 'left_knee', 'left_ankle'],
  right_leg: ['right_hip', 'right_knee', 'right_ankle'],
  full: [
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
    'left_ankle', 'right_ankle',
  ],
};
const REGION_CORE = {
  upper: ['left_shoulder', 'right_shoulder'],
  lower: ['left_hip', 'right_hip'],
  shoulder: ['left_shoulder', 'right_shoulder'],
  left_arm: ['left_shoulder'],
  right_arm: ['right_shoulder'],
  left_leg: ['left_hip'],
  right_leg: ['right_hip'],
  full: CORE,
};
const REGION_DISTAL = {
  upper: ['left_wrist', 'right_wrist'],
  lower: ['left_ankle', 'right_ankle'],
  shoulder: ['left_elbow', 'right_elbow'],
  left_arm: ['left_wrist'],
  right_arm: ['right_wrist'],
  left_leg: ['left_ankle'],
  right_leg: ['right_ankle'],
  full: DISTAL,
};
const FULL_BODY = [
  'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
];
const NEIGHBORS = {
  left_elbow: ['left_shoulder', 'left_wrist'],
  right_elbow: ['right_shoulder', 'right_wrist'],
  left_shoulder: ['left_elbow', 'left_hip'],
  right_shoulder: ['right_elbow', 'right_hip'],
  left_hip: ['left_shoulder', 'left_knee'],
  right_hip: ['right_shoulder', 'right_knee'],
  left_knee: ['left_hip', 'left_ankle'],
  right_knee: ['right_hip', 'right_ankle'],
  left_ankle: ['left_knee', 'left_foot_index'],
  right_ankle: ['right_knee', 'right_foot_index'],
  back: ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee'],
  neck: ['nose', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
};

const BODY_REGION_ALIASES = {
  whole: 'full',
  whole_body: 'full',
  full_body: 'full',
};

function normalizeRegion(region) {
  const id = BODY_REGION_ALIASES[region] || region;
  return REGION_KEYS[id] ? id : 'full';
}

function inferBodyRegion(primaryJoint) {
  if (!primaryJoint) return 'full';
  if (primaryJoint === 'neck') return 'shoulder';
  if (primaryJoint === 'left_shoulder' || primaryJoint === 'left_elbow') return 'left_arm';
  if (primaryJoint === 'right_shoulder' || primaryJoint === 'right_elbow') return 'right_arm';
  if (primaryJoint.includes('shoulder')) return 'shoulder';
  if (primaryJoint === 'left_hip' || primaryJoint === 'left_knee' || primaryJoint === 'left_ankle') return 'left_leg';
  if (primaryJoint === 'right_hip' || primaryJoint === 'right_knee' || primaryJoint === 'right_ankle') return 'right_leg';
  return 'full';
}

function bodyRegion(exercise) {
  return normalizeRegion(exercise?.bodyRegion || inferBodyRegion(exercise?.primaryJoint));
}

const STATUS_COLOR = {
  inside: '#7BA88F',
  outside: '#B86C5A',
};

export function getBoundaryBox(ratio = BOUNDARY_BOX_RATIO) {
  const margin = (1 - ratio) / 2;
  return {
    left: margin,
    top: margin,
    right: 1 - margin,
    bottom: 1 - margin,
    width: ratio,
    height: ratio,
  };
}

export function boundaryKeyJoints(exercise) {
  const metadata = exerciseMetadata(exercise || {});
  if (Array.isArray(metadata.requiredJoints) && metadata.requiredJoints.length) {
    return [...new Set(metadata.requiredJoints.filter(Boolean))];
  }
  const schema = getBodyRegionLandmarkSchema(metadata);
  if (schema?.modelInputLandmarks?.length) {
    return [...schema.modelInputLandmarks];
  }
  const region = bodyRegion(exercise);
  const primary = exercise?.primaryJoint;
  const names = primary === 'back' || primary === 'neck' ? [] : [...REGION_KEYS[region]];
  const allowed = new Set(names);
  if (primary === 'back' || primary === 'neck') {
    for (const n of NEIGHBORS[primary]) names.push(n);
  } else if (primary && (region === 'full' || allowed.has(primary))) {
    names.push(primary);
    for (const n of (NEIGHBORS[primary] || [])) {
      if (region === 'full' || allowed.has(n)) names.push(n);
    }
  }
  return [...new Set(names)];
}

function insideBox(p, box) {
  return p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
}

function expectedExitNames(exercise) {
  const joint = exercise?.primaryJoint || '';
  const region = bodyRegion(exercise);
  if (!['upper', 'full', 'shoulder', 'left_arm', 'right_arm'].includes(region)) return new Set();
  if (!joint.includes('shoulder') && !joint.includes('elbow')) return new Set();
  if (joint.startsWith('left_') || region === 'left_arm') return new Set(['left_wrist']);
  if (joint.startsWith('right_') || region === 'right_arm') return new Set(['right_wrist']);
  return new Set(['left_wrist', 'right_wrist']);
}

function isExpectedTopExit(p, name, box, exercise) {
  return expectedExitNames(exercise).has(name) && p.y < box.top;
}

function bodyBoxFor(points) {
  if (!points.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function hintFor(status, safety = null) {
  if (safety?.hint || safety?.hintTh) return { hint: safety.hint, hintTh: safety.hintTh };
  if (status === 'inside') return { hint: 'Framing good', hintTh: 'อยู่ในกรอบแล้ว' };
  return { hint: 'Move inside the frame', hintTh: 'ขยับตัวให้อยู่ในกรอบ' };
}

export function evaluateBoundaryBox(landmarks, previousFrame = null, exercise = null, now = performance.now()) {
  const box = getBoundaryBox();
  const metadata = exerciseMetadata(exercise || {});
  const minVisibility = Number(metadata.minVisibility) || VIS_OK;
  const names = boundaryKeyJoints(exercise);
  const keySpecs = names.map((name) => ({ name, index: idx(name) })).filter((s) => s.index >= 0);
  const keyIndices = keySpecs.map((s) => s.index);
  const safety = evaluateMotionSafetyGate(landmarks, {
    exercise: metadata,
    boundaryBox: box,
    minVisibility,
  });
  const visible = [];
  const missingNames = [...new Set([
    ...(safety.missingPrimary || []),
    ...(safety.missingStabilizer || []),
  ])];
  const missing = missingNames.map(idx).filter((index) => index >= 0);

  if (!landmarks || !landmarks.length) {
    const nextFrame = { landmarks: null, at: now, status: 'outside' };
    return {
      status: 'outside',
      readinessStatus: safety.status,
      dataQuality: safety.dataQuality,
      ok: false,
      trainable: false,
      scoreable: false,
      box,
      bodyBox: null,
      missing: names.map(idx).filter((index) => index >= 0),
      missingNames: names,
      willExit: false,
      keyIndices,
      primary: safety.primary,
      stabilizer: safety.stabilizer,
      landmarkSchemaId: safety.schemaId,
      ...hintFor('outside', safety),
      nextFrame,
    };
  }

  const isVisible = (i) => {
    const p = landmarks[i];
    return !!(p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= minVisibility);
  };

  for (const { name, index } of keySpecs) {
    const p = landmarks[index];
    if (isVisible(index)) {
      visible.push({ ...p, index, name });
    }
  }

  const bodyBox = bodyBoxFor(visible);
  const status = safety.ok ? 'inside' : 'outside';
  const nextFrame = { landmarks, at: now, status };
  return {
    status,
    readinessStatus: safety.status,
    dataQuality: safety.dataQuality,
    ok: status === 'inside',
    trainable: safety.trainable,
    scoreable: safety.scoreable,
    box,
    bodyBox,
    missing,
    missingNames,
    willExit: false,
    softOutside: false,
    outsideStreak: status === 'outside' ? 1 : 0,
    keyIndices,
    primary: safety.primary,
    stabilizer: safety.stabilizer,
    landmarkSchemaId: safety.schemaId,
    ...hintFor(status, safety),
    nextFrame,
  };
}

export function drawBoundaryBox(ctx, boundary) {
  if (!ctx?.canvas) return;
  const box = boundary?.box || getBoundaryBox();
  const status = boundary?.status || 'outside';
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const x = box.left * w;
  const y = box.top * h;
  const bw = box.width * w;
  const bh = box.height * h;
  const radius = Math.max(10, Math.min(w, h) * 0.018);

  ctx.save();
  ctx.lineWidth = Math.max(4, Math.min(w, h) * 0.006);
  ctx.strokeStyle = STATUS_COLOR[status] || STATUS_COLOR.outside;
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.95;
  roundedRect(ctx, x, y, bw, bh, radius);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.globalAlpha = 0.75;
  roundedRect(ctx, x + 4, y + 4, Math.max(0, bw - 8), Math.max(0, bh - 8), Math.max(0, radius - 4));
  ctx.stroke();
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
