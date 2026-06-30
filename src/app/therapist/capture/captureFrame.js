import { jointAngleCalculatorDetailed } from '../../../../shared/ai/JointAngleCalculator.js';
import { validationScoreColors } from './validationController.js';

export const CAPTURE_DEFAULT_COLORS = ['#2F5D50', '#7BA88F'];

function defaultNow() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function validationFrameArgs({
  timestamp,
  live,
  previousBoundaryFrame,
  liveAngles,
  angleMeta,
  boundary,
}) {
  return {
    timestamp,
    landmarks: live,
    previousBoundaryFrame,
    liveAngles,
    angleMeta,
    boundary,
  };
}

function withValidationFrame(base, validationFrame) {
  const snapshot = validationFrame?.snapshot || null;
  return {
    ...base,
    validationFrame,
    snapshot,
    ghostLandmarks: validationFrame?.ghostLandmarks || null,
    colors: snapshot ? validationScoreColors(snapshot.overallScore) : base.colors,
    validationUnavailable: false,
  };
}

export function prepareLiveCaptureFrame({
  rawLandmarks = null,
  landmarkFilter = null,
  exercise = {},
  reference = null,
  mode = 'setup',
  previousBoundaryFrame = null,
  currentBoundary,
  validationProcessorFor = () => null,
  jointAngleCalculatorDetailedImpl = jointAngleCalculatorDetailed,
  now = defaultNow,
} = {}) {
  const live = rawLandmarks ? landmarkFilter?.smooth(rawLandmarks) || rawLandmarks : null;
  if (!live) {
    landmarkFilter?.reset();
    return {
      hasPose: false,
      live: null,
      boundary: currentBoundary(null, { reset: true }),
      liveAngles: null,
      angleMeta: null,
      validationFrame: null,
      snapshot: null,
      ghostLandmarks: null,
      colors: CAPTURE_DEFAULT_COLORS,
      validationUnavailable: false,
    };
  }

  const boundary = currentBoundary(live);
  const angleResult = jointAngleCalculatorDetailedImpl(live, {
    minVisibility: exercise?.minVisibility,
    use3D: exercise?.allow3D,
  });
  const liveAngles = angleResult.angles;
  const angleMeta = angleResult.meta;
  let validationFrame = null;
  let snapshot = null;
  let ghostLandmarks = null;
  let colors = CAPTURE_DEFAULT_COLORS;
  let validationUnavailable = false;

  if (reference && mode === 'validate') {
    const validationProcessor = validationProcessorFor(exercise, reference);
    if (validationProcessor) {
      validationFrame = validationProcessor.processPracticeFrame({
        timestamp: now(),
        landmarks: live,
        previousBoundaryFrame,
        liveAngles,
        angleMeta,
        boundary,
      });
      snapshot = validationFrame.snapshot;
      ghostLandmarks = validationFrame.ghostLandmarks || null;
      if (snapshot) colors = validationScoreColors(snapshot.overallScore);
    } else {
      validationUnavailable = true;
    }
  }

  return {
    hasPose: true,
    live,
    boundary,
    liveAngles,
    angleMeta,
    validationFrame,
    snapshot,
    ghostLandmarks,
    colors,
    validationUnavailable,
  };
}

export async function prepareLiveCaptureFrameWithAi(options = {}) {
  const base = prepareLiveCaptureFrame({
    ...options,
    mode: 'setup',
    reference: null,
  });
  if (!base.hasPose) return base;
  if (!options.reference || options.mode !== 'validate') return base;

  const validationProcessor = options.validationProcessorFor?.(options.exercise || {}, options.reference);
  if (!validationProcessor) {
    return {
      ...base,
      validationUnavailable: true,
    };
  }
  const args = validationFrameArgs({
    timestamp: (options.now || defaultNow)(),
    live: base.live,
    previousBoundaryFrame: options.previousBoundaryFrame,
    liveAngles: base.liveAngles,
    angleMeta: base.angleMeta,
    boundary: base.boundary,
  });
  const validationFrame = typeof validationProcessor.processPracticeFrameWithAi === 'function'
    ? await validationProcessor.processPracticeFrameWithAi(args)
    : validationProcessor.processPracticeFrame(args);
  return withValidationFrame(base, validationFrame);
}
