import {
  createMotionQualityEngine,
  isUsablePracticeReference,
  REFERENCE_KINDS,
} from '../shared/ai/MotionQualityEngine.js';

const checks = [];
function check(name, pass, detail = null) {
  checks.push({ name, pass: !!pass, detail });
}

const inside = { status: 'inside' };
const outside = { status: 'outside' };

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
      durationMs: 2000,
      phases: { restStartMs: 0, targetMs: 1000, restEndMs: 2000 },
      repJoints: ['right_shoulder'],
      frames: [
        { t: 0, p: 0, angles: { right_shoulder: 20 } },
        { t: 1000, p: 1, angles: { right_shoulder: 120 } },
        { t: 2000, p: 0, angles: { right_shoulder: 20 } },
      ],
    },
  };
}

function alternatingReference(countMode = 'cycle') {
  const leftMotion = {
    rest: 20,
    target: 120,
    range: 100,
    tol: 15,
    weight: 1,
    contributesToProgress: true,
  };
  const rightMotion = { ...leftMotion };
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
    targetJointAngles: { left_knee: 120, right_knee: 20 },
    targetJointAnglesBySide: {
      left: { left_knee: 120, right_knee: 20 },
      right: { left_knee: 20, right_knee: 120 },
    },
    jointMotion: {
      left_knee: leftMotion,
      right_knee: rightMotion,
    },
    sideMotions: {
      left: {
        repJoints: ['left_knee'],
        primaryJoints: ['left_knee'],
        dominantJoint: 'left_knee',
        targetJointAngles: { left_knee: 120, right_knee: 20 },
        jointMotion: { left_knee: leftMotion },
      },
      right: {
        repJoints: ['right_knee'],
        primaryJoints: ['right_knee'],
        dominantJoint: 'right_knee',
        targetJointAngles: { left_knee: 20, right_knee: 120 },
        jointMotion: { right_knee: rightMotion },
      },
    },
    referenceSequence: {
      kind: 'angle-trajectory',
      version: 3,
      cycle: 'rest-left-rest-right-rest',
      durationMs: 3600,
      sampleCount: 5,
      phases: { restStartMs: 0, leftTargetMs: 900, middleRestMs: 1800, rightTargetMs: 2700, restEndMs: 3600 },
      repJoints: ['left_knee', 'right_knee'],
      dominantJoint: 'left_knee',
      movementPattern: 'alternating',
      frames: [
        { t: 0, p: 0, side: 'rest', angles: { left_knee: 20, right_knee: 20 } },
        { t: 900, p: 1, side: 'left', angles: { left_knee: 120, right_knee: 20 } },
        { t: 1800, p: 0, side: 'rest', angles: { left_knee: 20, right_knee: 20 } },
        { t: 2700, p: 1, side: 'right', angles: { left_knee: 20, right_knee: 120 } },
        { t: 3600, p: 0, side: 'rest', angles: { left_knee: 20, right_knee: 20 } },
      ],
    },
  };
}

function pushAngles(engine, values, boundary = inside, start = 1000, step = 160) {
  let snapshot = null;
  values.forEach((angle, index) => {
    snapshot = engine.pushFrame({
      timestamp: start + index * step,
      jointAngles: { right_shoulder: angle },
      boundary,
    });
  });
  return snapshot;
}

function pushAlternatingAngles(engine, values, boundary = inside, start = 9000, step = 160) {
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

const exercise = { id: 'shoulder', type: 'rep', primaryJoint: 'right_shoulder', reps: 1, sets: 1 };
const reference = motionReference();
check('motion reference is usable', isUsablePracticeReference(reference, exercise));

const validEngine = createMotionQualityEngine({ exercise, reference, dose: { reps: 1, sets: 1 } });
pushAngles(validEngine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20]);
const validSummary = validEngine.finishSummary();
check('rest-target-rest counts one rep', validSummary.reps === 1, validSummary);
check('clean rep is valid', validSummary.validReps === 1 && validSummary.invalidRepCount === 0, validSummary);
check('summary exposes score fields', Number.isFinite(validSummary.overallScore) && Number.isFinite(validSummary.avgTargetReachScore), validSummary);

const incompleteEngine = createMotionQualityEngine({ exercise, reference, dose: { reps: 1, sets: 1 } });
pushAngles(incompleteEngine, [20, 20, 50, 70, 80, 70, 40, 20, 20]);
const incompleteSummary = incompleteEngine.finishSummary();
check('incomplete target does not complete a rep', incompleteSummary.reps === 0, incompleteSummary);

const badBoundaryEngine = createMotionQualityEngine({ exercise, reference, dose: { reps: 1, sets: 1 } });
pushAngles(badBoundaryEngine, [20, 20, 60, 95, 120, 120, 80, 45, 20, 20], outside);
const badBoundarySummary = badBoundaryEngine.finishSummary();
check('completed out-of-frame rep counts', badBoundarySummary.reps === 1, badBoundarySummary);
check('completed out-of-frame rep is invalid', badBoundarySummary.invalidRepCount === 1 && badBoundarySummary.invalidReasons.out_of_frame === 1, badBoundarySummary);

const alternatingExercise = { id: 'march', type: 'rep', movementPattern: 'alternating', countMode: 'cycle', reps: 1, sets: 1 };
const alternatingCycle = alternatingReference('cycle');
check('alternating reference is usable', isUsablePracticeReference(alternatingCycle, alternatingExercise));
const alternatingCycleEngine = createMotionQualityEngine({ exercise: alternatingExercise, reference: alternatingCycle, dose: { reps: 1, sets: 1 } });
pushAlternatingAngles(alternatingCycleEngine, [
  [20, 20], [20, 20], [60, 20], [120, 20], [120, 20], [80, 20], [20, 20], [20, 20],
  [20, 60], [20, 120], [20, 120], [20, 80], [20, 20], [20, 20],
]);
const alternatingCycleSummary = alternatingCycleEngine.finishSummary();
check('alternating cycle counts left plus right as one rep', alternatingCycleSummary.reps === 1, alternatingCycleSummary);
check('alternating cycle rep is valid', alternatingCycleSummary.validReps === 1, alternatingCycleSummary);

const alternatingPerSide = alternatingReference('per_side');
const alternatingPerSideEngine = createMotionQualityEngine({ exercise: { ...alternatingExercise, countMode: 'per_side' }, reference: alternatingPerSide, dose: { reps: 2, sets: 1 } });
pushAlternatingAngles(alternatingPerSideEngine, [
  [20, 20], [20, 20], [60, 20], [120, 20], [120, 20], [80, 20], [20, 20], [20, 20],
  [20, 60], [20, 120], [20, 120], [20, 80], [20, 20], [20, 20],
]);
const alternatingPerSideSummary = alternatingPerSideEngine.finishSummary();
check('alternating per-side counts two reps', alternatingPerSideSummary.reps === 2, alternatingPerSideSummary);

const holdReference = {
  kind: REFERENCE_KINDS.HOLD_POSE,
  exerciseId: 'balance',
  scoringJoints: ['right_knee'],
  holdTargetAngles: { right_knee: 70 },
  jointMotion: { right_knee: { tol: 18 } },
};
const holdExercise = { id: 'balance', type: 'hold', primaryJoint: 'right_knee', holdSec: 1 };
check('hold reference is usable', isUsablePracticeReference(holdReference, holdExercise));
const holdEngine = createMotionQualityEngine({ exercise: holdExercise, reference: holdReference, dose: { holdSec: 1 } });
for (let i = 0; i < 10; i++) {
  holdEngine.pushFrame({ timestamp: 5000 + i * 140, jointAngles: { right_knee: 70 + (i % 2) }, boundary: inside });
}
const holdSummary = holdEngine.finishSummary();
check('hold summary scores hold pose', holdSummary.type === 'hold' && holdSummary.overallScore >= 80, holdSummary);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
