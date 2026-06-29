import { jointAngleCalculatorDetailed } from '../ai/JointAngleCalculator.js';
import { evaluateBoundaryBox } from '../ai/BoundaryBoxGate.js';
import { overlayJointsForExercise } from '../core/patient-exercises.js';

export function ghostLandmarksForSnapshot(reference, snapshot) {
  if (!reference) return null;
  if (snapshot?.activeSide && reference.targetLandmarksBySide?.[snapshot.activeSide]) {
    return reference.targetLandmarksBySide[snapshot.activeSide];
  }
  return reference.holdTargetLandmarks || reference.targetLandmarks || reference.landmarks || null;
}

export function createPracticeFrameProcessor({
  exercise = {},
  reference = null,
  motionEngine = null,
  motionClassifier = null,
  classifierWindowSize = 30,
  classifierOptions = {},
  overlayJoints = null,
  timestampNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
} = {}) {
  let classifierWindow = [];

  function noPoseResult(nextBoundary, selectedOverlayJoints) {
    return {
      hasPose: false,
      boundary: nextBoundary,
      nextBoundaryFrame: nextBoundary?.nextFrame || null,
      liveAngles: null,
      snapshot: null,
      overlayJoints: selectedOverlayJoints,
      ghostLandmarks: null,
      aiSignal: null,
    };
  }

  function preparePracticeFrame({
    landmarks = null,
    previousBoundaryFrame = null,
    boundary = null,
    liveAngles: inputLiveAngles = null,
    angleMeta: inputAngleMeta = null,
    timestamp = timestampNow(),
  } = {}) {
    const nextBoundary = boundary || evaluateBoundaryBox(landmarks, previousBoundaryFrame, exercise, timestamp);
    const selectedOverlayJoints = overlayJoints || overlayJointsForExercise({ ...exercise, reference });

    if (!landmarks) {
      classifierWindow = [];
      return noPoseResult(nextBoundary, selectedOverlayJoints);
    }

    const angleResult = inputLiveAngles
      ? { angles: inputLiveAngles, meta: inputAngleMeta }
      : jointAngleCalculatorDetailed(landmarks, {
        minVisibility: exercise.minVisibility,
        use3D: exercise.allow3D,
      });
    const liveAngles = angleResult.angles;
    const angleMeta = angleResult.meta;
    return {
      hasPose: true,
      timestamp,
      landmarks,
      boundary: nextBoundary,
      nextBoundaryFrame: nextBoundary?.nextFrame || null,
      liveAngles,
      angleMeta,
      overlayJoints: selectedOverlayJoints,
    };
  }

  function commitPracticeFrame(prepared, aiSignal = null) {
    if (!prepared?.hasPose) return prepared;
    const snapshot = motionEngine
      ? motionEngine.pushFrame({
        timestamp: prepared.timestamp,
        landmarks: prepared.landmarks,
        jointAngles: prepared.liveAngles,
        angleMeta: prepared.angleMeta,
        boundary: prepared.boundary,
        aiSignal,
      })
      : null;

    return {
      hasPose: true,
      boundary: prepared.boundary,
      nextBoundaryFrame: prepared.nextBoundaryFrame,
      liveAngles: prepared.liveAngles,
      angleMeta: prepared.angleMeta,
      snapshot,
      overlayJoints: prepared.overlayJoints,
      ghostLandmarks: ghostLandmarksForSnapshot(reference, snapshot),
      aiSignal,
    };
  }

  function processPracticeFrame(args = {}) {
    const prepared = preparePracticeFrame(args);
    return commitPracticeFrame(prepared, args.aiSignal || null);
  }

  async function processPracticeFrameWithAi(args = {}) {
    const prepared = preparePracticeFrame(args);
    if (!prepared.hasPose) return prepared;
    let aiSignal = args.aiSignal || null;
    const safetyOk = prepared.boundary?.scoreable !== false && prepared.boundary?.trainable !== false;
    if (!safetyOk) {
      aiSignal = null;
      classifierWindow = [];
    } else if (!aiSignal && typeof motionClassifier?.predict === 'function') {
      classifierWindow.push({
        t: prepared.timestamp,
        timestamp: prepared.timestamp,
        landmarks: prepared.landmarks,
        jointAngles: prepared.liveAngles,
        angles: prepared.liveAngles,
        boundaryStatus: prepared.boundary?.status || 'unknown',
        landmarkSchemaId: prepared.boundary?.landmarkSchemaId || exercise.landmarkSchemaId,
        dataQuality: prepared.boundary?.dataQuality || null,
      });
      classifierWindow = classifierWindow.slice(-Math.max(1, classifierWindowSize));
      aiSignal = await motionClassifier.predict(classifierWindow.slice(), {
        exercise,
        landmarkSchemaId: prepared.boundary?.landmarkSchemaId || exercise.landmarkSchemaId,
        ...classifierOptions,
      }).catch(() => null);
    }
    return commitPracticeFrame(prepared, aiSignal);
  }

  function resetAiWindow() {
    classifierWindow = [];
  }

  return {
    exercise,
    reference,
    motionEngine,
    processPracticeFrame,
    processPracticeFrameWithAi,
    resetAiWindow,
  };
}
