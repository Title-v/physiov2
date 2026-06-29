export const SEQUENCE_MIN_FRAMES = 8;

export function formatMs(ms) {
  const sec = Math.max(0, Number(ms) || 0) / 1000;
  return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
}

export function sequenceFrameTime(sequence, idx) {
  const frame = sequence?.frames?.[idx];
  return Number(frame?.t) || 0;
}

export function sequenceDuration(sequence, startIdx = 0, endIdx = null) {
  if (!sequence?.frames?.length) return 0;
  const lastIdx = endIdx == null ? sequence.frames.length - 1 : endIdx;
  return Math.max(0, sequenceFrameTime(sequence, lastIdx) - sequenceFrameTime(sequence, startIdx));
}

export function pendingSequenceIndexes(sequence) {
  const n = sequence?.frames?.length || 0;
  const maxIdx = n - 1;
  if (n <= 0) return { startIdx: 0, targetIdx: 0, endIdx: 0 };
  let startIdx = Number.isFinite(sequence.startIdx) ? Math.round(sequence.startIdx) : 0;
  let endIdx = Number.isFinite(sequence.endIdx) ? Math.round(sequence.endIdx) : maxIdx;
  startIdx = Math.max(0, Math.min(maxIdx, startIdx));
  endIdx = Math.max(0, Math.min(maxIdx, endIdx));
  if (endIdx < startIdx) [startIdx, endIdx] = [endIdx, startIdx];
  if (endIdx - startIdx < 2 && n >= 3) {
    startIdx = Math.max(0, Math.min(startIdx, maxIdx - 2));
    endIdx = Math.min(maxIdx, Math.max(endIdx, startIdx + 2));
  }
  let targetIdx = Number.isFinite(sequence.targetIdx)
    ? Math.round(sequence.targetIdx)
    : Math.round((startIdx + endIdx) / 2);
  if (endIdx > startIdx) targetIdx = Math.max(startIdx + 1, Math.min(endIdx - 1, targetIdx));
  else targetIdx = startIdx;
  return { startIdx, targetIdx, endIdx };
}

export function applySequenceTrim(sequence, which, rawValue) {
  if (!sequence?.frames?.length) return pendingSequenceIndexes(sequence);
  const maxIdx = sequence.frames.length - 1;
  const value = Math.max(0, Math.min(maxIdx, Math.round(Number(rawValue))));
  const current = pendingSequenceIndexes(sequence);
  const minGap = 1;
  if (which === 'start') {
    sequence.startIdx = Math.min(value, current.targetIdx - minGap);
    sequence.targetIdx = current.targetIdx;
    sequence.endIdx = current.endIdx;
  } else if (which === 'target') {
    sequence.startIdx = current.startIdx;
    sequence.targetIdx = Math.max(current.startIdx + minGap, Math.min(current.endIdx - minGap, value));
    sequence.endIdx = current.endIdx;
  } else {
    sequence.startIdx = current.startIdx;
    sequence.targetIdx = current.targetIdx;
    sequence.endIdx = Math.max(value, current.targetIdx + minGap);
  }
  const next = pendingSequenceIndexes(sequence);
  sequence.startIdx = next.startIdx;
  sequence.targetIdx = next.targetIdx;
  sequence.endIdx = next.endIdx;
  return next;
}

export function selectedSequenceRange(sequence) {
  const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
  const frames = (sequence?.frames || []).slice(startIdx, endIdx + 1);
  return { startIdx, targetIdx, endIdx, targetOffset: Math.max(0, targetIdx - startIdx), frames };
}

export function selectedSequenceFrames(sequence) {
  return selectedSequenceRange(sequence).frames;
}

export function inferSequenceTargetIndex(frames, { candidateJoints = [], fallbackJoints = [] } = {}) {
  if (!Array.isArray(frames) || frames.length < 3) return 0;
  const restAngles = frames[0]?.jointAngles || {};
  const joints = (candidateJoints.length ? candidateJoints : fallbackJoints)
    .filter((joint) => Number.isFinite(restAngles[joint]));
  if (!joints.length) return Math.max(1, Math.floor((frames.length - 1) / 2));
  let bestIdx = Math.max(1, Math.floor((frames.length - 1) / 2));
  let bestScore = -Infinity;
  for (let i = 1; i < frames.length - 1; i++) {
    let sum = 0;
    let n = 0;
    for (const joint of joints) {
      const value = frames[i]?.jointAngles?.[joint];
      const rest = restAngles[joint];
      if (!Number.isFinite(value) || !Number.isFinite(rest)) continue;
      sum += Math.abs(value - rest);
      n++;
    }
    const score = n ? sum / n : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function createSequenceRecording({ exerciseId, bodyRegionFlag, angleOverlayJoints = [], startedAt }) {
  return {
    exerciseId,
    bodyRegionFlag,
    angleOverlayJoints: [...angleOverlayJoints],
    startedAt,
    frames: [],
  };
}

export function sequenceStartProblem({
  exercise = {},
  bodyRegionFlag = null,
  cameraOn = false,
  engineReady = false,
  canRecord = () => true,
} = {}) {
  if (!bodyRegionFlag) return 'missing_body_region';
  if (!cameraOn || !engineReady) return 'camera_not_ready';
  if (!canRecord(exercise)) return 'unsupported_exercise';
  return null;
}

export function beginSequenceRecordingState(state, {
  exerciseId,
  bodyRegionFlag,
  angleOverlayJoints = [],
  startedAt,
} = {}) {
  state.captureDraft = null;
  state.pendingSequence = null;
  state.previewFrameIdx = null;
  state.recording = createSequenceRecording({
    exerciseId,
    bodyRegionFlag,
    angleOverlayJoints,
    startedAt,
  });
  return state.recording;
}

export function appendSequenceRecordingFrame(recording, { landmarks, jointAngles, boundary, now, cleanAngles, cleanLandmarks }) {
  if (!recording) return false;
  if (boundary?.status !== 'inside') return false;
  recording.frames.push({
    t: Math.round(now - recording.startedAt),
    jointAngles: cleanAngles(jointAngles),
    landmarks: cleanLandmarks(landmarks),
  });
  return true;
}

export function finalizeSequenceRecording(recording, { exerciseId, candidateJoints = [], fallbackJoints = [] } = {}) {
  if (!recording || recording.exerciseId !== exerciseId) return { ok: false, reason: 'wrong_exercise' };
  if (recording.frames.length < SEQUENCE_MIN_FRAMES) return { ok: false, reason: 'too_short' };
  const targetIdx = inferSequenceTargetIndex(recording.frames, { candidateJoints, fallbackJoints });
  return {
    ok: true,
    targetIdx,
    pendingSequence: {
      exerciseId,
      bodyRegionFlag: recording.bodyRegionFlag,
      angleOverlayJoints: recording.angleOverlayJoints,
      frames: recording.frames,
      startIdx: 0,
      targetIdx,
      endIdx: recording.frames.length - 1,
    },
  };
}

export function finishSequenceRecordingState(state, {
  exerciseId,
  candidateJoints = [],
  fallbackJoints = [],
} = {}) {
  const recording = state.recording;
  state.recording = null;
  const result = finalizeSequenceRecording(recording, { exerciseId, candidateJoints, fallbackJoints });
  if (result.ok) {
    state.pendingSequence = result.pendingSequence;
    state.previewFrameIdx = result.targetIdx;
  }
  return result;
}
