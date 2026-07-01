import { MOTION_LABELS_V1, normalizeMotionLabel } from './DatasetLabeler.js';
import { modelManifestSchemaFields, resolveBodyRegionLandmarkSchema } from './BodyRegionLandmarkSchema.js';

export const RECOMMENDED_DATASET_MINIMUMS = Object.freeze({
  good: 50,
  incomplete: 30,
  wrong_path: 30,
  unstable: 30,
  subjects: 5,
});

export const RECOMMENDED_MODEL_APPROVAL_CRITERIA = Object.freeze({
  phaseAccuracy: 0.90,
  qualityAccuracy: 0.85,
  perLabelRecall: 0.75,
  falseGoodRate: 0.05,
});

const BAD_MOTION_LABELS_FOR_FALSE_GOOD = Object.freeze(['incomplete', 'wrong_path', 'unstable']);

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function sameStringArray(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

export function falseGoodRateFromConfusionMatrix(matrix = {}) {
  let badTotal = 0;
  let badPredictedGood = 0;
  for (const label of BAD_MOTION_LABELS_FOR_FALSE_GOOD) {
    const row = matrix?.[label] || {};
    const rowTotal = Object.values(row).reduce((sum, value) => sum + (Number(value) || 0), 0);
    badTotal += rowTotal;
    badPredictedGood += Number(row.good) || 0;
  }
  return badTotal ? badPredictedGood / badTotal : 0;
}

function rowSchemaIssues(row = {}) {
  const issues = [];
  const schemaId = row.landmarkSchemaId || row.metadata?.landmarkSchemaId || null;
  if (!schemaId) return ['missing_landmarkSchemaId'];
  const schema = resolveBodyRegionLandmarkSchema(schemaId, { fallback: false });
  if (!schema) return ['unknown_landmarkSchemaId'];
  const schemaFields = modelManifestSchemaFields(schema);
  for (const key of ['modelInputLandmarks', 'primaryRequiredLandmarks', 'stabilizerRequiredLandmarks', 'jointNames']) {
    const value = row[key] || row.metadata?.[key] || [];
    if (!Array.isArray(value) || !value.length) issues.push(`missing_${key}`);
    else if (!sameStringArray(value, schemaFields[key])) issues.push(`${key}_schema_mismatch`);
  }
  return issues;
}

export function datasetRowReadinessIssues(row = {}) {
  const issues = [];
  const label = normalizeMotionLabel(row.motionLabel || row.label);
  if (!label) issues.push('invalid_or_unlabeled_motion_label');
  if (row.labelStatus !== 'reviewed') issues.push('labelStatus_not_reviewed');
  if (row.trainable !== true) issues.push('trainable_not_true');
  if (row.repComplete !== true) issues.push('repComplete_true_required');
  if (row.dataQuality !== 'usable') issues.push(`dataQuality_${row.dataQuality || 'missing'}`);
  if (row.missingPrimary?.length) issues.push('missing_primary_required');
  if (row.missingStabilizer?.length) issues.push('missing_stabilizer_required');
  issues.push(...rowSchemaIssues(row));
  return issues;
}

export function evaluateDatasetReadiness(rows = [], {
  minimums = RECOMMENDED_DATASET_MINIMUMS,
} = {}) {
  const assessedRows = (rows || []).map((row, index) => ({
    row,
    index,
    issues: datasetRowReadinessIssues(row),
    motionLabel: normalizeMotionLabel(row?.motionLabel || row?.label),
  }));
  const trainable = assessedRows.filter((item) => !item.issues.length).map((item) => item.row);
  const invalidRows = assessedRows
    .filter((item) => item.issues.length && (item.row?.trainable === true || item.row?.labelStatus === 'reviewed'))
    .map((item) => ({
      index: item.index,
      exerciseId: item.row?.exerciseId || 'unknown',
      issues: item.issues,
    }));
  const byLabel = countBy(assessedRows.filter((item) => !item.issues.length), (item) => item.motionLabel);
  const subjects = new Set(trainable.map((row) => row.subjectId || row.metadata?.subjectId).filter(Boolean));
  const missingLabels = MOTION_LABELS_V1
    .map((label) => ({
      label,
      actual: byLabel[label] || 0,
      required: minimums[label] || 0,
    }))
    .filter((item) => item.actual < item.required);
  const missingSubjects = Math.max(0, (minimums.subjects || 0) - subjects.size);
  return {
    ok: !missingLabels.length && missingSubjects === 0,
    trainableRows: trainable.length,
    invalidRows,
    byLabel,
    subjects: subjects.size,
    missingLabels,
    missingSubjects,
    minimums: { ...minimums },
  };
}

export function evaluateModelApproval({
  evaluation = {},
  criteria = RECOMMENDED_MODEL_APPROVAL_CRITERIA,
} = {}) {
  const phaseAccuracy = Number(evaluation.phaseAccuracy ?? evaluation.phase_accuracy ?? evaluation.metrics?.phase_accuracy);
  const qualityAccuracy = Number(evaluation.qualityAccuracy ?? evaluation.quality_accuracy ?? evaluation.metrics?.quality_accuracy);
  const perLabelRecall = evaluation.perLabelRecall || evaluation.per_label_recall || evaluation.metrics?.perLabelRecall || {};
  const qualityConfusionMatrix = evaluation.qualityConfusionMatrix || evaluation.quality_confusion_matrix || evaluation.confusionMatrix || evaluation.metrics?.qualityConfusionMatrix || null;
  const falseGoodRate = Number(evaluation.falseGoodRate ?? evaluation.false_good_rate ?? evaluation.metrics?.falseGoodRate ??
    (qualityConfusionMatrix ? falseGoodRateFromConfusionMatrix(qualityConfusionMatrix) : NaN));
  const issues = [];
  if (!Number.isFinite(phaseAccuracy) || phaseAccuracy < criteria.phaseAccuracy) issues.push('phase_accuracy_below_threshold');
  if (!Number.isFinite(qualityAccuracy) || qualityAccuracy < criteria.qualityAccuracy) issues.push('quality_accuracy_below_threshold');
  for (const label of MOTION_LABELS_V1) {
    const recall = Number(perLabelRecall[label]);
    if (!Number.isFinite(recall) || recall < criteria.perLabelRecall) issues.push(`recall_${label}_below_threshold`);
  }
  if (!Number.isFinite(falseGoodRate) || falseGoodRate > criteria.falseGoodRate) issues.push('false_good_rate_above_threshold');
  return {
    ok: issues.length === 0,
    issues,
    criteria: { ...criteria },
    metrics: {
      phaseAccuracy: Number.isFinite(phaseAccuracy) ? phaseAccuracy : null,
      qualityAccuracy: Number.isFinite(qualityAccuracy) ? qualityAccuracy : null,
      perLabelRecall: { ...perLabelRecall },
      falseGoodRate: Number.isFinite(falseGoodRate) ? falseGoodRate : null,
    },
  };
}
