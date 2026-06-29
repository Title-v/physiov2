import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQUENCE_MIN_FRAMES,
  appendSequenceRecordingFrame,
  applySequenceTrim,
  beginSequenceRecordingState,
  createSequenceRecording,
  finishSequenceRecordingState,
  finalizeSequenceRecording,
  formatMs,
  inferSequenceTargetIndex,
  pendingSequenceIndexes,
  selectedSequenceRange,
  sequenceStartProblem,
  sequenceDuration,
} from '../../src/app/therapist/capture/sequenceRecorder.js';

function framesFromAngles(values) {
  return values.map((value, index) => ({
    t: index * 100,
    jointAngles: { right_shoulder: value, left_knee: index * 5 },
    landmarks: [{ x: index, y: 0, z: 0, visibility: 0.99 }],
  }));
}

test('sequence timing helpers clamp missing and selected ranges', () => {
  const sequence = { frames: framesFromAngles([20, 40, 100, 45, 20]) };

  assert.equal(formatMs(1250), '1.3s');
  assert.equal(formatMs(12300), '12s');
  assert.equal(sequenceDuration(sequence), 400);
  assert.equal(sequenceDuration(sequence, 1, 3), 200);
  assert.deepEqual(selectedSequenceRange({ ...sequence, startIdx: 1, targetIdx: 2, endIdx: 4 }), {
    startIdx: 1,
    targetIdx: 2,
    endIdx: 4,
    targetOffset: 1,
    frames: sequence.frames.slice(1, 5),
  });
});

test('pendingSequenceIndexes keeps start target end ordered and separated', () => {
  const sequence = { frames: framesFromAngles([0, 1, 2, 3, 4]), startIdx: 4, targetIdx: 0, endIdx: 2 };

  assert.deepEqual(pendingSequenceIndexes(sequence), {
    startIdx: 2,
    targetIdx: 3,
    endIdx: 4,
  });
});

test('applySequenceTrim mutates selected marker while preserving valid rest-target-rest order', () => {
  const sequence = { frames: framesFromAngles([0, 1, 2, 3, 4, 5]), startIdx: 0, targetIdx: 3, endIdx: 5 };

  assert.deepEqual(applySequenceTrim(sequence, 'start', 4), {
    startIdx: 2,
    targetIdx: 3,
    endIdx: 5,
  });
  assert.deepEqual(applySequenceTrim(sequence, 'target', 5), {
    startIdx: 2,
    targetIdx: 4,
    endIdx: 5,
  });
  assert.deepEqual(applySequenceTrim(sequence, 'end', 1), {
    startIdx: 2,
    targetIdx: 4,
    endIdx: 5,
  });
});

test('inferSequenceTargetIndex chooses the peak movement from rest', () => {
  const frames = framesFromAngles([20, 35, 78, 140, 74, 22]);

  assert.equal(inferSequenceTargetIndex(frames, { candidateJoints: ['right_shoulder'] }), 3);
});

test('sequence recording appends only inside-boundary frames and finalizes pending sequence', () => {
  const recording = createSequenceRecording({
    exerciseId: 'shoulder',
    bodyRegionFlag: { id: 'right_arm' },
    angleOverlayJoints: ['right_shoulder'],
    startedAt: 1000,
  });
  const cleanAngles = (angles) => angles;
  const cleanLandmarks = (landmarks) => landmarks;

  const outside = appendSequenceRecordingFrame(recording, {
    boundary: { status: 'outside' },
    now: 1000,
    jointAngles: { right_shoulder: 20 },
    landmarks: [{ x: 0 }],
    cleanAngles,
    cleanLandmarks,
  });
  assert.equal(outside, false);

  for (let i = 0; i < SEQUENCE_MIN_FRAMES; i++) {
    const appended = appendSequenceRecordingFrame(recording, {
      boundary: { status: 'inside' },
      now: 1000 + i * 100,
      jointAngles: { right_shoulder: i === 3 ? 130 : 20 + i },
      landmarks: [{ x: i }],
      cleanAngles,
      cleanLandmarks,
    });
    assert.equal(appended, true);
  }

  const finalized = finalizeSequenceRecording(recording, {
    exerciseId: 'shoulder',
    candidateJoints: ['right_shoulder'],
  });

  assert.equal(finalized.ok, true);
  assert.equal(finalized.targetIdx, 3);
  assert.equal(finalized.pendingSequence.frames.length, SEQUENCE_MIN_FRAMES);
  assert.equal(finalized.pendingSequence.bodyRegionFlag.id, 'right_arm');
});

test('sequence recording state helpers guard start and finalize pending clip state', () => {
  assert.equal(sequenceStartProblem({
    exercise: { type: 'rep' },
    bodyRegionFlag: null,
    cameraOn: true,
    engineReady: true,
  }), 'missing_body_region');
  assert.equal(sequenceStartProblem({
    exercise: { type: 'rep' },
    bodyRegionFlag: { id: 'right_arm' },
    cameraOn: false,
    engineReady: true,
  }), 'camera_not_ready');
  assert.equal(sequenceStartProblem({
    exercise: { type: 'hold' },
    bodyRegionFlag: { id: 'right_arm' },
    cameraOn: true,
    engineReady: true,
    canRecord: (exercise) => exercise.type !== 'hold',
  }), 'unsupported_exercise');
  assert.equal(sequenceStartProblem({
    exercise: { type: 'rep' },
    bodyRegionFlag: { id: 'right_arm' },
    cameraOn: true,
    engineReady: true,
  }), null);

  const state = {
    captureDraft: { stale: true },
    pendingSequence: { stale: true },
    previewFrameIdx: 4,
    recording: null,
  };
  beginSequenceRecordingState(state, {
    exerciseId: 'shoulder',
    bodyRegionFlag: { id: 'right_arm' },
    angleOverlayJoints: ['right_shoulder'],
    startedAt: 1000,
  });
  assert.equal(state.captureDraft, null);
  assert.equal(state.pendingSequence, null);
  assert.equal(state.previewFrameIdx, null);
  assert.equal(state.recording.exerciseId, 'shoulder');

  for (let i = 0; i < SEQUENCE_MIN_FRAMES; i++) {
    appendSequenceRecordingFrame(state.recording, {
      boundary: { status: 'inside' },
      now: 1000 + i * 100,
      jointAngles: { right_shoulder: i === 4 ? 120 : 20 },
      landmarks: [{ x: i }],
      cleanAngles: (angles) => angles,
      cleanLandmarks: (landmarks) => landmarks,
    });
  }
  const result = finishSequenceRecordingState(state, {
    exerciseId: 'shoulder',
    candidateJoints: ['right_shoulder'],
  });

  assert.equal(result.ok, true);
  assert.equal(state.recording, null);
  assert.equal(state.pendingSequence.frames.length, SEQUENCE_MIN_FRAMES);
  assert.equal(state.previewFrameIdx, result.targetIdx);
});

test('finalizeSequenceRecording rejects short or mismatched recordings', () => {
  const recording = createSequenceRecording({ exerciseId: 'shoulder', startedAt: 0 });
  recording.frames = framesFromAngles([20, 40, 60]);

  assert.deepEqual(finalizeSequenceRecording(recording, { exerciseId: 'knee' }), {
    ok: false,
    reason: 'wrong_exercise',
  });
  assert.deepEqual(finalizeSequenceRecording(recording, { exerciseId: 'shoulder' }), {
    ok: false,
    reason: 'too_short',
  });
});
