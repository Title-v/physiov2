import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoRejectDatasetRow,
  isReviewedTrainableRow,
  reviewDatasetRow,
} from '../../shared/ai/DatasetLabeler.js';
import { createMotionDatasetRecorder } from '../../shared/ai/MotionDatasetRecorder.js';
import { makeBasePose } from '../helpers/pose-fixtures.mjs';

const rightArmExercise = {
  id: 'shoulder_custom',
  bodyRegion: 'right_arm',
  landmarkSchemaId: 'right_arm.v1',
  primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
  stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
  modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
  jointNames: ['right_shoulder', 'right_elbow'],
};

test('reviewDatasetRow is the only path that turns a usable draft row trainable', () => {
  const draft = {
    exerciseId: 'shoulder_custom',
    dataQuality: 'usable',
    labelStatus: 'draft',
    trainable: false,
    landmarkSchemaId: 'right_arm.v1',
    missingPrimary: [],
    missingStabilizer: [],
  };

  assert.equal(isReviewedTrainableRow(draft), false);
  const reviewed = reviewDatasetRow(draft, 'good_rep');
  assert.equal(reviewed.motionLabel, 'good');
  assert.equal(reviewed.labelStatus, 'reviewed');
  assert.equal(reviewed.trainable, true);
  assert.equal(isReviewedTrainableRow(reviewed), true);

  const rejected = autoRejectDatasetRow(reviewed, 'missing_stabilizer_required', {
    missingStabilizer: ['left_shoulder'],
  });
  assert.equal(rejected.trainable, false);
  assert.equal(isReviewedTrainableRow(rejected), false);
});

test('motion dataset recorder stores safety metadata and creates draft rows for review', () => {
  let t = 0;
  const recorder = createMotionDatasetRecorder({
    exercise: rightArmExercise,
    landmarkSchemaId: 'right_arm.v1',
    labelTarget: 'good',
    now: () => {
      t += 100;
      return t;
    },
  });

  recorder.start();
  recorder.pushFrame({
    landmarks: makeBasePose(),
    jointAngles: { right_shoulder: 80, right_elbow: 120 },
    boundary: { status: 'inside' },
    phase: 'moving_to_target',
  });
  const row = recorder.completeRep({ reviewed: false });

  assert.equal(row.exerciseId, 'shoulder_custom');
  assert.equal(row.dataQuality, 'usable');
  assert.equal(row.labelStatus, 'draft');
  assert.equal(row.trainable, false);
  assert.equal(row.landmarkSchemaId, 'right_arm.v1');
  assert.deepEqual(row.primaryRequiredLandmarks, rightArmExercise.primaryRequiredLandmarks);
  assert.equal(row.frames.length, 1);
});

test('motion dataset recorder tolerates brief landmark flicker within threshold', () => {
  const recorder = createMotionDatasetRecorder({
    exercise: rightArmExercise,
    landmarkSchemaId: 'right_arm.v1',
    labelTarget: 'good',
  });

  recorder.start();
  for (let i = 0; i < 10; i += 1) {
    recorder.pushFrame({
      landmarks: makeBasePose(),
      safety: i === 4
        ? {
          dataQuality: 'low_visibility',
          schemaId: 'right_arm.v1',
          missingPrimary: ['right_elbow'],
          missingStabilizer: [],
        }
        : {
          dataQuality: 'usable',
          schemaId: 'right_arm.v1',
          missingPrimary: [],
          missingStabilizer: [],
        },
    });
  }
  const row = recorder.completeRep({ reviewed: true });

  assert.equal(row.dataQuality, 'usable');
  assert.deepEqual(row.missingPrimary, []);
  assert.equal(row.labelStatus, 'reviewed');
  assert.equal(row.trainable, true);
});

test('motion dataset recorder rejects reps when missing stabilizer exceeds threshold', () => {
  const recorder = createMotionDatasetRecorder({
    exercise: rightArmExercise,
    landmarkSchemaId: 'right_arm.v1',
    labelTarget: 'good',
  });

  recorder.start();
  for (let i = 0; i < 10; i += 1) {
    recorder.pushFrame({
      landmarks: makeBasePose(),
      safety: i < 2
        ? {
          dataQuality: 'missing_stabilizer_required',
          schemaId: 'right_arm.v1',
          missingPrimary: [],
          missingStabilizer: ['left_shoulder'],
        }
        : {
          dataQuality: 'usable',
          schemaId: 'right_arm.v1',
          missingPrimary: [],
          missingStabilizer: [],
        },
    });
  }
  const row = recorder.completeRep({ reviewed: true });

  assert.equal(row.dataQuality, 'missing_stabilizer_required');
  assert.deepEqual(row.missingStabilizer, ['left_shoulder']);
  assert.equal(row.labelStatus, 'auto_rejected');
  assert.equal(row.motionLabel, null);
  assert.equal(row.trainable, false);
});
