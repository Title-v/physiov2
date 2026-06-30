import { modelManifestSchemaFields, resolveBodyRegionLandmarkSchema } from '../../ai/BodyRegionLandmarkSchema.js';
import { evaluateModelApproval } from '../../ai/ModelApprovalCriteria.js';
import { expectedMotionFeatureSizeForSchema } from '../../ai/MotionFeatureExtractor.js';
import { TCN_PHASES, TCN_QUALITIES } from '../../ai/TcnMotionClassifier.js';

const MAX_TEXT = 5000;
const MAX_ITEMS = 100;
const MAX_JSON_BYTES = 250_000;
const MOTION_LABELS = ['good', 'incomplete', 'wrong_path', 'unstable'];
const SESSION_SCORE_SOURCES = ['rule', 'ai_primary'];

function issue(path, code) {
  return `${path}:${code}`;
}

export function validationOk(value = null) {
  return { ok: true, value, issues: [] };
}

export function validationFail(issues = []) {
  return { ok: false, value: null, issues };
}

export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function safeString(value, { trim = true, max = MAX_TEXT } = {}) {
  if (typeof value !== 'string') return null;
  const next = trim ? value.trim() : value;
  if (!next || next.length > max) return null;
  return next;
}

export function safeEmail(value) {
  const email = safeString(value, { max: 320 })?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function safeIdentifier(value, { max = 120 } = {}) {
  const id = safeString(value, { max });
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

export function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Infinity;
  }
}

export function validateJsonSize(value, path = 'body') {
  return jsonByteLength(value) <= MAX_JSON_BYTES ? [] : [issue(path, 'too_large')];
}

export function validatePatientLookupPayload(body = {}) {
  if (!isPlainObject(body)) return validationFail([issue('body', 'object_required')]);
  const hasPatientId = body.patientId != null && String(body.patientId).trim() !== '';
  const hasEmail = body.email != null && String(body.email).trim() !== '';
  const patientId = body.patientId == null ? '' : safeIdentifier(body.patientId);
  const email = body.email == null ? '' : safeEmail(body.email);
  if (!hasPatientId && !hasEmail) return validationFail([issue('patientId_or_email', 'required')]);
  const issues = validateJsonSize(body);
  if (hasPatientId && !patientId) issues.push(issue('patientId', 'invalid'));
  if (hasEmail && !email) issues.push(issue('email', 'invalid'));
  if (issues.length) return validationFail(issues);
  return validationOk({ patientId, email });
}

export function validateCreatePatientPayload(body = {}) {
  if (!isPlainObject(body)) return validationFail([issue('body', 'object_required')]);
  const hasName = body.name != null && String(body.name).trim() !== '';
  const hasEmail = body.email != null && String(body.email).trim() !== '';
  const hasPassword = body.password != null && String(body.password) !== '';
  const name = safeString(body.name, { max: 160 });
  const email = safeEmail(body.email);
  const password = safeString(body.password, { trim: false, max: 256 });
  if (!hasName || !hasEmail || !hasPassword) return validationFail([issue('name_email_password', 'required')]);
  const issues = validateJsonSize(body);
  if (!name) issues.push(issue('name', 'invalid'));
  if (!email) issues.push(issue('email', 'invalid'));
  if (!password) issues.push(issue('password', 'invalid'));
  if (issues.length) return validationFail(issues);
  return validationOk({ name, email, password });
}

export function validatePlanPayload(body = {}, patientId = '') {
  if (!isPlainObject(body)) return validationFail([issue('body', 'object_required')]);
  const issues = validateJsonSize(body);
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > MAX_ITEMS) issues.push(issue('items', 'too_many'));
  for (const [index, item] of items.entries()) {
    if (!isPlainObject(item)) {
      issues.push(issue(`items.${index}`, 'object_required'));
      continue;
    }
    const rawExerciseId = item.exerciseId || item.exercise?.id;
    const exerciseId = safeIdentifier(rawExerciseId);
    if (!exerciseId) issues.push(issue(`items.${index}.exerciseId`, rawExerciseId == null ? 'required' : 'invalid'));
    for (const key of ['reps', 'sets', 'holdSec', 'frequency']) {
      if (item[key] != null && !Number.isFinite(Number(item[key]))) issues.push(issue(`items.${index}.${key}`, 'number_required'));
    }
  }
  for (const key of ['freqPerDay', 'daysPerWeek', 'durationDays', 'durationWeeks']) {
    if (body[key] != null && !Number.isFinite(Number(body[key]))) issues.push(issue(key, 'number_required'));
  }
  if (issues.length) return validationFail(issues);
  return validationOk({ ...body, patientId });
}

export function validateReferencePayload(body = {}) {
  if (!isPlainObject(body)) return validationFail([issue('body', 'object_required')]);
  const exerciseId = safeIdentifier(body.exerciseId);
  if (!exerciseId) return validationFail([issue('exerciseId', body.exerciseId == null ? 'required' : 'invalid')]);
  const issues = validateJsonSize(body);
  if (body.kind != null && !safeIdentifier(body.kind)) issues.push(issue('kind', 'invalid'));
  if (body.referenceVersion != null && !Number.isFinite(Number(body.referenceVersion))) issues.push(issue('referenceVersion', 'number_required'));
  if (body.scoringVersion != null && !Number.isFinite(Number(body.scoringVersion))) issues.push(issue('scoringVersion', 'number_required'));
  if (body.referenceSequence != null && !isPlainObject(body.referenceSequence)) issues.push(issue('referenceSequence', 'object_required'));
  if (issues.length) return validationFail(issues);
  return validationOk({ exerciseId });
}

export function validateDeleteReferencePayload({ query = {}, body = {} } = {}) {
  const rawExerciseId = query.exerciseId || body?.exerciseId;
  const exerciseId = safeIdentifier(rawExerciseId);
  if (!exerciseId) return validationFail([issue('exerciseId', rawExerciseId == null ? 'required' : 'invalid')]);
  return validationOk({ exerciseId });
}

export function validateSessionPayload(body = {}) {
  if (!isPlainObject(body)) return validationFail([issue('body', 'object_required')]);
  const exerciseId = safeIdentifier(body.exerciseId || body.exerciseKey);
  if (!exerciseId) return validationFail([issue('exerciseId', (body.exerciseId == null && body.exerciseKey == null) ? 'required' : 'invalid')]);
  const issues = validateJsonSize(body);
  if (body.id != null && !safeIdentifier(body.id, { max: 180 })) issues.push(issue('id', 'invalid'));
  if (body.endedAt != null && !Number.isFinite(Number(new Date(body.endedAt)))) issues.push(issue('endedAt', 'invalid'));
  for (const key of ['score', 'avgScore', 'reps', 'validReps', 'invalidRepCount', 'sessionVersion']) {
    if (body[key] != null && !Number.isFinite(Number(body[key]))) issues.push(issue(key, 'number_required'));
  }
  if (body.scoreSource != null && !SESSION_SCORE_SOURCES.includes(body.scoreSource)) issues.push(issue('scoreSource', 'invalid'));
  if (body.summary != null && !isPlainObject(body.summary)) issues.push(issue('summary', 'object_required'));
  if (body.scoreBreakdown != null && !isPlainObject(body.scoreBreakdown)) issues.push(issue('scoreBreakdown', 'object_required'));
  if (issues.length) return validationFail(issues);
  return validationOk({ exerciseId });
}

function isStringArray(value, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) return false;
  if (nonEmpty && !value.length) return false;
  return value.every((item) => typeof item === 'string' && item.trim());
}

function validateInputShape(value) {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => Number.isInteger(Number(item)) && Number(item) > 0);
}

function sameStringArray(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function validateSchemaMetadata(body, landmarkSchemaId, issues) {
  if (!landmarkSchemaId) return null;
  const schema = resolveBodyRegionLandmarkSchema(landmarkSchemaId, { fallback: false });
  if (!schema) {
    issues.push(issue('landmarkSchemaId', 'unknown'));
    return null;
  }
  const schemaFields = modelManifestSchemaFields(schema);
  for (const key of ['modelInputLandmarks', 'primaryRequiredLandmarks', 'stabilizerRequiredLandmarks', 'jointNames']) {
    if (Array.isArray(body[key]) && body[key].length && !sameStringArray(body[key], schemaFields[key])) {
      issues.push(issue(key, 'schema_mismatch'));
    }
  }
  if (body.bodyRegion != null && body.bodyRegion !== schemaFields.bodyRegion) {
    issues.push(issue('bodyRegion', 'schema_mismatch'));
  }
  if (validateInputShape(body.inputShape)) {
    const expectedFeatureSize = expectedMotionFeatureSizeForSchema({ landmarkSchema: schema });
    if (Number(body.inputShape[1]) !== expectedFeatureSize) issues.push(issue('inputShape', 'schema_mismatch'));
  }
  return schemaFields;
}

export function validateDatasetPayload(body = {}) {
  if (!isPlainObject(body)) return validationFail([issue('body', 'object_required')]);
  const exerciseId = safeIdentifier(body.exerciseId);
  const landmarkSchemaId = safeIdentifier(body.landmarkSchemaId);
  const motionLabel = safeIdentifier(body.motionLabel || body.label);
  const issues = validateJsonSize(body);
  if (!exerciseId) issues.push(issue('exerciseId', body.exerciseId == null ? 'required' : 'invalid'));
  if (!landmarkSchemaId) issues.push(issue('landmarkSchemaId', body.landmarkSchemaId == null ? 'required' : 'invalid'));
  if (!MOTION_LABELS.includes(motionLabel)) issues.push(issue('motionLabel', motionLabel ? 'invalid' : 'required'));
  if (body.labelStatus !== 'reviewed') issues.push(issue('labelStatus', 'reviewed_required'));
  if (body.trainable !== true) issues.push(issue('trainable', 'true_required'));
  if (body.dataQuality !== 'usable') issues.push(issue('dataQuality', 'usable_required'));
  if (body.missingPrimary?.length) issues.push(issue('missingPrimary', 'must_be_empty'));
  if (body.missingStabilizer?.length) issues.push(issue('missingStabilizer', 'must_be_empty'));
  if (!Array.isArray(body.frames) || !body.frames.length) issues.push(issue('frames', 'required'));
  if (!isStringArray(body.primaryRequiredLandmarks, { nonEmpty: true })) issues.push(issue('primaryRequiredLandmarks', 'required'));
  if (!isStringArray(body.stabilizerRequiredLandmarks, { nonEmpty: true })) issues.push(issue('stabilizerRequiredLandmarks', 'required'));
  if (!isStringArray(body.modelInputLandmarks, { nonEmpty: true })) issues.push(issue('modelInputLandmarks', 'required'));
  if (!isStringArray(body.jointNames, { nonEmpty: true })) issues.push(issue('jointNames', 'required'));
  const schemaFields = validateSchemaMetadata(body, landmarkSchemaId, issues);
  if (body.id != null && !safeIdentifier(body.id, { max: 180 })) issues.push(issue('id', 'invalid'));
  if (body.subjectId != null && !safeIdentifier(body.subjectId, { max: 180 })) issues.push(issue('subjectId', 'invalid'));
  if (issues.length) return validationFail(issues);
  return validationOk({
    ...body,
    exerciseId,
    landmarkSchemaId,
    motionLabel,
    label: motionLabel,
    ...(schemaFields || {}),
    missingPrimary: [],
    missingStabilizer: [],
  });
}

export function validateAiModelPayload(body = {}) {
  if (!isPlainObject(body)) return validationFail([issue('body', 'object_required')]);
  const modelId = safeIdentifier(body.id || body.modelId, { max: 180 });
  const exerciseId = body.exerciseId == null ? null : safeIdentifier(body.exerciseId);
  const landmarkSchemaId = safeIdentifier(body.landmarkSchemaId);
  const version = safeIdentifier(body.version, { max: 180 });
  const issues = validateJsonSize(body);
  if (!modelId) issues.push(issue('id', (body.id == null && body.modelId == null) ? 'required' : 'invalid'));
  if (body.exerciseId != null && !exerciseId) issues.push(issue('exerciseId', 'invalid'));
  if (!landmarkSchemaId) issues.push(issue('landmarkSchemaId', body.landmarkSchemaId == null ? 'required' : 'invalid'));
  if (!version) issues.push(issue('version', body.version == null ? 'required' : 'invalid'));
  if (!validateInputShape(body.inputShape)) issues.push(issue('inputShape', 'invalid'));
  if (!isStringArray(body.modelInputLandmarks, { nonEmpty: true })) issues.push(issue('modelInputLandmarks', 'required'));
  if (!isStringArray(body.primaryRequiredLandmarks, { nonEmpty: true })) issues.push(issue('primaryRequiredLandmarks', 'required'));
  if (!isStringArray(body.stabilizerRequiredLandmarks, { nonEmpty: true })) issues.push(issue('stabilizerRequiredLandmarks', 'required'));
  if (!isStringArray(body.jointNames, { nonEmpty: true })) issues.push(issue('jointNames', 'required'));
  if (!isStringArray(body.phases, { nonEmpty: true })) issues.push(issue('phases', 'required'));
  if (!isStringArray(body.qualities, { nonEmpty: true })) issues.push(issue('qualities', 'required'));
  if (Array.isArray(body.phases) && !sameStringArray(body.phases, TCN_PHASES)) issues.push(issue('phases', 'schema_mismatch'));
  if (Array.isArray(body.qualities) && !sameStringArray(body.qualities, TCN_QUALITIES)) issues.push(issue('qualities', 'schema_mismatch'));
  const schemaFields = validateSchemaMetadata(body, landmarkSchemaId, issues);
  if (body.approved === true) {
    const evaluation = body.evaluation || body.metrics || body.accuracy || null;
    const approval = isPlainObject(evaluation)
      ? evaluateModelApproval({ evaluation })
      : (body.approval || {});
    if (!isPlainObject(approval)) issues.push(issue('approval', 'object_required'));
    if (approval.ok !== true) issues.push(issue('approval', 'failed'));
    if (Array.isArray(approval.issues) && approval.issues.length) issues.push(issue('approval', 'failed'));
  }
  if (issues.length) return validationFail(issues);
  return validationOk({
    ...body,
    id: modelId,
    modelId,
    exerciseId,
    landmarkSchemaId,
    version,
    ...(schemaFields || {}),
    approved: body.approved === true,
  });
}
