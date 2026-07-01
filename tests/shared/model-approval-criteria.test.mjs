import test from 'node:test';
import assert from 'node:assert/strict';
import {
  datasetRowReadinessIssues,
  evaluateDatasetReadiness,
  evaluateModelApproval,
  RECOMMENDED_DATASET_MINIMUMS,
  falseGoodRateFromConfusionMatrix,
} from '../../shared/ai/ModelApprovalCriteria.js';

function row(label, subjectId = 's1') {
  return {
    exerciseId: 'shoulder',
    motionLabel: label,
    label,
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    repComplete: true,
    completionSource: 'rule_completed_rep',
    subjectId,
    landmarkSchemaId: 'right_arm.v1',
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    missingPrimary: [],
    missingStabilizer: [],
  };
}

test('evaluateDatasetReadiness enforces recommended per-label and subject minimums', () => {
  const notReady = evaluateDatasetReadiness([row('good')]);
  assert.equal(notReady.ok, false);
  assert.equal(notReady.missingSubjects, RECOMMENDED_DATASET_MINIMUMS.subjects - 1);
  assert.equal(notReady.missingLabels.some((item) => item.label === 'wrong_path'), true);

  const rows = [];
  for (const [label, count] of Object.entries(RECOMMENDED_DATASET_MINIMUMS)) {
    if (label === 'subjects') continue;
    for (let i = 0; i < count; i += 1) rows.push(row(label, `s${(i % RECOMMENDED_DATASET_MINIMUMS.subjects) + 1}`));
  }
  const ready = evaluateDatasetReadiness(rows);
  assert.equal(ready.ok, true);
  assert.equal(ready.subjects, RECOMMENDED_DATASET_MINIMUMS.subjects);
});

test('dataset readiness counts only rows that are truly trainable by v3 rules', () => {
  const badLabel = row('out_of_frame');
  const missingSchema = { ...row('good'), landmarkSchemaId: null };
  const mismatchedInput = {
    ...row('good'),
    modelInputLandmarks: ['right_elbow', 'right_shoulder', 'right_wrist', 'left_shoulder', 'right_hip'],
  };
  const missingStabilizer = { ...row('good'), missingStabilizer: ['left_shoulder'] };
  const partialRep = { ...row('good'), repComplete: false, completionSource: 'manual_stop' };

  assert.equal(datasetRowReadinessIssues(badLabel).includes('invalid_or_unlabeled_motion_label'), true);
  assert.equal(datasetRowReadinessIssues(missingSchema).includes('missing_landmarkSchemaId'), true);
  assert.equal(datasetRowReadinessIssues(mismatchedInput).includes('modelInputLandmarks_schema_mismatch'), true);
  assert.equal(datasetRowReadinessIssues(missingStabilizer).includes('missing_stabilizer_required'), true);
  assert.equal(datasetRowReadinessIssues(partialRep).includes('repComplete_true_required'), true);

  const readiness = evaluateDatasetReadiness([
    badLabel,
    missingSchema,
    mismatchedInput,
    missingStabilizer,
    partialRep,
    row('good'),
  ], {
    minimums: { good: 2, incomplete: 0, wrong_path: 0, unstable: 0, subjects: 1 },
  });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.trainableRows, 1);
  assert.equal(readiness.byLabel.good, 1);
  assert.equal(readiness.invalidRows.length, 5);
});

test('evaluateModelApproval enforces phase quality and per-label recall criteria', () => {
  const bad = evaluateModelApproval({
    evaluation: {
      phaseAccuracy: 0.9,
      qualityAccuracy: 0.79,
      perLabelRecall: { good: 0.9 },
      falseGoodRate: 0.01,
    },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.issues.includes('quality_accuracy_below_threshold'), true);
  assert.equal(bad.issues.includes('recall_wrong_path_below_threshold'), true);

  const good = evaluateModelApproval({
    evaluation: {
      phaseAccuracy: 0.9,
      qualityAccuracy: 0.85,
      perLabelRecall: {
        good: 0.8,
        incomplete: 0.75,
        wrong_path: 0.75,
        unstable: 0.75,
      },
      falseGoodRate: 0.05,
    },
  });
  assert.equal(good.ok, true);
});

test('false good rate is computed from bad labels predicted as good', () => {
  const matrix = {
    good: { good: 40, incomplete: 1, wrong_path: 0, unstable: 0 },
    incomplete: { good: 1, incomplete: 20, wrong_path: 0, unstable: 0 },
    wrong_path: { good: 2, incomplete: 0, wrong_path: 20, unstable: 0 },
    unstable: { good: 0, incomplete: 0, wrong_path: 0, unstable: 20 },
  };
  assert.equal(falseGoodRateFromConfusionMatrix(matrix), 3 / 63);

  const rejected = evaluateModelApproval({
    evaluation: {
      phaseAccuracy: 0.95,
      qualityAccuracy: 0.9,
      perLabelRecall: { good: 0.9, incomplete: 0.9, wrong_path: 0.9, unstable: 0.9 },
      qualityConfusionMatrix: {
        incomplete: { good: 4, incomplete: 10 },
        wrong_path: { good: 0, wrong_path: 10 },
        unstable: { good: 0, unstable: 10 },
      },
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.issues.includes('false_good_rate_above_threshold'), true);
});
