export const AI_REP_PHASES = Object.freeze({
  REST: 'rest',
  MOVING_TO_TARGET: 'moving_to_target',
  TARGET: 'target',
  RETURNING: 'returning',
});

const QUALITY_RANK = Object.freeze({
  good: 4,
  unstable: 3,
  incomplete: 2,
  wrong_path: 1,
});

function qualityScore(quality) {
  return QUALITY_RANK[quality] || 0;
}

function worseQuality(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return qualityScore(b) < qualityScore(a) ? b : a;
}

export function createAiPhaseRepCounter({
  minConfidence = 0.75,
  minTargetFrames = 3,
  minRestFrames = 3,
} = {}) {
  let reps = 0;
  let state = AI_REP_PHASES.REST;
  let targetFrames = 0;
  let restFrames = 0;
  let rejectedFrames = 0;
  let startedAt = null;
  let worstQuality = null;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let lastCompletedRep = null;

  function resetCurrent({ keepState = false } = {}) {
    if (!keepState) state = AI_REP_PHASES.REST;
    targetFrames = 0;
    restFrames = 0;
    rejectedFrames = 0;
    startedAt = null;
    worstQuality = null;
    confidenceSum = 0;
    confidenceCount = 0;
  }

  function snapshot(completedRep = null) {
    return {
      reps,
      currentPhase: state,
      completedRep,
      rejectedFrames,
    };
  }

  function push({
    phase = null,
    quality = null,
    confidence = 0,
    safetyOk = true,
    timestamp = Date.now(),
  } = {}) {
    lastCompletedRep = null;
    const conf = Number(confidence);
    if (!safetyOk) {
      rejectedFrames += 1;
      if (state !== AI_REP_PHASES.REST) resetCurrent();
      return snapshot();
    }
    if (!Number.isFinite(conf) || conf < minConfidence || !Object.values(AI_REP_PHASES).includes(phase)) {
      return snapshot();
    }

    confidenceSum += conf;
    confidenceCount += 1;
    worstQuality = worseQuality(worstQuality, quality || 'good');

    if (state === AI_REP_PHASES.REST) {
      if (phase === AI_REP_PHASES.MOVING_TO_TARGET) {
        state = AI_REP_PHASES.MOVING_TO_TARGET;
        startedAt = timestamp;
        restFrames = 0;
      } else if (phase === AI_REP_PHASES.REST) {
        restFrames += 1;
      }
      return snapshot();
    }

    if (state === AI_REP_PHASES.MOVING_TO_TARGET) {
      if (phase === AI_REP_PHASES.TARGET) targetFrames += 1;
      else if (phase === AI_REP_PHASES.REST) resetCurrent();
      if (targetFrames >= minTargetFrames) {
        state = AI_REP_PHASES.TARGET;
      }
      return snapshot();
    }

    if (state === AI_REP_PHASES.TARGET) {
      if (phase === AI_REP_PHASES.RETURNING) {
        state = AI_REP_PHASES.RETURNING;
        restFrames = 0;
      }
      return snapshot();
    }

    if (state === AI_REP_PHASES.RETURNING) {
      if (phase === AI_REP_PHASES.REST) restFrames += 1;
      else if (phase === AI_REP_PHASES.TARGET) restFrames = 0;
      if (restFrames >= minRestFrames) {
        reps += 1;
        lastCompletedRep = {
          index: reps,
          startedAt,
          endedAt: timestamp,
          quality: worstQuality || 'good',
          confidence: confidenceCount ? confidenceSum / confidenceCount : 0,
        };
        resetCurrent();
      }
    }

    return snapshot(lastCompletedRep);
  }

  return {
    push,
    reset: () => {
      reps = 0;
      lastCompletedRep = null;
      resetCurrent();
    },
    getSnapshot: () => snapshot(lastCompletedRep),
  };
}
