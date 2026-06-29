import { idx } from './Landmarks.js';
import { getBodyRegionLandmarkSchema, resolveBodyRegionLandmarkSchema } from './BodyRegionLandmarkSchema.js';

export const MOTION_SAFETY_STATUSES = Object.freeze({
  READY: 'ready',
  NO_POSE: 'no_pose',
  MISSING_PRIMARY_REQUIRED: 'missing_primary_required',
  MISSING_STABILIZER_REQUIRED: 'missing_stabilizer_required',
  LOW_VISIBILITY: 'low_visibility',
  OUT_OF_FRAME: 'out_of_frame',
  MISSING_SCHEMA: 'missing_schema',
});

const DEFAULT_BOX = Object.freeze({
  left: 0.025,
  top: 0.025,
  right: 0.975,
  bottom: 0.975,
  width: 0.95,
  height: 0.95,
});

function finitePoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function insideBox(point, box = DEFAULT_BOX) {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

function pointFor(landmarks, name) {
  const index = idx(name);
  return index >= 0 ? landmarks?.[index] || null : null;
}

function evaluateGroup(landmarks, names, { minVisibility, boundaryBox, requireInside }) {
  const visible = [];
  const missing = [];
  const lowVisibility = [];
  const inside = [];
  const outside = [];

  for (const name of names || []) {
    const point = pointFor(landmarks, name);
    if (!finitePoint(point)) {
      missing.push(name);
      continue;
    }
    const visibility = Number(point.visibility ?? 1);
    if (!Number.isFinite(visibility) || visibility < minVisibility) {
      lowVisibility.push(name);
      continue;
    }
    visible.push(name);
    if (!requireInside || insideBox(point, boundaryBox)) inside.push(name);
    else outside.push(name);
  }

  const total = Math.max(1, names?.length || 0);
  return {
    names: [...(names || [])],
    visible,
    missing,
    lowVisibility,
    inside,
    outside,
    visibilityRatio: visible.length / total,
    insideRatio: inside.length / total,
  };
}

function hintFor(status, primary, stabilizer) {
  if (status === MOTION_SAFETY_STATUSES.READY) {
    return { hint: 'Ready to record AI dataset', hintTh: 'พร้อมเก็บข้อมูลฝึก AI' };
  }
  if (status === MOTION_SAFETY_STATUSES.NO_POSE) {
    return { hint: 'Step into the camera frame', hintTh: 'เข้ากรอบกล้องก่อน' };
  }
  if (status === MOTION_SAFETY_STATUSES.MISSING_PRIMARY_REQUIRED) {
    return {
      hint: `Missing primary landmarks: ${primary.missing.join(', ') || primary.lowVisibility.join(', ')}`,
      hintTh: `ยังไม่เห็นจุดหลักครบ: ${primary.missing.join(', ') || primary.lowVisibility.join(', ')}`,
    };
  }
  if (status === MOTION_SAFETY_STATUSES.MISSING_STABILIZER_REQUIRED) {
    return {
      hint: `Primary is visible, but stabilizers are missing: ${stabilizer.missing.join(', ') || stabilizer.lowVisibility.join(', ')}`,
      hintTh: `เห็นส่วนหลักแล้ว แต่ต้องเห็นจุดช่วยทรงตัว: ${stabilizer.missing.join(', ') || stabilizer.lowVisibility.join(', ')}`,
    };
  }
  if (status === MOTION_SAFETY_STATUSES.LOW_VISIBILITY) {
    return { hint: 'Improve landmark visibility before recording', hintTh: 'ปรับแสงหรือถอยกล้องให้เห็นจุดสำคัญชัดขึ้น' };
  }
  if (status === MOTION_SAFETY_STATUSES.OUT_OF_FRAME) {
    return { hint: 'Move the required landmarks inside the frame', hintTh: 'ขยับให้จุดสำคัญอยู่ในกรอบ' };
  }
  return { hint: 'Schema not ready', hintTh: 'schema ของท่ายังไม่พร้อม' };
}

export function evaluateMotionSafetyGate(landmarks, {
  exercise = {},
  landmarkSchemaId = null,
  landmarkSchema = null,
  boundaryBox = DEFAULT_BOX,
  minVisibility = null,
} = {}) {
  const requestedSchemaId = landmarkSchemaId || exercise?.landmarkSchemaId || null;
  const schema = landmarkSchema || (requestedSchemaId
    ? resolveBodyRegionLandmarkSchema(requestedSchemaId, { fallback: false })
    : getBodyRegionLandmarkSchema(exercise));
  if (!schema?.id) {
    const hint = hintFor(MOTION_SAFETY_STATUSES.MISSING_SCHEMA, {}, {});
    return {
      ok: false,
      trainable: false,
      scoreable: false,
      status: MOTION_SAFETY_STATUSES.MISSING_SCHEMA,
      dataQuality: MOTION_SAFETY_STATUSES.MISSING_SCHEMA,
      schemaId: requestedSchemaId,
      primary: { names: [], visible: [], missing: [], lowVisibility: [], inside: [], outside: [], visibilityRatio: 0, insideRatio: 0 },
      stabilizer: { names: [], visible: [], missing: [], lowVisibility: [], inside: [], outside: [], visibilityRatio: 0, insideRatio: 0 },
      missingPrimary: [],
      missingStabilizer: [],
      ...hint,
    };
  }

  if (!Array.isArray(landmarks) || !landmarks.length) {
    const primary = {
      names: [...schema.primaryRequiredLandmarks],
      visible: [],
      missing: [...schema.primaryRequiredLandmarks],
      lowVisibility: [],
      inside: [],
      outside: [],
      visibilityRatio: 0,
      insideRatio: 0,
    };
    const stabilizer = {
      names: [...schema.stabilizerRequiredLandmarks],
      visible: [],
      missing: [...schema.stabilizerRequiredLandmarks],
      lowVisibility: [],
      inside: [],
      outside: [],
      visibilityRatio: 0,
      insideRatio: 0,
    };
    const hint = hintFor(MOTION_SAFETY_STATUSES.NO_POSE, primary, stabilizer);
    return {
      ok: false,
      trainable: false,
      scoreable: false,
      status: MOTION_SAFETY_STATUSES.NO_POSE,
      dataQuality: MOTION_SAFETY_STATUSES.NO_POSE,
      schemaId: schema.id,
      primary,
      stabilizer,
      missingPrimary: primary.missing,
      missingStabilizer: stabilizer.missing,
      ...hint,
    };
  }

  const policy = schema.boundaryPolicy || {};
  const visibility = Number(minVisibility ?? exercise?.minVisibility ?? schema.minVisibility ?? 0.6);
  const primary = evaluateGroup(landmarks, schema.primaryRequiredLandmarks, {
    minVisibility: visibility,
    boundaryBox,
    requireInside: policy.requirePrimaryInside !== false,
  });
  const stabilizer = evaluateGroup(landmarks, schema.stabilizerRequiredLandmarks, {
    minVisibility: visibility,
    boundaryBox,
    requireInside: policy.requireStabilizerInside !== false,
  });

  const missingPrimary = [...primary.missing, ...primary.lowVisibility];
  const missingStabilizer = [...stabilizer.missing, ...stabilizer.lowVisibility];
  let status = MOTION_SAFETY_STATUSES.READY;
  if (primary.missing.length) status = MOTION_SAFETY_STATUSES.MISSING_PRIMARY_REQUIRED;
  else if (stabilizer.missing.length) status = MOTION_SAFETY_STATUSES.MISSING_STABILIZER_REQUIRED;
  else if (primary.lowVisibility.length || stabilizer.lowVisibility.length) status = MOTION_SAFETY_STATUSES.LOW_VISIBILITY;
  else if (
    primary.visibilityRatio < (policy.minPrimaryVisibleRatio ?? 0.9) ||
    stabilizer.visibilityRatio < (policy.minStabilizerVisibleRatio ?? 0.9)
  ) status = MOTION_SAFETY_STATUSES.LOW_VISIBILITY;
  else if (
    primary.outside.length ||
    stabilizer.outside.length ||
    Math.min(primary.insideRatio, stabilizer.insideRatio) < (policy.minBoundaryInsideRatio ?? 0.9)
  ) status = MOTION_SAFETY_STATUSES.OUT_OF_FRAME;

  const ok = status === MOTION_SAFETY_STATUSES.READY;
  const hint = hintFor(status, primary, stabilizer);
  return {
    ok,
    trainable: ok,
    scoreable: ok,
    status,
    dataQuality: ok ? 'usable' : status,
    schemaId: schema.id,
    primary,
    stabilizer,
    missingPrimary,
    missingStabilizer,
    ...hint,
  };
}
