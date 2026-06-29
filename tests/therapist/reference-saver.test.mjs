import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHoldPoseReference,
  buildMotionCycleReference,
  buildSequenceMotionReference,
  inferTargetIndexForJoints,
  movementMagnitude,
  motionReferenceSuccessText,
  persistCaptureReference,
  prepareReferenceForSave,
  saveHoldReferenceForCapture,
  saveSequenceReferenceForCapture,
  sideCandidateJointsForAlternating,
} from '../../src/app/therapist/capture/referenceSaver.js';
import { CURRENT_REFERENCE_VERSION } from '../../shared/ai/ReferenceSchema.js';
import { REFERENCE_KINDS } from '../../shared/ai/MotionQualityEngine.js';

function validMotionReference() {
  return {
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    exerciseId: 'shoulder',
    bodyRegion: 'right_arm',
    movementPattern: 'unilateral',
    repJoints: ['right_shoulder'],
    scoringJoints: ['right_shoulder'],
    jointMotion: {
      right_shoulder: { rest: 20, target: 120, range: 100, tol: 12 },
    },
    referenceSequence: {
      cycle: 'rest-target-rest',
      sampleCount: 8,
      frames: Array.from({ length: 8 }, (_, index) => ({
        p: index / 7,
        t: index * 100,
        angles: { right_shoulder: index <= 3 ? 20 + index * 25 : 120 - (index - 3) * 25 },
      })),
    },
  };
}

function boundary() {
  return { status: 'inside', willExit: false, boundaryBoxRatio: 0.72 };
}

function sequenceFrame(t, jointAngles) {
  return {
    t,
    jointAngles,
    landmarks: [{ x: t / 1000, y: 0.2, z: 0, visibility: 0.99 }],
  };
}

test('prepareReferenceForSave validates and upgrades a therapist reference', () => {
  const prepared = prepareReferenceForSave(validMotionReference(), { id: 'shoulder', type: 'rep' });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.reference.referenceVersion, CURRENT_REFERENCE_VERSION);
  assert.equal(prepared.validation.quality.frameCount, 8);
});

test('buildHoldPoseReference creates hold reference payload with scoring joints and plan', () => {
  const ref = buildHoldPoseReference({
    exercise: { id: 'balance', type: 'hold', tol: 10, holdSec: 6, rest: 15, dir: 'up' },
    updatedExercise: { id: 'balance', type: 'hold', tol: 12, holdSec: 8, rest: 15, dir: 'up', countMode: 'duration' },
    exerciseId: 'balance',
    variant: 'full',
    captureRegion: 'lower',
    primaryJoint: 'left_knee',
    scoringJoints: ['left_knee'],
    jointAngles: { left_knee: 92 },
    landmarks: [{ x: 0.1, y: 0.2, visibility: 0.99 }],
    boundary: boundary(),
    tol: 14,
  });

  assert.equal(ref.kind, REFERENCE_KINDS.HOLD_POSE);
  assert.equal(ref.exerciseId, 'balance');
  assert.equal(ref.holdMinDurationMs, 8000);
  assert.deepEqual(ref.scoringJoints, ['left_knee']);
  assert.equal(ref.jointMotion.left_knee.tol, 14);
  assert.equal(ref.plan.targetAngle, 92);
  assert.equal(ref.boundaryBoxRatio, 0.72);
});

test('buildMotionCycleReference creates motion reference payload from built sequence motion', () => {
  const exercise = { id: 'shoulder', type: 'rep', bodyRegion: 'right_arm', movementPattern: 'unilateral', tol: 15 };
  const frames = [
    sequenceFrame(0, { right_shoulder: 20 }),
    sequenceFrame(100, { right_shoulder: 80 }),
    sequenceFrame(200, { right_shoulder: 120 }),
    sequenceFrame(300, { right_shoulder: 20 }),
  ];
  const built = buildSequenceMotionReference({
    frames,
    exercise,
    referenceExercise: exercise,
    targetOffset: 2,
    captureRegion: 'right_arm',
    candidateJoints: ['right_shoulder'],
    regionJoints: { right_arm: ['right_shoulder'], full: ['right_shoulder'] },
  });

  const ref = buildMotionCycleReference({
    exercise,
    updatedExercise: exercise,
    exerciseId: 'shoulder',
    variant: 'lite',
    ...built,
    boundary: boundary(),
    tol: 11,
  });

  assert.equal(ref.kind, REFERENCE_KINDS.MOTION_CYCLE);
  assert.equal(ref.exerciseId, 'shoulder');
  assert.equal(ref.bodyRegion, 'right_arm');
  assert.equal(ref.scoringJoints[0], 'right_shoulder');
  assert.equal(ref.referenceSequence.cycle, 'rest-target-rest');
  assert.equal(ref.targetReachThreshold, 0.85);
  assert.equal(ref.plan.tol, 11);
  assert.equal(ref.boundaryBoxRatio, 0.72);
});

test('prepareReferenceForSave rejects incomplete motion references before persistence', () => {
  const prepared = prepareReferenceForSave({
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    exerciseId: 'shoulder',
    repJoints: ['right_shoulder'],
  }, { id: 'shoulder', type: 'rep' });

  assert.equal(prepared.ok, false);
  assert.equal(prepared.reason, 'validation_failed');
  assert.ok(prepared.issues.includes('missing_reference_sequence'));
});

test('persistCaptureReference saves upgraded reference through the injected store function', async () => {
  const calls = [];
  const result = await persistCaptureReference({
    ref: validMotionReference(),
    exercise: { id: 'shoulder', type: 'rep' },
    exerciseId: 'shoulder',
    patientId: 'patient-1',
    saveReference: async (...args) => calls.push(args),
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'shoulder');
  assert.equal(calls[0][1].referenceVersion, CURRENT_REFERENCE_VERSION);
  assert.equal(calls[0][2], 'patient-1');
});

test('persistCaptureReference reports save failure without hiding the upgraded reference', async () => {
  const result = await persistCaptureReference({
    ref: validMotionReference(),
    exercise: { id: 'shoulder', type: 'rep' },
    exerciseId: 'shoulder',
    saveReference: async () => {
      throw new Error('network');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'save_failed');
  assert.equal(result.reference.referenceVersion, CURRENT_REFERENCE_VERSION);
});

test('sequence motion builder helpers infer peak motion from tracked joints', () => {
  const frames = [
    sequenceFrame(0, { right_shoulder: 20 }),
    sequenceFrame(100, { right_shoulder: 50 }),
    sequenceFrame(200, { right_shoulder: 120 }),
    sequenceFrame(300, { right_shoulder: 60 }),
  ];

  assert.equal(movementMagnitude({ right_shoulder: 20 }, { right_shoulder: 80 }, ['right_shoulder']), 60);
  assert.equal(inferTargetIndexForJoints(frames, 1, 2, frames[0].jointAngles, ['right_shoulder']), 2);
});

test('buildSequenceMotionReference creates unilateral rest-target-rest reference payload', () => {
  const exercise = { id: 'shoulder', type: 'rep', bodyRegion: 'right_arm', movementPattern: 'unilateral' };
  const frames = [
    sequenceFrame(0, { right_shoulder: 20 }),
    sequenceFrame(100, { right_shoulder: 70 }),
    sequenceFrame(200, { right_shoulder: 120 }),
    sequenceFrame(300, { right_shoulder: 70 }),
    sequenceFrame(400, { right_shoulder: 20 }),
  ];

  const built = buildSequenceMotionReference({
    frames,
    exercise,
    referenceExercise: exercise,
    targetOffset: 2,
    captureRegion: 'right_arm',
    candidateJoints: ['right_shoulder'],
    regionJoints: { right_arm: ['right_shoulder'], full: ['right_shoulder'] },
  });

  assert.equal(built.ok, true);
  assert.equal(built.source, 'sequence:live-cycle');
  assert.equal(built.referenceSequence.cycle, 'rest-target-rest');
  assert.equal(built.targetIndexes.targetIdx, 2);
  assert.equal(built.motion.dominantJoint, 'right_shoulder');
  assert.equal(built.returnRestAngles.right_shoulder, 20);
});

test('buildSequenceMotionReference creates alternating rest-left-rest-right-rest payload', () => {
  const exercise = {
    id: 'march',
    type: 'rep',
    bodyRegion: 'lower',
    movementPattern: 'alternating',
    alternatingSides: ['left', 'right'],
    countMode: 'cycle',
  };
  const frames = [
    sequenceFrame(0, { left_knee: 20, right_knee: 20 }),
    sequenceFrame(100, { left_knee: 70, right_knee: 20 }),
    sequenceFrame(200, { left_knee: 120, right_knee: 20 }),
    sequenceFrame(300, { left_knee: 60, right_knee: 20 }),
    sequenceFrame(400, { left_knee: 20, right_knee: 20 }),
    sequenceFrame(500, { left_knee: 20, right_knee: 60 }),
    sequenceFrame(600, { left_knee: 20, right_knee: 125 }),
    sequenceFrame(700, { left_knee: 20, right_knee: 20 }),
  ];

  assert.deepEqual(
    sideCandidateJointsForAlternating(exercise, 'lower', 'left', {
      candidateJoints: ['left_knee', 'right_knee'],
      regionJoints: { lower: ['left_knee', 'right_knee'] },
    }),
    ['left_knee'],
  );

  const built = buildSequenceMotionReference({
    frames,
    exercise,
    referenceExercise: exercise,
    captureRegion: 'lower',
    candidateJoints: ['left_knee', 'right_knee'],
    regionJoints: { lower: ['left_knee', 'right_knee'], full: ['left_knee', 'right_knee'] },
  });

  assert.equal(built.ok, true);
  assert.equal(built.source, 'sequence:live-alternating-cycle');
  assert.equal(built.referenceSequence.cycle, 'rest-left-rest-right-rest');
  assert.deepEqual(built.targetIndexes, { leftTargetIdx: 2, rightTargetIdx: 6 });
  assert.equal(built.motion.sideMotions.left.dominantJoint, 'left_knee');
  assert.equal(built.motion.sideMotions.right.dominantJoint, 'right_knee');
});

test('saveHoldReferenceForCapture builds validates persists and updates capture state', async () => {
  const calls = [];
  const exercise = { id: 'balance', source: 'custom', type: 'hold', bodyRegion: 'lower', tol: 10, holdSec: 6 };
  const state = { romBodyRegion: 'lower', plan: { tol: 9 }, reference: null, captureDraft: { dirty: true } };
  const result = await saveHoldReferenceForCapture({
    state,
    exercise,
    exerciseId: 'balance',
    variant: 'lite',
    landmarks: [{ x: 0.4, y: 0.5, z: 0, visibility: 0.99 }],
    jointAngles: { left_knee: 91 },
    boundary: boundary(),
    candidateRepJointsForExercise: () => ['left_knee'],
    cleanLandmarks: (landmarks) => landmarks,
    updateCustomExercise: (_id, patch) => ({ ...exercise, ...patch }),
    saveReference: async (...args) => calls.push(args),
    boundaryBoxRatio: 0.72,
  });

  assert.equal(result.ok, true);
  assert.equal(state.captureDraft, null);
  assert.equal(state.reference.kind, REFERENCE_KINDS.HOLD_POSE);
  assert.equal(state.reference.plan.tol, 9);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'balance');
  assert.equal(calls[0][1].referenceVersion, CURRENT_REFERENCE_VERSION);
});

test('saveHoldReferenceForCapture rejects unusable hold angles before persistence', async () => {
  const calls = [];
  const result = await saveHoldReferenceForCapture({
    state: { romBodyRegion: 'lower', plan: { tol: 9 } },
    exercise: { id: 'balance', type: 'hold', bodyRegion: 'lower', primaryJoint: 'left_knee' },
    exerciseId: 'balance',
    variant: 'lite',
    landmarks: [],
    jointAngles: {},
    boundary: boundary(),
    candidateRepJointsForExercise: () => ['left_knee'],
    cleanLandmarks: (landmarks) => landmarks,
    updateCustomExercise: () => null,
    saveReference: async (...args) => calls.push(args),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_hold_angles');
  assert.equal(calls.length, 0);
});

test('saveSequenceReferenceForCapture builds a full motion reference and success text', async () => {
  const calls = [];
  const exercise = {
    id: 'shoulder',
    type: 'rep',
    bodyRegion: 'right_arm',
    movementPattern: 'unilateral',
    minROMDeg: 15,
    tol: 11,
  };
  const frames = [20, 40, 80, 120, 90, 60, 30, 20]
    .map((angle, index) => sequenceFrame(index * 100, { right_shoulder: angle }));
  const state = { romBodyRegion: 'right_arm', plan: { tol: 11 }, reference: null, captureDraft: { dirty: true } };

  const result = await saveSequenceReferenceForCapture({
    state,
    exercise,
    exerciseId: 'shoulder',
    variant: 'full',
    frames,
    targetOffset: 3,
    regionFlag: { id: 'right_arm' },
    referenceExerciseForCapture: (ex) => ex,
    candidateRepJointsForExercise: () => ['right_shoulder'],
    regionJoints: { right_arm: ['right_shoulder'], full: ['right_shoulder'] },
    updateCustomExercise: (_id, patch) => ({ ...exercise, ...patch }),
    saveReference: async (...args) => calls.push(args),
    boundaryBoxRatio: 0.72,
    lang: 'en',
  });

  assert.equal(result.ok, true);
  assert.match(result.successText, /1 rep joints/);
  assert.equal(state.captureDraft, null);
  assert.equal(state.reference.kind, REFERENCE_KINDS.MOTION_CYCLE);
  assert.equal(state.reference.referenceSequence.cycle, 'rest-target-rest');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].referenceVersion, CURRENT_REFERENCE_VERSION);
});

test('motionReferenceSuccessText includes trajectory frame counts', () => {
  assert.equal(
    motionReferenceSuccessText({
      patientId: null,
      lang: 'th',
      motion: { repJoints: ['right_shoulder', 'right_elbow'] },
      referenceSequence: { sampleCount: 12 },
    }),
    'บันทึกในคลังท่าแล้ว · ใช้ 2 rep joints · trajectory 12 เฟรม',
  );
});
