import { MOTION_LABELS_V1 } from './DatasetLabeler.js';

export const RECOMMENDED_DATASET_MINIMUMS = Object.freeze({
  good: 50,
  incomplete: 30,
  wrong_path: 30,
  unstable: 30,
  subjects: 5,
});

export const RECOMMENDED_MODEL_APPROVAL_CRITERIA = Object.freeze({
  phaseAccuracy: 0.85,
  qualityAccuracy: 0.80,
  perLabelRecall: 0.70,
});

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

export function evaluateDatasetReadiness(rows = [], {
  minimums = RECOMMENDED_DATASET_MINIMUMS,
} = {}) {
  const trainable = (rows || []).filter((row) => row?.trainable === true && row?.labelStatus === 'reviewed' && row?.dataQuality === 'usable');
  const byLabel = countBy(trainable, (row) => row.motionLabel || row.label);
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
  const issues = [];
  if (!Number.isFinite(phaseAccuracy) || phaseAccuracy < criteria.phaseAccuracy) issues.push('phase_accuracy_below_threshold');
  if (!Number.isFinite(qualityAccuracy) || qualityAccuracy < criteria.qualityAccuracy) issues.push('quality_accuracy_below_threshold');
  for (const label of MOTION_LABELS_V1) {
    const recall = Number(perLabelRecall[label]);
    if (!Number.isFinite(recall) || recall < criteria.perLabelRecall) issues.push(`recall_${label}_below_threshold`);
  }
  return {
    ok: issues.length === 0,
    issues,
    criteria: { ...criteria },
    metrics: {
      phaseAccuracy: Number.isFinite(phaseAccuracy) ? phaseAccuracy : null,
      qualityAccuracy: Number.isFinite(qualityAccuracy) ? qualityAccuracy : null,
      perLabelRecall: { ...perLabelRecall },
    },
  };
}
