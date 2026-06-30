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

test('createPatientPracticeRuntime feeds patient frames through optional AI classifier path', async () => {
  let rafCallback = null;
  let classifierCalled = false;
  let processorReceivedClassifier = false;
  let modelBaseUrl = null;
  const frames = [];
  const poseEngine = {
    state: { ready: true },
    init: async () => {},
    detectVideo: () => ({ landmarks: [[{ x: 0.5, y: 0.5, visibility: 1 }]] }),
  };
  const runtime = createPatientPracticeRuntime({
    poseEngine,
    requestFrame: (fn) => {
      rafCallback = fn;
      return 1;
    },
    cancelFrame: () => {},
    cameraStart: async () => {},
    cameraStop: () => {},
    makePoseDrawer: () => () => {},
    drawBoundary: () => {},
    drawAngles: () => {},
    motionEngineFactory: () => ({ finishSummary: () => ({ overallScore: 88 }) }),
    modelRegistryFactory: ({ baseUrl }) => {
      modelBaseUrl = baseUrl;
      return { baseUrl, load: async () => null };
    },
    motionClassifierFactory: ({ registry, extractorOptions }) => ({
      registry,
      extractorOptions,
      async predict() {
        classifierCalled = true;
        return { phase: 'moving_to_target', quality: 'good', confidence: 0.92 };
      },
    }),
    frameProcessorFactory: ({ motionClassifier, classifierOptions }) => {
      processorReceivedClassifier = !!motionClassifier && classifierOptions.landmarkSchemaId === 'right_arm.v1';
      return {
        async processPracticeFrameWithAi(args) {
          const aiSignal = await motionClassifier.predict([args]);
          return {
            hasPose: true,
            boundary: { status: 'inside' },
            nextBoundaryFrame: { x: 0.1 },
            liveAngles: { right_shoulder: 90 },
            snapshot: { phase: aiSignal.phase, overallScore: 92, aiSignal },
            overlayJoints: ['right_shoulder'],
            ghostLandmarks: null,
          };
        },
        processPracticeFrame: () => {
          throw new Error('sync fallback should not be used');
        },
      };
    },
    landmarkFilterFactory: () => ({ smooth: (landmarks) => landmarks, reset: () => {} }),
    onFrame: (frame) => frames.push(frame),
  });

  const started = await runtime.start({
    exercise: {
      id: 'shoulder',
      reps: 1,
      sets: 1,
      landmarkSchemaId: 'right_arm.v1',
      activeModelId: 'right_arm_tcn_v1',
    },
    reference: { kind: 'motion_cycle', referenceSequence: { frames: [{ p: 0 }, { p: 1 }] } },
    video: { currentTime: 1 },
    canvas: fakeCanvas(),
  });
  await rafCallback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started, true);
  assert.equal(modelBaseUrl, '/shared/models/right_arm_tcn_v1');
  assert.equal(processorReceivedClassifier, true);
  assert.equal(classifierCalled, true);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].snapshot.aiSignal.quality, 'good');
  assert.equal(runtime.getState().boundaryFrame.x, 0.1);
});
