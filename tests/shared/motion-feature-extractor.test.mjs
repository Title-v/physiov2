import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANDMARK_COUNT,
  extractMotionFeatures,
  extractMotionFeatureWindow,
  featureVectorsFromWindow,
} from '../../shared/ai/MotionFeatureExtractor.js';

test('extractMotionFeatures builds a stable vector from landmarks angles and flags', () => {
  const features = extractMotionFeatures({
    t: 100,
    landmarks: [
      { x: 0.1, y: 0.2, z: 0.3, visibility: 0.9 },
      { x: 0.4, y: 0.5, z: 0.6, visibility: 0.8 },
    ],
    jointAngles: { right_shoulder: 45, left_shoulder: 30 },
    progressPct: 55,
    boundaryStatus: 'inside',
  }, {
    joints: ['right_shoulder', 'left_shoulder'],
  });

  assert.equal(features.landmarks.length, DEFAULT_LANDMARK_COUNT);
  assert.deepEqual(features.joints, ['left_shoulder', 'right_shoulder']);
  assert.equal(features.angles.right_shoulder, 45);
  assert.equal(features.insideFrame, true);
  assert.equal(features.progress, 55);
  assert.equal(features.featureVector.length, DEFAULT_LANDMARK_COUNT * 4 + 2 + 2 + 3);
  assert.equal(features.featureVector.at(-3), 55);
  assert.equal(features.featureVector.at(-2), 1);
  assert.equal(features.featureVector.at(-1), features.visibilityScore / 100);
});

test('extractMotionFeatureWindow computes angle velocity from previous frame timestamps', () => {
  const window = extractMotionFeatureWindow([
    { t: 0, jointAngles: { right_knee: 20 }, landmarks: [] },
    { t: 100, jointAngles: { right_knee: 35 }, landmarks: [] },
  ], {
    joints: ['right_knee'],
    landmarkCount: 1,
  });

  assert.equal(window[0].angleVelocity.right_knee, 0);
  assert.equal(window[1].angleVelocity.right_knee, 150);
});

test('featureVectorsFromWindow returns vectors only for classifier input', () => {
  const vectors = featureVectorsFromWindow([
    { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { elbow: 10 } },
    { t: 100, landmarks: [[0.2, 0.2, 0, 0.9]], angles: { elbow: 20 } },
  ], {
    joints: ['elbow'],
    landmarkCount: 1,
  });

  assert.equal(vectors.length, 2);
  assert.deepEqual(vectors[0].slice(0, 4), [0.1, 0.2, 0, 0.9]);
  assert.equal(vectors[1].length, 1 * 4 + 1 + 1 + 3);
});
