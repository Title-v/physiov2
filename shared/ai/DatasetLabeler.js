export const MOTION_LABELS_V1 = Object.freeze(['good', 'incomplete', 'wrong_path', 'unstable']);
export const DATA_QUALITY_LABELS = Object.freeze([
  'usable',
  'no_pose',
  'out_of_frame',
  'low_visibility',
  'missing_primary_required',
  'missing_stabilizer_required',
  'missing_schema',
]);
export const LABEL_STATUSES = Object.freeze({
  DRAFT: 'draft',
  REVIEWED: 'reviewed',
  AUTO_REJECTED: 'auto_rejected',
  SKIPPED: 'skipped',
});

const MOTION_LABEL_ALIASES = Object.freeze({
  good_rep: 'good',
  bad_rep: 'incomplete',
  incomplete_target: 'incomplete',
  wrong_trajectory: 'wrong_path',
});

export function normalizeMotionLabel(value) {
  const normalized = MOTION_LABEL_ALIASES[value] || value;
  return MOTION_LABELS_V1.includes(normalized) ? normalized : null;
}

export function isReviewedTrainableRow(row = {}) {
  return row.trainable === true &&
    row.repComplete === true &&
    row.dataQuality === 'usable' &&
    row.labelStatus === LABEL_STATUSES.REVIEWED &&
    !!normalizeMotionLabel(row.motionLabel || row.label) &&
    !!row.landmarkSchemaId &&
    !row.missingPrimary?.length &&
    !row.missingStabilizer?.length;
}

export function reviewDatasetRow(row = {}, motionLabel) {
  const normalized = normalizeMotionLabel(motionLabel);
  if (!normalized) {
    const err = new Error(`Invalid motion label: ${motionLabel}`);
    err.code = 'invalid_motion_label';
    throw err;
  }
  const dataQuality = row.dataQuality || 'usable';
  const trainable = dataQuality === 'usable' &&
    row.repComplete === true &&
    !!row.landmarkSchemaId &&
    !row.missingPrimary?.length &&
    !row.missingStabilizer?.length;
  return {
    ...row,
    motionLabel: normalized,
    label: normalized,
    labelStatus: LABEL_STATUSES.REVIEWED,
    trainable,
    scoreable: trainable,
  };
}

export function autoRejectDatasetRow(row = {}, dataQuality, details = {}) {
  const quality = DATA_QUALITY_LABELS.includes(dataQuality) ? dataQuality : 'missing_schema';
  return {
    ...row,
    ...details,
    dataQuality: quality,
    labelStatus: LABEL_STATUSES.AUTO_REJECTED,
    trainable: false,
    scoreable: false,
  };
}
