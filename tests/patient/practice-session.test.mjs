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
import { EXERCISES, requiredJointsForExercise, scoringProfileForExercise } from '../../shared/core/exercises.js';
import { savePracticeSession } from '../../apps/patient/sessionSync.js';

test('patient exercise helpers expose built-ins and normalize plan overrides', () => {
  assert.ok(PATIENT_EXERCISES.length >= 5);
  const shoulder = toPatientExercise({ id: 'shoulder', label: 'Shoulder', bodyRegion: 'right_arm', reps: 10, sets: 3 });
  assert.equal(shoulder.title, 'ยกแขนขึ้น');
  assert.equal(shoulder.bodyRegionLabel, 'แขนขวา');
  assert.equal(shoulder.scoringProfile, 'upper_limb_rom');
  assert.ok(shoulder.setupInstruction.includes('กล้อง'));

  const normalized = normalizePatientExercise({ id: 'shoulder', target: 140 }, { reps: 8, sets: 2 });
  assert.equal(normalized.reps, 8);
  assert.equal(normalized.sets, 2);
  assert.equal(normalized.target, 140);
  assert.equal(practiceDose(normalized).reps, 8);
});

test('built-in exercises expose production metadata', () => {
  for (const exercise of EXERCISES) {
    assert.ok(Array.isArray(exercise.requiredJoints), `${exercise.id} missing requiredJoints`);
    assert.ok(exercise.requiredJoints.length > 0, `${exercise.id} has empty requiredJoints`);
    assert.equal(Number.isFinite(exercise.minVisibility), true, `${exercise.id} missing minVisibility`);
    assert.equal(typeof scoringProfileForExercise(exercise), 'string');
  }
  assert.deepEqual(requiredJointsForExercise(EXERCISES.find((ex) => ex.id === 'shoulder')), ['right_shoulder', 'right_elbow', 'right_hip']);
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
  assert.equal(payload.sessionVersion, 3);
  assert.equal(payload.scoreSource, 'rule');
  assert.equal(payload.scoreBreakdown.overall, 88);
  assert.deepEqual(payload.invalidReasons, {});
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

test('AI-primary session payload preserves score source and AI quality breakdown', () => {
  const payload = buildPracticeSessionPayload({
    exercise: { id: 'shoulder', title: 'Shoulder raise' },
    planItems: [{ exerciseId: 'shoulder' }],
    summary: {
      scoreSource: 'ai_primary',
      overallScore: 86,
      avgScore: 86,
      avgAiQualityScore: 94,
      avgPoseScore: 20,
      avgTargetReachScore: 0,
      reps: 1,
      validReps: 1,
      invalidRepCount: 0,
    },
    endedAt: 123,
  });
  const metrics = summaryMetrics({ session: payload });

  assert.equal(payload.sessionVersion, 3);
  assert.equal(payload.scoreSource, 'ai_primary');
  assert.equal(payload.scoreBreakdown.aiQuality, 94);
  assert.equal(payload.scoreBreakdown.repQuality, null);
  assert.equal(metrics.poseScore, 94);
  assert.equal(metrics.motionScore, 94);
});

test('savePracticeSession posts versioned payload and merges server response', async () => {
  const session = await savePracticeSession({
    exercise: { id: 'shoulder', title: 'Shoulder raise' },
    planItems: [{ exerciseId: 'shoulder' }],
    run: {
      reference: { referenceVersion: 3, scoringVersion: 3 },
      summary: { overallScore: 90, reps: 2, validReps: 2, invalidRepCount: 0 },
    },
    endedAt: 1000,
    postSession: async (path, payload) => {
      assert.equal(path, '/sessions');
      assert.equal(payload.sessionVersion, 3);
      assert.equal(payload.referenceVersion, 3);
      assert.equal(payload.scoreBreakdown.overall, 90);
      return { id: 'server-session', endedAt: '1970-01-01T00:00:02.000Z' };
    },
  });

  assert.equal(session.id, 'server-session');
  assert.equal(session.endedAt, 2000);
  assert.equal(session.score, 90);
});

test('savePracticeSession falls back to local payload when session POST fails', async () => {
  const session = await savePracticeSession({
    exercise: { id: 'balance', title: 'Balance' },
    run: {
      reference: { referenceVersion: 3 },
      summary: { overallScore: 74, reps: 1, validReps: 1, invalidRepCount: 0 },
    },
    endedAt: 77,
    postSession: async () => { throw new Error('offline'); },
  });

  assert.equal(session.id, 'patient_balance_77');
  assert.equal(session.endedAt, 77);
  assert.equal(session.score, 74);
});
