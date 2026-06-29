import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlternatingReferenceMotion,
  buildAlternatingReferenceTrajectory,
  buildReferenceMotion,
  buildReferenceTrajectory,
  selectRepJoints,
} from '../../shared/ai/MultiJointMotion.js';
import { isUsablePracticeReference, REFERENCE_KINDS } from '../../shared/ai/MotionQualityEngine.js';

test('selectRepJoints chooses joints by body region and range', () => {
  const selected = selectRepJoints(
    { right_shoulder: 20, right_elbow: 90, left_knee: 30 },
    { right_shoulder: 120, right_elbow: 95, left_knee: 130 },
    'right_arm',
  );
  assert.deepEqual(selected.repJoints, ['right_shoulder']);
  assert.equal(selected.dominantJoint, 'right_shoulder');
});

test('buildReferenceMotion creates usable motion reference', () => {
  const exercise = { id: 'shoulder', type: 'rep', bodyRegion: 'right_arm', movementPattern: 'unilateral' };
  const motion = buildReferenceMotion({
    exercise,
    restAngles: { right_shoulder: 20, right_elbow: 90 },
    targetAngles: { right_shoulder: 120, right_elbow: 94 },
  });
  const reference = {
    ...motion,
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    referenceSequence: {
      frames: [
        { p: 0, angles: { right_shoulder: 20 } },
        { p: 1, angles: { right_shoulder: 120 } },
      ],
    },
  };
  assert.equal(motion.dominantJoint, 'right_shoulder');
  assert.equal(isUsablePracticeReference(reference, exercise), true);
});

test('buildReferenceTrajectory creates rest-target-rest trajectory and applies trajectory range', () => {
  const exercise = { id: 'shoulder', type: 'rep', bodyRegion: 'right_arm', movementPattern: 'unilateral' };
  const motion = buildReferenceMotion({
    exercise,
    restAngles: { right_shoulder: 20 },
    targetAngles: { right_shoulder: 40 },
  });
  const trajectory = buildReferenceTrajectory({
    motion,
    targetFrameIndex: 1,
    frames: [
      { t: 0, jointAngles: { right_shoulder: 20 } },
      { t: 500, jointAngles: { right_shoulder: 120 } },
      { t: 1000, jointAngles: { right_shoulder: 20 } },
    ],
  });
  assert.equal(trajectory.cycle, 'rest-target-rest');
  assert.equal(trajectory.phases.targetMs, 500);
  assert.equal(motion.jointMotion.right_shoulder.trajectoryRange, 100);
  assert.equal(motion.jointMotion.right_shoulder.target, 120);
});

test('buildAlternatingReferenceMotion creates side motions and alternating trajectory', () => {
  const exercise = {
    id: 'march',
    type: 'rep',
    bodyRegion: 'lower',
    movementPattern: 'alternating',
    alternatingSides: ['left', 'right'],
    countMode: 'cycle',
  };
  const motion = buildAlternatingReferenceMotion({
    exercise,
    restAngles: { left_knee: 20, right_knee: 20 },
    leftTargetAngles: { left_knee: 120, right_knee: 20 },
    rightTargetAngles: { left_knee: 20, right_knee: 120 },
  });
  const frames = [
    { t: 0, jointAngles: { left_knee: 20, right_knee: 20 } },
    { t: 200, jointAngles: { left_knee: 60, right_knee: 20 } },
    { t: 400, jointAngles: { left_knee: 120, right_knee: 20 } },
    { t: 600, jointAngles: { left_knee: 60, right_knee: 20 } },
    { t: 800, jointAngles: { left_knee: 20, right_knee: 20 } },
    { t: 1000, jointAngles: { left_knee: 20, right_knee: 60 } },
    { t: 1200, jointAngles: { left_knee: 20, right_knee: 120 } },
    { t: 1400, jointAngles: { left_knee: 20, right_knee: 20 } },
  ];
  const trajectory = buildAlternatingReferenceTrajectory({
    frames,
    motion,
    leftTargetIdx: 2,
    rightTargetIdx: 6,
  });
  const reference = {
    ...motion,
    kind: REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE,
    referenceSequence: trajectory,
  };
  assert.deepEqual(motion.alternatingSides, ['left', 'right']);
  assert.equal(motion.sideMotions.left.dominantJoint, 'left_knee');
  assert.equal(motion.sideMotions.right.dominantJoint, 'right_knee');
  assert.equal(trajectory.cycle, 'rest-left-rest-right-rest');
  assert.equal(trajectory.phases.leftTargetMs, 400);
  assert.equal(trajectory.phases.rightTargetMs, 1200);
  assert.equal(isUsablePracticeReference(reference, exercise), true);
});
