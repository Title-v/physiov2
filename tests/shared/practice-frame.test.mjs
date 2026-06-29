import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionQualityEngine, REFERENCE_KINDS } from '../../shared/ai/MotionQualityEngine.js';
import { createPracticeFrameProcessor, ghostLandmarksForSnapshot } from '../../shared/practice/frame.js';
import { makeElbowPose } from '../helpers/pose-fixtures.mjs';

const inside = { status: 'inside' };

function elbowExercise() {
  return {
    id: 'elbow',
    type: 'rep',
    primaryJoint: 'left_elbow',
    bodyRegion: 'left_arm',
    repJoints: ['left_elbow'],
    reps: 1,
    sets: 1,
  };
}

function elbowReference() {
  return {
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    repJoints: ['left_elbow'],
    scoringJoints: ['left_elbow'],
    primaryJoint: 'left_elbow',
    restJointAngles: { left_elbow: 30 },
    targetJointAngles: { left_elbow: 110 },
    jointAngles: { left_elbow: 110 },
    jointMotion: {
      left_elbow: { rest: 30, target: 110, range: 80, tol: 12, weight: 1, contributesToProgress: true },
    },
    referenceSequence: {
      durationMs: 1200,
      frames: [
        { p: 0, angles: { left_elbow: 30 } },
        { p: 0.5, angles: { left_elbow: 70 } },
        { p: 1, angles: { left_elbow: 110 } },
      ],
    },
  };
}

test('no-pose frame returns boundary result without pushing a snapshot', () => {
  const processor = createPracticeFrameProcessor({
    exercise: elbowExercise(),
    reference: elbowReference(),
    motionEngine: createMotionQualityEngine({ exercise: elbowExercise(), reference: elbowReference() }),
    timestampNow: () => 100,
  });
  const result = processor.processPracticeFrame({ landmarks: null });
  assert.equal(result.hasPose, false);
  assert.equal(result.boundary.status, 'outside');
  assert.equal(result.snapshot, null);
  assert.deepEqual(result.overlayJoints, ['left_elbow']);
});

test('live landmarks produce boundary, angles, snapshot, and overlay joints', () => {
  const exercise = elbowExercise();
  const reference = elbowReference();
  const engine = createMotionQualityEngine({
    exercise,
    reference,
    thresholds: { holdTargetMs: 20, holdRestMs: 20, minRepMs: 200 },
  });
  const processor = createPracticeFrameProcessor({ exercise, reference, motionEngine: engine });
  const result = processor.processPracticeFrame({
    landmarks: makeElbowPose(80),
    boundary: inside,
    timestamp: 0,
  });
  assert.equal(result.hasPose, true);
  assert.equal(result.boundary.status, 'inside');
  assert.equal(Number.isFinite(result.liveAngles.left_elbow), true);
  assert.equal(result.snapshot.hasPose, true);
  assert.deepEqual(result.overlayJoints, ['left_elbow']);
});

test('motion frame sequence through shared processor counts a rep', () => {
  const exercise = elbowExercise();
  const reference = elbowReference();
  const engine = createMotionQualityEngine({
    exercise,
    reference,
    dose: { reps: 1, sets: 1 },
    thresholds: { holdTargetMs: 40, holdRestMs: 40, minRepMs: 200 },
  });
  const processor = createPracticeFrameProcessor({ exercise, reference, motionEngine: engine });
  let result = null;
  [
    [0, 30],
    [120, 30],
    [300, 65],
    [520, 110],
    [660, 110],
    [900, 70],
    [1180, 30],
    [1320, 30],
  ].forEach(([timestamp, angle]) => {
    result = processor.processPracticeFrame({
      landmarks: makeElbowPose(angle),
      liveAngles: { left_elbow: angle },
      boundary: inside,
      timestamp,
    });
  });
  assert.equal(result.snapshot.reps, 1);
  assert.equal(engine.finishSummary().validReps, 1);
});

test('hold reference produces hold snapshot through shared processor', () => {
  const exercise = { id: 'balance', type: 'hold', primaryJoint: 'right_knee', holdSec: 1 };
  const reference = {
    kind: REFERENCE_KINDS.HOLD_POSE,
    scoringJoints: ['right_knee'],
    holdTargetAngles: { right_knee: 70 },
    jointMotion: { right_knee: { tol: 18 } },
  };
  const engine = createMotionQualityEngine({ exercise, reference, dose: { holdSec: 1 } });
  const processor = createPracticeFrameProcessor({ exercise, reference, motionEngine: engine });
  const result = processor.processPracticeFrame({
    landmarks: makeElbowPose(90),
    liveAngles: { right_knee: 70 },
    boundary: inside,
    timestamp: 500,
  });
  assert.equal(result.snapshot.kind, REFERENCE_KINDS.HOLD_POSE);
  assert.equal(result.snapshot.phase, 'holding');
  assert.equal(Number.isFinite(result.snapshot.overallScore), true);
});

test('ghost landmarks follow active side when present', () => {
  const leftGhost = [{ x: 0.1, y: 0.2 }];
  const rightGhost = [{ x: 0.8, y: 0.2 }];
  const reference = {
    targetLandmarksBySide: {
      left: leftGhost,
      right: rightGhost,
    },
    targetLandmarks: [{ x: 0.5, y: 0.5 }],
  };
  assert.equal(ghostLandmarksForSnapshot(reference, { activeSide: 'left' }), leftGhost);
  assert.equal(ghostLandmarksForSnapshot(reference, { activeSide: 'right' }), rightGhost);
});
