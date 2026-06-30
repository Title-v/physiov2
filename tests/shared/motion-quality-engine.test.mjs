import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMotionQualityEngine,
  isUsablePracticeReference,
  REFERENCE_KINDS,
} from '../../shared/ai/MotionQualityEngine.js';

const inside = { status: 'inside' };
const outside = { status: 'outside' };

function aiReadyExercise(exercise) {
  return {
    ...exercise,
    activeModelId: 'motion-tcn',
    modelStatus: 'deployed',
  };
}

function motionReference() {
  return {
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    exerciseId: 'shoulder',
    movementPattern: 'unilateral',
    repJoints: ['right_shoulder'],
    dominantJoint: 'right_shoulder',
    jointMotion: {
      right_shoulder: {
        rest: 20,
        target: 120,
        range: 100,
        tol: 15,
        weight: 1,
        contributesToProgress: true,
      },
    },
    referenceSequence: {
      kind: 'angle-trajectory',
      cycle: 'rest-target-rest',
      durationMs: 1200,
      phases: { restStartMs: 0, targetMs: 600, restEndMs: 1200 },
      repJoints: ['right_shoulder'],
      frames: [
        { t: 0, p: 0, angles: { right_shoulder: 20 } },
        { t: 600, p: 1, angles: { right_shoulder: 120 } },
        { t: 1200, p: 0, angles: { right_shoulder: 20 } },
      ],
    },
  };
}

function nonlinearPathReference() {
  return {
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    exerciseId: 'shoulder_path',
    movementPattern: 'unilateral',
    repJoints: ['right_shoulder', 'right_elbow'],
    scoringJoints: ['right_shoulder', 'right_elbow'],
    dominantJoint: 'right_shoulder',
    restJointAngles: { right_shoulder: 20, right_elbow: 20 },
    targetJointAngles: { right_shoulder: 120, right_elbow: 120 },
    jointMotion: {
      right_shoulder: {
        rest: 20,
        target: 120,
        range: 100,
        tol: 15,
        weight: 1,
        contributesToProgress: true,
      },
      right_elbow: {
        rest: 20,
        target: 120,
        range: 100,
        tol: 15,
        weight: 1,
        contributesToProgress: false,
      },
    },
    referenceSequence: {
      kind: 'angle-trajectory',
      cycle: 'rest-target-rest',
      durationMs: 1200,
      repJoints: ['right_shoulder', 'right_elbow'],
      frames: [
        { t: 0, p: 0, angles: { right_shoulder: 20, right_elbow: 20 } },
        { t: 300, p: 0.5, angles: { right_shoulder: 70, right_elbow: 120 } },
        { t: 600, p: 1, angles: { right_shoulder: 120, right_elbow: 120 } },
        { t: 1200, p: 0, angles: { right_shoulder: 20, right_elbow: 20 } },
      ],
    },
  };
}

function alternatingReference(countMode = 'cycle') {
  const motion = {
    rest: 20,
    target: 120,
    range: 100,
    tol: 15,
    weight: 1,
    contributesToProgress: true,
  };
  return {
    kind: REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE,
    exerciseId: 'march',
    movementPattern: 'alternating',
    alternatingSides: ['left', 'right'],
    countMode,
    repJoints: ['left_knee', 'right_knee'],
    primaryJoints: ['left_knee', 'right_knee'],
    dominantJoint: 'left_knee',
    restJointAngles: { left_knee: 20, right_knee: 20 },
    targetJointAnglesBySide: {
      left: { left_knee: 120, right_knee: 20 },
      right: { left_knee: 20, right_knee: 120 },
    },
    sideMotions: {
      left: {
        repJoints: ['left_knee'],
        primaryJoints: ['left_knee'],
        dominantJoint: 'left_knee',
        targetJointAngles: { left_knee: 120, right_knee: 20 },
        jointMotion: { left_knee: { ...motion } },
      },
      right: {
        repJoints: ['right_knee'],
        primaryJoints: ['right_knee'],
        dominantJoint: 'right_knee',
        targetJointAngles: { left_knee: 20, right_knee: 120 },
        jointMotion: { right_knee: { ...motion } },
      },
    },
    referenceSequence: {
      kind: 'angle-trajectory',
      version: 3,
      cycle: 'rest-left-rest-right-rest',
      durationMs: 1800,
      sampleCount: 5,
      phases: { restStartMs: 0, leftTargetMs: 450, middleRestMs: 900, rightTargetMs: 1350, restEndMs: 1800 },
      repJoints: ['left_knee', 'right_knee'],
      movementPattern: 'alternating',
      frames: [
        { t: 0, p: 0, side: 'rest', angles: { left_knee: 20, right_knee: 20 } },
        { t: 450, p: 1, side: 'left', angles: { left_knee: 120, right_knee: 20 } },
        { t: 900, p: 0, side: 'rest', angles: { left_knee: 20, right_knee: 20 } },
        { t: 1350, p: 1, side: 'right', angles: { left_knee: 20, right_knee: 120 } },
        { t: 1800, p: 0, side: 'rest', angles: { left_knee: 20, right_knee: 20 } },
      ],
    },
  };
}

function pushShoulder(engine, values, { boundary = inside, start = 0, step = 160, angleMeta = null, aiSignal = null } = {}) {
  let snapshot = null;
  values.forEach((angle, index) => {
    snapshot = engine.pushFrame({
      timestamp: start + index * step,
      jointAngles: { right_shoulder: angle },
      angleMeta,
      boundary,
      aiSignal: typeof aiSignal === 'function' ? aiSignal(angle, index) : aiSignal,
    });
  });
  return snapshot;
}

function pushShoulderAndElbow(engine, values, { boundary = inside, start = 0, step = 160, angleMeta = null } = {}) {
  let snapshot = null;
  values.forEach(([shoulder, elbow], index) => {
    snapshot = engine.pushFrame({
      timestamp: start + index * step,
      jointAngles: { right_shoulder: shoulder, right_elbow: elbow },
      angleMeta,
      boundary,
    });
  });
  return snapshot;
}

function pushAlternating(engine, values, { boundary = inside, start = 0, step = 160 } = {}) {
  let snapshot = null;
  values.forEach(([left, right], index) => {
    snapshot = engine.pushFrame({
      timestamp: start + index * step,
      jointAngles: { left_knee: left, right_knee: right },
      boundary,
    });
  });
  return snapshot;
}

test('rest-target-rest counts one valid rep with score fields', () => {
  const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const reference = motionReference();
  assert.equal(isUsablePracticeReference(reference, exercise), true);

  const engine = createMotionQualityEngine({ exercise, reference, dose: { reps: 1, sets: 1 } });
  pushShoulder(engine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20]);
  const summary = engine.finishSummary();

  assert.equal(summary.reps, 1);
  assert.equal(summary.validReps, 1);
  assert.equal(summary.invalidRepCount, 0);
  assert.equal(Number.isFinite(summary.overallScore), true);
  assert.equal(Number.isFinite(summary.avgTargetReachScore), true);
});

test('incomplete target does not complete a rep', () => {
  const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({ exercise, reference: motionReference(), dose: { reps: 1, sets: 1 } });
  pushShoulder(engine, [20, 20, 50, 70, 80, 70, 40, 20, 20]);
  assert.equal(engine.finishSummary().reps, 0);
});

test('AI signal is exposed in snapshots without changing rule-based rep state', () => {
  const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({ exercise, reference: motionReference(), dose: { reps: 1, sets: 1 } });
  const aiSignal = { phase: 'rest', quality: 'good', confidence: 0.9 };
  const snapshot = engine.pushFrame({
    timestamp: 0,
    jointAngles: { right_shoulder: 20 },
    boundary: inside,
    aiSignal,
  });

  assert.deepEqual(snapshot.aiSignal, aiSignal);
  assert.equal(snapshot.reps, 0);
  assert.equal(engine.finishSummary().reps, 0);
});

test('high-confidence AI quality can invalidate an otherwise valid rep as an assistive signal', () => {
  const exercise = aiReadyExercise({ id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 });
  const engine = createMotionQualityEngine({ exercise, reference: motionReference(), dose: { reps: 1, sets: 1 } });
  pushShoulder(engine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20], {
    aiSignal: { phase: 'moving_to_target', quality: 'wrong_path', confidence: 0.91 },
  });
  const summary = engine.finishSummary();
  const rep = summary.repSummaries[0];

  assert.equal(summary.reps, 1);
  assert.equal(summary.validReps, 0);
  assert.equal(summary.invalidReasons.ai_wrong_path, 1);
  assert.equal(summary.aiSignalCounts.wrong_path > 0, true);
  assert.equal(rep.overallScore, Math.round(40 * 0.85 + rep.ruleOverallScore * 0.15));
  assert.equal(rep.ruleOverallScore >= rep.overallScore, true);
});

test('low-confidence AI quality is ignored so deterministic scoring remains authoritative', () => {
  const exercise = aiReadyExercise({ id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 });
  const engine = createMotionQualityEngine({ exercise, reference: motionReference(), dose: { reps: 1, sets: 1 } });
  pushShoulder(engine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20], {
    aiSignal: { phase: 'moving_to_target', quality: 'wrong_path', confidence: 0.4 },
  });
  const summary = engine.finishSummary();
  const rep = summary.repSummaries[0];

  assert.equal(summary.reps, 1);
  assert.equal(summary.validReps, 1);
  assert.equal(summary.invalidReasons.ai_wrong_path, undefined);
  assert.deepEqual(summary.aiSignalCounts, {});
  assert.equal(rep.overallScore, rep.ruleOverallScore);
  assert.equal(rep.finalReason, 'ai_low_confidence_or_missing_model');
});

test('unknown AI quality is ignored instead of becoming good', () => {
  const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({ exercise, reference: motionReference(), dose: { reps: 1, sets: 1 } });
  pushShoulder(engine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20], {
    aiSignal: { phase: 'moving_to_target', quality: 'out_of_frame', confidence: 0.99 },
  });
  const summary = engine.finishSummary();

  assert.equal(summary.reps, 1);
  assert.equal(summary.validReps, 1);
  assert.deepEqual(summary.aiSignalCounts, {});
  assert.equal(summary.repSummaries[0].aiQualityScore, null);
});

test('completed out-of-frame rep is counted but invalid', () => {
  const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({ exercise, reference: motionReference(), dose: { reps: 1, sets: 1 } });
  pushShoulder(engine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20], { boundary: outside });
  const summary = engine.finishSummary();
  assert.equal(summary.reps, 1);
  assert.equal(summary.invalidRepCount, 1);
  assert.equal(summary.invalidReasons.out_of_frame, 1);
  assert.equal(summary.scoreable, false);
  assert.equal(summary.overallScore, null);
  assert.equal(summary.avgRepQualityScore, null);
  assert.equal(summary.repSummaries[0].scoreable, false);
  assert.equal(summary.repSummaries[0].overallScore, null);
  assert.equal(summary.repSummaries[0].finalReason, 'out_of_frame');
});

test('low-visibility metadata invalidates an otherwise completed rep', () => {
  const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({ exercise, reference: motionReference(), dose: { reps: 1, sets: 1 } });
  pushShoulder(engine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20], {
    angleMeta: { usableJoints: [], usableJointRatio: 0 },
  });
  const summary = engine.finishSummary();
  assert.equal(summary.reps, 1);
  assert.equal(summary.invalidReasons.low_visibility, 1);
  assert.equal(summary.avgVisibilityScore, 0);
});

test('wrong path can invalidate a rep even when pose interpolation looks good', () => {
  const exercise = { id: 'shoulder_path', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({
    exercise,
    reference: nonlinearPathReference(),
    dose: { reps: 1, sets: 1 },
    thresholds: { validScore: 85 },
  });
  pushShoulderAndElbow(engine, [
    [20, 20],
    [20, 20],
    [45, 45],
    [70, 70],
    [70, 70],
    [120, 120],
    [120, 120],
    [70, 70],
    [45, 45],
    [20, 20],
    [20, 20],
  ]);
  const summary = engine.finishSummary();
  assert.equal(summary.reps, 1);
  assert.equal(summary.invalidReasons.wrong_path, 1);
  assert.ok(summary.avgPoseScore > summary.avgPathScore, `${summary.avgPoseScore} <= ${summary.avgPathScore}`);
});

test('too-fast completed rep is invalid', () => {
  const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({
    exercise,
    reference: motionReference(),
    dose: { reps: 1, sets: 1 },
    thresholds: { holdTargetMs: 20, holdRestMs: 20, minRepMs: 600 },
  });
  pushShoulder(engine, [20, 60, 120, 120, 80, 20, 20], { step: 50 });
  const summary = engine.finishSummary();
  assert.equal(summary.reps, 1);
  assert.equal(summary.invalidRepCount, 1);
  assert.equal(summary.invalidReasons.too_fast, 1);
});

test('alternating cycle counts left plus right as one valid rep', () => {
  const exercise = { id: 'march', type: 'rep', movementPattern: 'alternating', countMode: 'cycle', reps: 1, sets: 1 };
  const reference = alternatingReference('cycle');
  assert.equal(isUsablePracticeReference(reference, exercise), true);
  const engine = createMotionQualityEngine({ exercise, reference, dose: { reps: 1, sets: 1 } });
  pushAlternating(engine, [
    [20, 20], [20, 20], [60, 20], [120, 20], [120, 20], [80, 20], [20, 20], [20, 20],
    [20, 60], [20, 120], [20, 120], [20, 80], [20, 20], [20, 20],
  ]);
  const summary = engine.finishSummary();
  assert.equal(summary.reps, 1);
  assert.equal(summary.validReps, 1);
});

test('alternating per-side counts each side as a rep', () => {
  const exercise = { id: 'march', type: 'rep', movementPattern: 'alternating', countMode: 'per_side', reps: 2, sets: 1 };
  const engine = createMotionQualityEngine({ exercise, reference: alternatingReference('per_side'), dose: { reps: 2, sets: 1 } });
  pushAlternating(engine, [
    [20, 20], [20, 20], [60, 20], [120, 20], [120, 20], [80, 20], [20, 20], [20, 20],
    [20, 60], [20, 120], [20, 120], [20, 80], [20, 20], [20, 20],
  ]);
  assert.equal(engine.finishSummary().reps, 2);
});

test('same-side alternating cycle is invalid', () => {
  const exercise = { id: 'march', type: 'rep', movementPattern: 'alternating', countMode: 'cycle', reps: 1, sets: 1 };
  const engine = createMotionQualityEngine({ exercise, reference: alternatingReference('cycle'), dose: { reps: 1, sets: 1 } });
  pushAlternating(engine, [
    [20, 20], [20, 20], [60, 20], [120, 20], [120, 20], [80, 20], [20, 20], [20, 20],
    [60, 20], [120, 20], [120, 20], [80, 20], [20, 20], [20, 20],
  ]);
  const summary = engine.finishSummary();
  assert.equal(summary.reps, 1);
  assert.equal(summary.invalidRepCount, 1);
  assert.equal(summary.invalidReasons.same_side_cycle, 1);
});

test('hold pose produces scored summary', () => {
  const exercise = { id: 'balance', type: 'hold', primaryJoint: 'right_knee', holdSec: 1 };
  const reference = {
    kind: REFERENCE_KINDS.HOLD_POSE,
    scoringJoints: ['right_knee'],
    holdTargetAngles: { right_knee: 70 },
    jointMotion: { right_knee: { tol: 18 } },
  };
  assert.equal(isUsablePracticeReference(reference, exercise), true);
  const engine = createMotionQualityEngine({ exercise, reference, dose: { holdSec: 1 } });
  for (let i = 0; i < 10; i++) {
    engine.pushFrame({ timestamp: i * 140, jointAngles: { right_knee: 70 + (i % 2) }, boundary: inside });
  }
  const summary = engine.finishSummary();
  assert.equal(summary.type, 'hold');
  assert.equal(summary.validReps, 1);
  assert.ok(summary.overallScore >= 80, `expected high hold score, got ${summary.overallScore}`);
});

test('hold pose summary includes high-confidence AI unstable quality as an assistive invalid reason', () => {
  const exercise = aiReadyExercise({ id: 'balance', type: 'hold', primaryJoint: 'right_knee', holdSec: 1 });
  const reference = {
    kind: REFERENCE_KINDS.HOLD_POSE,
    scoringJoints: ['right_knee'],
    holdTargetAngles: { right_knee: 70 },
    jointMotion: { right_knee: { tol: 18 } },
  };
  const engine = createMotionQualityEngine({ exercise, reference, dose: { holdSec: 1 } });
  for (let i = 0; i < 10; i++) {
    engine.pushFrame({
      timestamp: i * 140,
      jointAngles: { right_knee: 70 + (i % 2) },
      boundary: inside,
      aiSignal: { phase: 'target', quality: 'unstable', confidence: 0.88 },
    });
  }
  const summary = engine.finishSummary();

  assert.equal(summary.type, 'hold');
  assert.equal(summary.validReps, 0);
  assert.equal(summary.invalidReasons.ai_unstable, 1);
  assert.equal(summary.aiSignalCounts.unstable, 10);
});
