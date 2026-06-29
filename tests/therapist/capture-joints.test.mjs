import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROM_REGION_JOINTS,
  activeOverlayJoints,
  bodyRegionFlag,
  candidateRepJointsForExercise,
  cleanAngles,
  cleanLandmarks,
  referenceExerciseForCapture,
  toleranceOverride,
} from '../../src/app/therapist/capture/captureJoints.js';

test('bodyRegionFlag exposes region joints for boundary and scoring', () => {
  const flag = bodyRegionFlag('right_arm');

  assert.equal(flag.id, 'right_arm');
  assert.equal(flag.primaryJoint, 'right_shoulder');
  assert.deepEqual(flag.joints, ['right_shoulder', 'right_elbow']);
  assert.equal(flag.usedForBoundary, true);
  assert.equal(flag.usedForRepScoring, true);
});

test('activeOverlayJoints prefers selected valid joints and falls back to exercise/reference primary joint', () => {
  assert.deepEqual(activeOverlayJoints({
    selectedJoints: ['right_shoulder', 'not_real', 'right_shoulder'],
    exercise: { primaryJoint: 'left_knee' },
  }), ['right_shoulder']);

  assert.deepEqual(activeOverlayJoints({
    selectedJoints: [],
    reference: { dominantJoint: 'left_hip' },
    exercise: { primaryJoint: 'right_knee' },
  }), ['left_hip']);
});

test('candidateRepJointsForExercise honors explicit region before overlay/fallback joints', () => {
  const exercise = {
    bodyRegion: 'right_arm',
    repJoints: ['right_shoulder'],
    primaryJoint: 'right_shoulder',
  };

  assert.deepEqual(candidateRepJointsForExercise(exercise, {
    bodyRegion: 'lower',
    overlayJoints: ['right_shoulder'],
  }), ROM_REGION_JOINTS.lower);

  assert.deepEqual(candidateRepJointsForExercise(exercise, {
    overlayJoints: ['left_elbow'],
  }), ['left_elbow']);
});

test('referenceExerciseForCapture stamps capture region and preferred rep joints', () => {
  const out = referenceExerciseForCapture({ id: 'custom', bodyRegion: 'full' }, {
    bodyRegion: 'left_leg',
    overlayJoints: ['right_shoulder'],
  });

  assert.equal(out.bodyRegion, 'left_leg');
  assert.deepEqual(out.preferredRepJoints, ['left_hip', 'left_knee']);
});

test('clean frame helpers keep persisted landmark and angle payloads compact', () => {
  assert.deepEqual(cleanLandmarks([{ x: 1, y: 2, z: 3, visibility: 0.8, extra: 'drop' }]), [
    { x: 1, y: 2, z: 3, visibility: 0.8 },
  ]);
  assert.deepEqual(cleanAngles({ right_shoulder: 90.04, right_elbow: 45.16, unknown: 12 }), {
    right_shoulder: 90,
    right_elbow: 45.2,
  });
});

test('toleranceOverride prefers reference joint motion, then plan, then exercise default', () => {
  const tol = toleranceOverride(
    { primaryJoint: 'right_shoulder', tol: 20 },
    { repJoints: ['right_shoulder', 'right_elbow'], jointMotion: { right_elbow: { tol: 9 } } },
    { tol: 12 },
  );

  assert.deepEqual(tol, {
    right_shoulder: 12,
    right_elbow: 9,
  });
});
