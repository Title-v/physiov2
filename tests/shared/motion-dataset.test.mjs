import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_DATASET_SCHEMA_VERSION,
  buildMotionDatasetRow,
  buildMotionDatasetRowFromSkeletonPayload,
  landmarkToTuple,
  motionDatasetRowToJsonl,
  parseMotionDatasetJsonl,
} from '../../shared/ai/MotionDataset.js';

test('landmarkToTuple normalizes objects and arrays to x/y/z/visibility tuples', () => {
  assert.deepEqual(landmarkToTuple({ x: 0.1, y: 0.2, z: 0.3, visibility: 0.9 }), [0.1, 0.2, 0.3, 0.9]);
  assert.deepEqual(landmarkToTuple([0.4, 0.5, 0.6, 0.7]), [0.4, 0.5, 0.6, 0.7]);
  assert.deepEqual(landmarkToTuple({ x: 'bad', y: 0.2 }), [0, 0.2, 0, 0]);
});

test('buildMotionDatasetRow creates JSONL-ready normalized frame rows', () => {
  const row = buildMotionDatasetRow({
    exerciseId: 'shoulder',
    label: 'good_rep',
    frames: [
      {
        tMs: 100,
        phase: 'rest',
        landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.99 }],
        jointAngles: { right_shoulder: 30, bad: null },
        boundary: { status: 'inside' },
      },
      {
        tMs: 180,
        phase: 'target',
        landmarks: [[0.2, 0.3, 0.1, 0.88]],
        angles: { right_shoulder: 75 },
        boundaryStatus: 'inside',
      },
    ],
  });

  assert.equal(row.version, MOTION_DATASET_SCHEMA_VERSION);
  assert.equal(row.exerciseId, 'shoulder');
  assert.equal(row.label, 'good_rep');
  assert.equal(row.motionLabel, null);
  assert.equal(row.labelStatus, 'draft');
  assert.equal(row.trainable, false);
  assert.deepEqual(row.phaseLabels, ['rest', 'target']);
  assert.equal(row.frames[0].t, 0);
  assert.equal(row.frames[1].t, 80);
  assert.deepEqual(row.frames[0].landmarks[0], [0.1, 0.2, 0, 0.99]);
  assert.deepEqual(row.frames[0].angles, { right_shoulder: 30 });
  assert.equal(row.frames[0].boundaryStatus, 'inside');
});

test('buildMotionDatasetRowFromSkeletonPayload maps therapist skeleton export to dataset schema', () => {
  const payload = {
    schema: 'physioai.skeleton_clip.v1',
    exportedAt: '2026-01-01T00:00:00.000Z',
    exercise: {
      id: 'knee',
      bodyRegion: 'right_leg',
      movementPattern: 'unilateral',
      selectedOverlayJoints: ['right_knee'],
      selectedRepJoints: ['right_knee'],
    },
    clip: { selectedFrameCount: 1 },
    frames: [{
      tMs: 25,
      phase: 'target',
      landmarks: [{ x: 0.5, y: 0.6, z: 0.1, visibility: 0.75 }],
      jointAngles: { right_knee: 95 },
    }],
  };

  const row = buildMotionDatasetRowFromSkeletonPayload(payload, {
    label: 'good_rep',
    motionLabel: 'good',
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    scoreable: true,
    landmarkSchemaId: 'right_leg.v1',
    primaryRequiredLandmarks: ['right_hip', 'right_knee', 'right_ankle'],
    stabilizerRequiredLandmarks: ['left_hip', 'right_shoulder'],
    modelInputLandmarks: ['right_hip', 'right_knee', 'right_ankle', 'left_hip', 'right_shoulder'],
    jointNames: ['right_hip', 'right_knee'],
    subjectId: 'anon_007',
  });

  assert.equal(row.exerciseId, 'knee');
  assert.equal(row.subjectId, 'anon_007');
  assert.equal(row.motionLabel, 'good');
  assert.equal(row.labelStatus, 'reviewed');
  assert.equal(row.trainable, true);
  assert.equal(row.landmarkSchemaId, 'right_leg.v1');
  assert.deepEqual(row.stabilizerRequiredLandmarks, ['left_hip', 'right_shoulder']);
  assert.equal(row.metadata.schema, 'physioai.skeleton_clip.v1');
  assert.deepEqual(row.metadata.selectedRepJoints, ['right_knee']);
  assert.deepEqual(row.frames[0].angles, { right_knee: 95 });
});

test('motion dataset JSONL serializes and parses rows without wrapping array state', () => {
  const row = buildMotionDatasetRow({ exerciseId: 'neck', frames: [] });
  const jsonl = motionDatasetRowToJsonl(row);
  const parsed = parseMotionDatasetJsonl(jsonl);

  assert.match(jsonl, /\n$/);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], row);
});
