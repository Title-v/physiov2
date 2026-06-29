import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatientPracticeRuntime } from '../../apps/patient/practiceRuntime.js';

function fakeCanvas() {
  return {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 320, height: 240 }),
    getContext: () => ({
      clearRect: () => {},
      canvas: { width: 320, height: 240 },
    }),
  };
}

test('createPatientPracticeRuntime starts camera/model and returns a session run on finish', async () => {
  const statuses = [];
  let cameraStarted = false;
  let cameraStopped = false;
  let modelInitialized = false;
  const poseEngine = {
    state: { ready: false },
    init: async () => {
      modelInitialized = true;
      poseEngine.state.ready = true;
    },
    detectVideo: () => ({ landmarks: [[{ x: 0.5, y: 0.5, visibility: 1 }]] }),
  };
  const runtime = createPatientPracticeRuntime({
    poseEngine,
    requestFrame: () => 1,
    cancelFrame: () => {},
    cameraStart: async () => { cameraStarted = true; },
    cameraStop: () => { cameraStopped = true; },
    makePoseDrawer: () => () => {},
    motionEngineFactory: () => ({
      finishSummary: () => ({ overallScore: 91, reps: 1, validReps: 1, invalidRepCount: 0 }),
    }),
    frameProcessorFactory: () => ({
      processPracticeFrame: () => ({ hasPose: false, boundary: { status: 'outside' }, nextBoundaryFrame: null }),
    }),
    landmarkFilterFactory: () => ({ smooth: (landmarks) => landmarks, reset: () => {} }),
    onStatus: (text) => statuses.push(text),
  });

  const exercise = { id: 'shoulder', reps: 1, sets: 1 };
  const reference = { kind: 'motion_cycle', referenceSequence: { frames: [{ p: 0 }, { p: 1 }] } };
  const started = await runtime.start({ exercise, reference, video: { currentTime: 0 }, canvas: fakeCanvas() });
  const run = runtime.finish();

  assert.equal(started, true);
  assert.equal(cameraStarted, true);
  assert.equal(modelInitialized, true);
  assert.equal(cameraStopped, true);
  assert.equal(runtime.isRunning(), false);
  assert.equal(run.exercise, exercise);
  assert.equal(run.reference, reference);
  assert.equal(run.summary.overallScore, 91);
  assert.equal(statuses.includes('กำลังเปิดกล้อง...'), true);
  assert.equal(statuses.includes('ขยับตาม reference ได้เลย'), true);
});

test('createPatientPracticeRuntime stops camera when active guard fails after permission', async () => {
  let stopped = false;
  const poseEngine = {
    state: { ready: true },
    init: async () => {},
  };
  const runtime = createPatientPracticeRuntime({
    poseEngine,
    isActive: () => false,
    cameraStart: async () => {},
    cameraStop: () => { stopped = true; },
    makePoseDrawer: () => () => {},
    motionEngineFactory: () => ({ finishSummary: () => ({ overallScore: 0 }) }),
    frameProcessorFactory: () => ({ processPracticeFrame: () => ({ hasPose: false }) }),
    landmarkFilterFactory: () => ({ smooth: (landmarks) => landmarks, reset: () => {} }),
  });

  const started = await runtime.start({
    exercise: { id: 'shoulder' },
    reference: { kind: 'motion_cycle' },
    video: { currentTime: 0 },
    canvas: fakeCanvas(),
  });

  assert.equal(started, false);
  assert.equal(stopped, true);
});
