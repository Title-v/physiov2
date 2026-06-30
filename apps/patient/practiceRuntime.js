import { createPoseEngine, makeDrawer, startCamera, stopCamera } from '../../shared/ai/PoseDetection.js';
import { drawBoundaryBox } from '../../shared/ai/BoundaryBoxGate.js';
import { drawAngleOverlayForJoints } from '../../shared/ai/AngleOverlay.js';
import { createEmaLandmarkFilter } from '../../shared/ai/LandmarkFilters.js';
import { createMotionQualityEngine } from '../../shared/ai/MotionQualityEngine.js';
import { createMotionTcnModelRegistry } from '../../shared/ai/MotionTcnRuntime.js';
import { createTcnMotionClassifier } from '../../shared/ai/TcnMotionClassifier.js';
import { createPracticeFrameProcessor } from '../../shared/practice/frame.js';
import { practiceDose } from '../../shared/core/patient-exercises.js';

function defaultNow() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function resizeCanvas(canvas) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(1, globalThis.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
}

export function createPatientPracticeRuntime({
  poseEngine = createPoseEngine(),
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  now = defaultNow,
  dateNow = () => Date.now(),
  isActive = () => true,
  scoreTone = () => '#2F5D50',
  colors = {},
  onStatus = () => {},
  onFrame = () => {},
  onError = () => {},
  cameraStart = startCamera,
  cameraStop = stopCamera,
  makePoseDrawer = makeDrawer,
  drawBoundary = drawBoundaryBox,
  drawAngles = drawAngleOverlayForJoints,
  motionEngineFactory = createMotionQualityEngine,
  frameProcessorFactory = createPracticeFrameProcessor,
  landmarkFilterFactory = createEmaLandmarkFilter,
  modelRegistryFactory = createMotionTcnModelRegistry,
  motionClassifierFactory = createTcnMotionClassifier,
} = {}) {
  const state = {
    running: false,
    raf: 0,
    video: null,
    canvas: null,
    drawer: null,
    motionEngine: null,
    frameProcessor: null,
    modelRegistry: null,
    motionClassifier: null,
    landmarkFilter: null,
    reference: null,
    snapshot: null,
    boundaryFrame: null,
    lastVideoTime: -1,
    startedAt: 0,
    frameCount: 0,
    processingFrame: false,
    exercise: null,
  };

  function stop() {
    if (state.raf) cancelFrame(state.raf);
    state.raf = 0;
    state.running = false;
    if (state.video) cameraStop(state.video);
    state.video = null;
    state.canvas = null;
    state.drawer = null;
    state.motionEngine = null;
    state.frameProcessor = null;
    state.modelRegistry = null;
    state.motionClassifier = null;
    state.landmarkFilter?.reset();
    state.landmarkFilter = null;
    state.reference = null;
    state.snapshot = null;
    state.boundaryFrame = null;
    state.lastVideoTime = -1;
    state.startedAt = 0;
    state.frameCount = 0;
    state.processingFrame = false;
    state.exercise = null;
  }

  function modelBaseUrlForExercise(exercise = {}) {
    if (exercise.modelBaseUrl) return exercise.modelBaseUrl;
    if (exercise.modelUrl) return exercise.modelUrl;
    if (exercise.activeModelId) return `/shared/models/${exercise.activeModelId}`;
    return undefined;
  }

  function renderProcessedFrame(result, landmarks) {
    const canvas = state.canvas;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !result) return;
    resizeCanvas(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.boundaryFrame = result.nextBoundaryFrame;
    if (!result.hasPose) {
      drawBoundary(ctx, result.boundary);
      onStatus('ถอยออกเพื่อให้เห็นตัวคุณ');
      return;
    }

    const { boundary, liveAngles, snapshot, overlayJoints, ghostLandmarks } = result;
    if (!snapshot) return;
    state.snapshot = snapshot;
    state.frameCount += 1;
    if (ghostLandmarks) state.drawer(ghostLandmarks, { ghost: true });
    state.drawer(landmarks, {
      color: scoreTone(snapshot.overallScore || 0),
      accent: snapshot.overallScore >= 50 ? colors.brand : colors.bad,
    });
    drawBoundary(ctx, boundary);
    drawAngles(ctx, landmarks, liveAngles, overlayJoints, { lang: 'th' });
    onStatus(boundary.status === 'inside' ? `${landmarks.length} pts · ${snapshot.phase}` : boundary.hintTh || boundary.hint);
    onFrame({ exercise: state.exercise, boundary, liveAngles, snapshot, overlayJoints, ghostLandmarks });
  }

  async function processFrame(landmarks) {
    if (!state.frameProcessor || state.processingFrame) return;
    state.processingFrame = true;
    try {
      const frameArgs = {
        landmarks,
        previousBoundaryFrame: state.boundaryFrame,
        timestamp: now(),
      };
      const result = typeof state.frameProcessor.processPracticeFrameWithAi === 'function'
        ? await state.frameProcessor.processPracticeFrameWithAi(frameArgs)
        : state.frameProcessor.processPracticeFrame(frameArgs);
      if (!state.running) return;
      renderProcessedFrame(result, landmarks);
    } catch (error) {
      onError(error);
      const result = state.frameProcessor.processPracticeFrame({
        landmarks,
        previousBoundaryFrame: state.boundaryFrame,
        timestamp: now(),
      });
      if (state.running) renderProcessedFrame(result, landmarks);
    } finally {
      state.processingFrame = false;
    }
  }

  function loop() {
    if (!state.running || !isActive(state.exercise)) return;
    const video = state.video;
    if (poseEngine.state.ready && video && video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const result = poseEngine.detectVideo(video, now());
      const rawLandmarks = result?.landmarks?.[0] || null;
      const landmarks = rawLandmarks ? state.landmarkFilter?.smooth(rawLandmarks) || rawLandmarks : null;
      if (!landmarks) state.landmarkFilter?.reset();
      processFrame(landmarks);
    }
    state.raf = requestFrame(loop);
  }

  async function start({ exercise, reference, video, canvas }) {
    stop();
    if (!video || !canvas || !exercise || !reference) return false;
    state.video = video;
    state.canvas = canvas;
    state.exercise = exercise;
    state.reference = reference;
    state.drawer = makePoseDrawer(canvas.getContext('2d'));
    state.motionEngine = motionEngineFactory({
      exercise,
      reference,
      dose: practiceDose(exercise),
      lang: 'th',
    });
    state.modelRegistry = modelRegistryFactory({
      baseUrl: modelBaseUrlForExercise(exercise),
    });
    state.motionClassifier = motionClassifierFactory({
      registry: state.modelRegistry,
      modelName: 'motion-tcn',
      extractorOptions: {
        landmarkSchemaId: exercise.landmarkSchemaId,
      },
    });
    state.frameProcessor = frameProcessorFactory({
      exercise,
      reference,
      motionEngine: state.motionEngine,
      motionClassifier: state.motionClassifier,
      classifierOptions: {
        landmarkSchemaId: exercise.landmarkSchemaId,
      },
    });
    state.landmarkFilter = landmarkFilterFactory({
      minVisibility: exercise.minVisibility ?? 0.35,
    });
    state.startedAt = dateNow();
    resizeCanvas(canvas);
    onStatus('กำลังเปิดกล้อง...');
    try {
      await cameraStart(video, { facingMode: 'user' });
      if (!isActive(exercise)) {
        cameraStop(video);
        return false;
      }
      if (!poseEngine.state.ready) await poseEngine.init('full');
      if (!isActive(exercise)) {
        cameraStop(video);
        return false;
      }
      state.running = true;
      onStatus('ขยับตาม reference ได้เลย');
      state.raf = requestFrame(loop);
      return true;
    } catch (error) {
      onStatus('เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้อง');
      onError(error);
      return false;
    }
  }

  function finish() {
    if (!state.motionEngine) return null;
    const run = {
      exercise: state.exercise,
      reference: state.reference,
      snapshot: state.snapshot,
      summary: state.motionEngine.finishSummary(),
      frameCount: state.frameCount,
      startedAt: state.startedAt,
    };
    stop();
    return run;
  }

  return {
    poseEngine,
    start,
    stop,
    reset: stop,
    finish,
    resizeCanvas: () => resizeCanvas(state.canvas),
    isRunning: () => state.running,
    getState: () => state,
  };
}
