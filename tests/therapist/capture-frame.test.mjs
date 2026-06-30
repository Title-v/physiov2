import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_DEFAULT_COLORS,
  prepareLiveCaptureFrame,
  prepareLiveCaptureFrameWithAi,
} from '../../src/app/therapist/capture/captureFrame.js';

test('prepareLiveCaptureFrame resets smoothing and evaluates reset boundary when no pose is visible', () => {
  let resetCalled = false;
  const boundaries = [];
  const result = prepareLiveCaptureFrame({
    rawLandmarks: null,
    landmarkFilter: { reset: () => { resetCalled = true; } },
    currentBoundary: (landmarks, options) => {
      boundaries.push({ landmarks, options });
      return { status: 'outside', hint: 'No pose', nextFrame: null };
    },
  });

  assert.equal(resetCalled, true);
  assert.equal(result.hasPose, false);
  assert.equal(result.live, null);
  assert.equal(result.boundary.status, 'outside');
  assert.deepEqual(result.colors, CAPTURE_DEFAULT_COLORS);
  assert.deepEqual(boundaries, [{ landmarks: null, options: { reset: true } }]);
});

test('prepareLiveCaptureFrame smooths landmarks and calculates live angles without validation in setup mode', () => {
  const raw = [{ x: 0.2, y: 0.3, visibility: 1 }];
  const smoothed = [{ x: 0.25, y: 0.35, visibility: 1 }];
  const result = prepareLiveCaptureFrame({
    rawLandmarks: raw,
    landmarkFilter: { smooth: (landmarks) => landmarks === raw ? smoothed : landmarks },
    exercise: { id: 'shoulder', minVisibility: 0.6, allow3D: true },
    mode: 'setup',
    currentBoundary: (landmarks) => ({ status: 'inside', hint: 'Inside', landmarks }),
    jointAngleCalculatorDetailedImpl: (landmarks, options) => ({
      angles: { right_shoulder: landmarks[0].x * 100 },
      meta: { options },
    }),
  });

  assert.equal(result.hasPose, true);
  assert.equal(result.live, smoothed);
  assert.equal(result.boundary.status, 'inside');
  assert.deepEqual(result.liveAngles, { right_shoulder: 25 });
  assert.deepEqual(result.angleMeta.options, { minVisibility: 0.6, use3D: true });
  assert.equal(result.snapshot, null);
  assert.equal(result.validationUnavailable, false);
});

test('prepareLiveCaptureFrame runs motion validation preview and returns score colors and ghost landmarks', () => {
  const live = [{ x: 0.5, y: 0.5, visibility: 1 }];
  const calls = [];
  const ghostLandmarks = [{ x: 0.1, y: 0.2, visibility: 1 }];
  const result = prepareLiveCaptureFrame({
    rawLandmarks: live,
    landmarkFilter: { smooth: (landmarks) => landmarks },
    exercise: { id: 'knee' },
    reference: { kind: 'motion_cycle' },
    mode: 'validate',
    previousBoundaryFrame: { previous: true },
    now: () => 1234,
    currentBoundary: () => ({ status: 'inside', nextFrame: { current: true } }),
    jointAngleCalculatorDetailedImpl: () => ({
      angles: { right_knee: 88 },
      meta: { usableJointRatio: 1 },
    }),
    validationProcessorFor: (exercise, reference) => {
      calls.push({ exercise, reference });
      return {
        processPracticeFrame: (frame) => ({
          snapshot: { overallScore: 62, cue: { text: 'Match reference' }, frame },
          ghostLandmarks,
        }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.snapshot.overallScore, 62);
  assert.equal(result.snapshot.frame.timestamp, 1234);
  assert.deepEqual(result.snapshot.frame.liveAngles, { right_knee: 88 });
  assert.deepEqual(result.snapshot.frame.angleMeta, { usableJointRatio: 1 });
  assert.deepEqual(result.snapshot.frame.previousBoundaryFrame, { previous: true });
  assert.equal(result.ghostLandmarks, ghostLandmarks);
  assert.deepEqual(result.colors, ['#9C7344', '#C8955A']);
});

test('prepareLiveCaptureFrameWithAi uses async validation classifier path when available', async () => {
  const live = [{ x: 0.5, y: 0.5, visibility: 1 }];
  const calls = [];
  const result = await prepareLiveCaptureFrameWithAi({
    rawLandmarks: live,
    landmarkFilter: { smooth: (landmarks) => landmarks },
    exercise: { id: 'shoulder', landmarkSchemaId: 'right_arm.v1' },
    reference: { kind: 'motion_cycle' },
    mode: 'validate',
    previousBoundaryFrame: { previous: true },
    now: () => 2222,
    currentBoundary: () => ({ status: 'inside', trainable: true, scoreable: true }),
    jointAngleCalculatorDetailedImpl: () => ({
      angles: { right_shoulder: 88 },
      meta: { usableJointRatio: 1 },
    }),
    validationProcessorFor: () => ({
      async processPracticeFrameWithAi(frame) {
        calls.push(frame);
        return {
          snapshot: {
            overallScore: 82,
            aiSignal: { phase: 'target', quality: 'good', confidence: 0.9 },
            aiRepCount: 1,
          },
        };
      },
    }),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].timestamp, 2222);
  assert.deepEqual(calls[0].liveAngles, { right_shoulder: 88 });
  assert.equal(result.snapshot.aiSignal.quality, 'good');
  assert.equal(result.snapshot.aiRepCount, 1);
  assert.deepEqual(result.colors, ['#2F5D50', '#7BA88F']);
});

test('prepareLiveCaptureFrame marks validation unavailable when reference cannot create a processor', () => {
  const result = prepareLiveCaptureFrame({
    rawLandmarks: [{ x: 0.5, y: 0.5, visibility: 1 }],
    exercise: { id: 'balance' },
    reference: { kind: 'hold_pose' },
    mode: 'validate',
    currentBoundary: () => ({ status: 'inside' }),
    jointAngleCalculatorDetailedImpl: () => ({ angles: {}, meta: {} }),
    validationProcessorFor: () => null,
  });

  assert.equal(result.hasPose, true);
  assert.equal(result.snapshot, null);
  assert.equal(result.validationUnavailable, true);
  assert.deepEqual(result.colors, CAPTURE_DEFAULT_COLORS);
});
