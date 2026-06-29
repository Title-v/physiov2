import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATIENT_EXERCISES,
  normalizePatientExercise,
  overlayJointsForExercise,
  practiceDose,
  referenceForExercise,
  toPatientExercise,
} from '../../shared/core/patient-exercises.js';
import { buildPracticeSessionPayload, summaryMetrics } from '../../shared/practice/session.js';

test('patient exercise helpers expose built-ins and normalize plan overrides', () => {
  assert.ok(PATIENT_EXERCISES.length >= 5);
  const shoulder = toPatientExercise({ id: 'shoulder', label: 'Shoulder', bodyRegion: 'right_arm', reps: 10, sets: 3 });
  assert.equal(shoulder.title, 'ยกแขนขึ้น');
  assert.equal(shoulder.bodyRegionLabel, 'แขนขวา');

  const normalized = normalizePatientExercise({ id: 'shoulder', target: 140 }, { reps: 8, sets: 2 });
  assert.equal(normalized.reps, 8);
  assert.equal(normalized.sets, 2);
  assert.equal(normalized.target, 140);
  assert.equal(practiceDose(normalized).reps, 8);
});

test('reference and overlay helpers select patient-facing practice data', () => {
  const reference = { exerciseId: 'custom', repJoints: ['left_elbow', 'left_shoulder'] };
  const ex = { id: 'custom', primaryJoint: 'right_knee' };
  assert.equal(referenceForExercise(ex, { custom: reference }), reference);
  assert.deepEqual(overlayJointsForExercise({ ...ex, reference }), ['left_elbow', 'left_shoulder']);
  assert.deepEqual(overlayJointsForExercise(ex), ['right_knee']);
});

test('buildPracticeSessionPayload uses final summary scores and plan kind', () => {
  const endedAt = 123456789;
  const summary = {
    overallScore: 88,
    avgScore: 84,
    reps: 10,
    validReps: 9,
    invalidRepCount: 1,
  };
  const payload = buildPracticeSessionPayload({
    exercise: { id: 'shoulder', title: 'Shoulder raise' },
    planItems: [{ exerciseId: 'shoulder' }],
    summary,
    endedAt,
  });
  assert.equal(payload.id, 'patient_shoulder_123456789');
  assert.equal(payload.kind, 'plan');
  assert.equal(payload.score, 88);
  assert.equal(payload.avgScore, 84);
  assert.equal(payload.reps, 10);
  assert.equal(payload.validReps, 9);
  assert.equal(payload.invalidRepCount, 1);
  assert.equal(payload.summary, summary);
});

test('buildPracticeSessionPayload falls back avgScore and marks extra sessions', () => {
  const payload = buildPracticeSessionPayload({
    exercise: { id: 'balance', title: 'Balance' },
    planItems: [],
    summary: { overallScore: 76, reps: 1, validReps: 1, invalidRepCount: 0 },
    endedAt: 99,
  });
  assert.equal(payload.kind, 'extra');
  assert.equal(payload.avgScore, 76);
});

test('summaryMetrics matches patient summary screen values', () => {
  const metrics = summaryMetrics({
    session: {
      score: 91,
      summary: {
        overallScore: 91,
        avgPoseScore: 89,
        avgTargetReachScore: 95,
        validReps: 7,
        reps: 8,
      },
    },
  });
  assert.deepEqual(metrics, {
    score: 91,
    poseScore: 89,
    motionScore: 95,
    validReps: 7,
    reps: 8,
    validLabel: '7/8',
  });
});
