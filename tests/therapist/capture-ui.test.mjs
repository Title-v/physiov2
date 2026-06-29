import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryClass,
  boundaryText,
  buildReferencePanelModel,
  canRecordSequence,
  captureButtonText,
  captureHint,
  cycleAnglesFor,
  degText,
  isMotionExercise,
  roleText,
  trajectoryRangeFor,
} from '../../src/app/therapist/capture/captureUI.js';

const translate = (key) => ({ noPose: 'No pose', captureRef: 'Capture', captureHint: 'Hold still' }[key] || key);

test('capture UI boundary helpers render status text and classes', () => {
  assert.equal(boundaryText(null, { translate }), 'No pose');
  assert.equal(boundaryText({ hint: 'Inside', hintTh: 'อยู่ในเฟรม' }, { lang: 'th', translate }), 'อยู่ในเฟรม');
  assert.equal(boundaryClass({ status: 'inside' }), 'pill good glass');
  assert.equal(boundaryClass({ status: 'outside' }), 'pill bad glass');
});

test('capture UI exercise mode helpers distinguish hold from motion exercises', () => {
  assert.equal(isMotionExercise({ type: 'rep' }), true);
  assert.equal(isMotionExercise({ type: 'hold' }), false);
  assert.equal(canRecordSequence({ type: 'rep' }), true);
  assert.equal(canRecordSequence({ type: 'hold' }), false);
});

test('capture UI button and hint copy matches motion pattern', () => {
  assert.equal(captureButtonText({ type: 'hold' }, { translate }), 'Capture');
  assert.equal(captureButtonText({ type: 'rep' }, { lang: 'th', translate }), 'ใช้ Record motion');
  assert.equal(
    captureHint({ type: 'rep', movementPattern: 'alternating' }, { lang: 'en', translate }),
    'Record one full cycle: rest → left target → rest → right target → rest.',
  );
  assert.equal(captureHint({ type: 'hold' }, { lang: 'en', translate }), 'Hold still');
});

test('reference panel model summarizes target, range, timing, tracked joints, and joint rows', () => {
  const reference = {
    movementPattern: 'unilateral',
    repJoints: ['right_shoulder', 'right_elbow'],
    requestedRepJoints: ['right_shoulder', 'right_elbow', 'right_wrist'],
    jointAngles: { right_shoulder: 120, right_elbow: 80 },
    restJointAngles: { right_shoulder: 20, right_elbow: 60 },
    returnRestJointAngles: { right_shoulder: 24 },
    targetJointAngles: { right_shoulder: 120, right_elbow: 80 },
    jointMotion: {
      right_shoulder: { rest: 20, target: 120, role: 'primary_motion' },
      right_elbow: { rest: 60, target: 80, trajectoryRange: 35, role: 'coordinated_motion' },
    },
    referenceSequence: {
      phases: { restStartMs: 0, targetMs: 500, restEndMs: 1100 },
      frames: [
        { angles: { right_shoulder: 20 } },
        { angles: { right_shoulder: 80 } },
        { angles: { right_shoulder: 125 } },
      ],
    },
  };

  assert.equal(degText(92.4), '92°');
  assert.equal(trajectoryRangeFor(reference, 'right_shoulder'), 105);
  assert.deepEqual(cycleAnglesFor(reference, 'right_elbow'), {
    rest: 60,
    target: 80,
    returned: null,
    endpointRange: 20,
    trajectoryRange: 35,
    range: 35,
  });
  assert.equal(roleText('primary_motion', 'th'), 'หลัก');

  const model = buildReferencePanelModel({
    reference,
    exercise: { id: 'shoulder', type: 'rep', movementPattern: 'unilateral' },
    lang: 'en',
    candidateRepJointsForExercise: () => ['right_shoulder'],
    formatMs: (ms) => `${ms}ms`,
  });

  assert.equal(model.targetShownText, '120°');
  assert.equal(model.primaryCycleText, '20° → 120° → 24°');
  assert.equal(model.timingText, '500ms out · 600ms back');
  assert.equal(model.trackedLabel, 'right_shoulder, right_elbow · unavailable right_wrist');
  assert.equal(model.jointRows[0].suffix, ' · primary 105° path');
  assert.equal(model.jointRows[1].suffix, ' · coordinated 35° path');
});

test('reference panel model marks candidate joints before a motion reference exists', () => {
  const model = buildReferencePanelModel({
    reference: null,
    exercise: { id: 'knee', type: 'rep', bodyRegion: 'lower', movementPattern: 'alternating' },
    romBodyRegion: 'lower',
    lang: 'th',
    candidateRepJointsForExercise: () => ['left_knee', 'right_knee'],
  });

  assert.equal(model.primaryCycleText, '— → —');
  assert.equal(model.targetShownText, '—');
  assert.equal(model.trackedLabel, 'left_knee, right_knee (candidate)');
  assert.equal(model.patternText, 'alternating');
});
