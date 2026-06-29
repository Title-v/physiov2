import { jointAngleCalculator } from '../ai/JointAngleCalculator.js';
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
  overlayJoints = null,
  timestampNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
} = {}) {
  function processPracticeFrame({
    landmarks = null,
    previousBoundaryFrame = null,
    boundary = null,
    liveAngles: inputLiveAngles = null,
    timestamp = timestampNow(),
  } = {}) {
    const nextBoundary = boundary || evaluateBoundaryBox(landmarks, previousBoundaryFrame, exercise, timestamp);
    const selectedOverlayJoints = overlayJoints || overlayJointsForExercise({ ...exercise, reference });

    if (!landmarks) {
      return {
        hasPose: false,
        boundary: nextBoundary,
        nextBoundaryFrame: nextBoundary?.nextFrame || null,
        liveAngles: null,
        snapshot: null,
        overlayJoints: selectedOverlayJoints,
        ghostLandmarks: null,
      };
    }

    const liveAngles = inputLiveAngles || jointAngleCalculator(landmarks);
    const snapshot = motionEngine
      ? motionEngine.pushFrame({ timestamp, landmarks, jointAngles: liveAngles, boundary: nextBoundary })
      : null;

    return {
      hasPose: true,
      boundary: nextBoundary,
      nextBoundaryFrame: nextBoundary?.nextFrame || null,
      liveAngles,
      snapshot,
      overlayJoints: selectedOverlayJoints,
      ghostLandmarks: ghostLandmarksForSnapshot(reference, snapshot),
    };
  }

  return {
    exercise,
    reference,
    motionEngine,
    processPracticeFrame,
  };
}
