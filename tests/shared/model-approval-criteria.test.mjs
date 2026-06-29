import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDatasetReadiness,
  evaluateModelApproval,
  RECOMMENDED_DATASET_MINIMUMS,
} from '../../shared/ai/ModelApprovalCriteria.js';

function row(label, subjectId = 's1') {
  return {
    motionLabel: label,
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    subjectId,
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

test('evaluateModelApproval enforces phase quality and per-label recall criteria', () => {
  const bad = evaluateModelApproval({
    evaluation: {
      phaseAccuracy: 0.9,
      qualityAccuracy: 0.79,
      perLabelRecall: { good: 0.9 },
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
        wrong_path: 0.72,
        unstable: 0.71,
      },
    },
  });
  assert.equal(good.ok, true);
});
