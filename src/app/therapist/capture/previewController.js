import {
  applySequenceTrim,
  pendingSequenceIndexes,
  selectedSequenceRange,
  sequenceDuration,
  sequenceFrameTime,
} from './sequenceRecorder.js';
import {
  buildMotionDatasetRowFromSkeletonPayload,
  motionDatasetRowToJsonl,
} from '../../../../shared/ai/MotionDataset.js';

export function stopClipPlaybackState(state, cancelFrame = null) {
  state.previewPlaying = false;
  state.previewLastAt = 0;
  if (state.previewRaf && typeof cancelFrame === 'function') cancelFrame(state.previewRaf);
  state.previewRaf = 0;
}

export function clipPreviewIndex(state, sequence) {
  if (!sequence?.frames?.length) return 0;
  const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
  const fallback = Number.isFinite(state.previewFrameIdx) ? state.previewFrameIdx : targetIdx;
  return Math.max(startIdx, Math.min(endIdx, Math.round(fallback)));
}

export function sequenceMarkerLabel(sequence, idx, lang = 'en') {
  const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
  if (idx === startIdx) return lang === 'th' ? 'Rest เริ่ม' : 'Start rest';
  if (idx === targetIdx) return 'Target / peak';
  if (idx === endIdx) return lang === 'th' ? 'Rest จบ' : 'End rest';
  return lang === 'th' ? 'Preview' : 'Preview';
}

export function setClipPreviewIndexState(state, sequence, idx) {
  if (!sequence?.frames?.length) return 0;
  const { startIdx, endIdx } = pendingSequenceIndexes(sequence);
  state.previewFrameIdx = Math.max(startIdx, Math.min(endIdx, Math.round(Number(idx))));
  return state.previewFrameIdx;
}

export function jumpClipPreviewIndex(sequence, which) {
  const indexes = pendingSequenceIndexes(sequence);
  return which === 'start' ? indexes.startIdx : which === 'target' ? indexes.targetIdx : indexes.endIdx;
}

export function setSequenceMarkerFromPreviewIndex(sequence, which, previewIndex) {
  return applySequenceTrim(sequence, which, previewIndex);
}

export function startClipPlaybackState(state, sequence) {
  if (!sequence?.frames?.length) return false;
  const { startIdx, endIdx } = pendingSequenceIndexes(sequence);
  if (clipPreviewIndex(state, sequence) >= endIdx) state.previewFrameIdx = startIdx;
  state.previewPlaying = true;
  state.previewLastAt = 0;
  return true;
}

export function stepClipPlaybackState(state, sequence, now) {
  if (!state.previewPlaying || !sequence?.frames?.length) {
    return { active: false, done: false, index: clipPreviewIndex(state, sequence) };
  }
  const { startIdx, endIdx } = pendingSequenceIndexes(sequence);
  const currentIdx = clipPreviewIndex(state, sequence);
  if (!state.previewLastAt) state.previewLastAt = now;
  const nextT = sequenceFrameTime(sequence, currentIdx) + Math.max(0, now - state.previewLastAt);
  let nextIdx = currentIdx;
  while (nextIdx < endIdx && sequenceFrameTime(sequence, nextIdx) < nextT) nextIdx++;
  state.previewFrameIdx = Math.max(startIdx, Math.min(endIdx, nextIdx));
  state.previewLastAt = now;
  return {
    active: true,
    done: state.previewFrameIdx >= endIdx,
    index: state.previewFrameIdx,
  };
}

export function buildMotionClipEditorModel(sequence, exercise = {}, { lang = 'en', formatMs = (ms) => `${ms}ms` } = {}) {
  if (!sequence?.frames?.length) return null;
  const isAlternating = exercise?.movementPattern === 'alternating';
  const n = sequence.frames.length;
  const range = selectedSequenceRange(sequence);
  const { startIdx, targetIdx, endIdx, targetOffset, frames } = range;
  const selected = Math.max(0, endIdx - startIdx + 1);
  const startTime = sequenceFrameTime(sequence, startIdx);
  const targetTime = sequenceFrameTime(sequence, targetIdx);
  const endTime = sequenceFrameTime(sequence, endIdx);
  const fullDuration = sequenceDuration(sequence);
  const selectedDuration = sequenceDuration(sequence, startIdx, endIdx);
  const outboundDuration = sequenceDuration(sequence, startIdx, targetIdx);
  const returnDuration = sequenceDuration(sequence, targetIdx, endIdx);
  const startPct = n > 1 ? (startIdx / (n - 1)) * 100 : 0;
  const targetPct = n > 1 ? (targetIdx / (n - 1)) * 100 : 50;
  const endPct = n > 1 ? (endIdx / (n - 1)) * 100 : 100;
  const description = isAlternating
    ? (lang === 'th'
      ? `อัดไว้ ${n} เฟรม · ${formatMs(fullDuration)} เลือก 1 รอบเต็ม: rest → ซ้าย → rest → ขวา → rest`
      : `Recorded ${n} frames · ${formatMs(fullDuration)}. Select one full cycle: rest → left → rest → right → rest.`)
    : (lang === 'th'
      ? `อัดไว้ ${n} เฟรม · ${formatMs(fullDuration)} เลือก 1 รอบเต็ม: rest เริ่ม → target → rest จบ`
      : `Recorded ${n} frames · ${formatMs(fullDuration)}. Select one full cycle: start rest → target → end rest.`);
  return {
    ...range,
    isAlternating,
    frameCount: n,
    selected,
    startTime,
    targetTime,
    endTime,
    fullDuration,
    selectedDuration,
    outboundDuration,
    returnDuration,
    startPct,
    targetPct,
    endPct,
    description,
    startLabel: `${formatMs(startTime)} · #${startIdx + 1}`,
    targetLabel: `${formatMs(targetTime)} · #${targetIdx + 1}`,
    endLabel: `${formatMs(endTime)} · #${endIdx + 1}`,
    selectedLabel: `${selected} frames · ${formatMs(selectedDuration)}`,
    splitLabel: `${formatMs(outboundDuration)} out · ${formatMs(returnDuration)} back`,
  };
}

export function phaseForClipFrame(index, targetOffset, totalFrames) {
  if (index === 0) return 'rest_start';
  if (index === targetOffset) return 'target';
  if (index === totalFrames - 1) return 'rest_end';
  return index < targetOffset ? 'outbound' : 'return';
}

export function buildSkeletonParameterPayload({
  sequence = null,
  exercise = {},
  selectedRegion = null,
  overlayJoints = [],
  selectedJoints = [],
  fallbackOverlayJoints = [],
  exerciseLabel = exercise?.label || exercise?.labelTh || exercise?.id || 'Exercise',
  landmarkNames = [],
  poseConnections = [],
} = {}) {
  if (!sequence?.frames?.length || !selectedRegion) return null;
  const { startIdx, targetIdx, endIdx, targetOffset, frames } = selectedSequenceRange(sequence);
  if (!frames.length) return null;
  const firstT = sequenceFrameTime(sequence, startIdx);
  const targetT = sequenceFrameTime(sequence, targetIdx);
  const endT = sequenceFrameTime(sequence, endIdx);
  const durationMs = Math.max(0, endT - firstT);
  const fpsEstimate = durationMs > 0 && frames.length > 1
    ? Math.round(((frames.length - 1) / (durationMs / 1000)) * 100) / 100
    : null;
  const marker = (name, absoluteIndex) => ({
    name,
    absoluteFrameIndex: absoluteIndex,
    clipFrameIndex: Math.max(0, absoluteIndex - startIdx),
    tMs: Math.max(0, sequenceFrameTime(sequence, absoluteIndex) - firstT),
  });
  const selectedOverlayJoints = overlayJoints?.length ? overlayJoints : fallbackOverlayJoints;

  return {
    schema: 'physioai.skeleton_clip.v1',
    exportedAt: new Date().toISOString(),
    flags: {
      bodyRegionRequired: true,
      bodyRegionSelected: true,
      bodyRegion: selectedRegion.id,
      landmarkSchemaId: exercise.landmarkSchemaId || null,
    },
    bodyRegionSelection: selectedRegion,
    coordinateSystem: {
      landmarkSpace: 'mediapipe_normalized_image',
      x: '0 left edge, 1 right edge in raw camera frame',
      y: '0 top, 1 bottom',
      z: 'MediaPipe pose depth, relative scale',
      displayMirrorX: true,
      note: 'Preview mirrors x for selfie display; exported landmarks are raw, not mirrored.',
    },
    exercise: {
      id: exercise.id,
      label: exerciseLabel,
      bodyRegion: selectedRegion.id,
      landmarkSchemaId: exercise.landmarkSchemaId || null,
      primaryRequiredLandmarks: exercise.primaryRequiredLandmarks || [],
      stabilizerRequiredLandmarks: exercise.stabilizerRequiredLandmarks || [],
      modelInputLandmarks: exercise.modelInputLandmarks || [],
      jointNames: exercise.jointNames || [],
      movementPattern: exercise.movementPattern || 'unilateral',
      selectedOverlayJoints,
      selectedRepJoints: selectedJoints,
    },
    clip: {
      source: 'therapist-motion-preview',
      originalFrameCount: sequence.frames.length,
      selectedFrameCount: frames.length,
      fpsEstimate,
      durationMs,
      markers: {
        restStart: marker('rest_start', startIdx),
        target: marker('target', targetIdx),
        restEnd: marker('rest_end', endIdx),
      },
      phases: {
        restStartMs: 0,
        targetMs: Math.max(0, targetT - firstT),
        restEndMs: durationMs,
        outboundMs: Math.max(0, targetT - firstT),
        returnMs: Math.max(0, endT - targetT),
      },
    },
    landmarkNames,
    skeletonConnections: (poseConnections || []).map(({ start, end }) => ({
      start,
      end,
      startName: landmarkNames[start] || String(start),
      endName: landmarkNames[end] || String(end),
    })),
    angleUnits: 'degrees',
    frames: frames.map((frame, clipFrameIndex) => {
      const absoluteFrameIndex = startIdx + clipFrameIndex;
      const tMs = Math.max(0, sequenceFrameTime(sequence, absoluteFrameIndex) - firstT);
      return {
        clipFrameIndex,
        absoluteFrameIndex,
        tMs,
        phase: phaseForClipFrame(clipFrameIndex, targetOffset, frames.length),
        landmarks: (frame.landmarks || []).map((p, index) => ({
          index,
          name: landmarkNames[index] || String(index),
          x: p.x,
          y: p.y,
          z: p.z,
          visibility: p.visibility,
        })),
        jointAngles: frame.jointAngles || {},
      };
    }),
  };
}

export function buildMotionDatasetRowFromSkeletonExport(payload, options = {}) {
  if (!payload) return null;
  return buildMotionDatasetRowFromSkeletonPayload(payload, options);
}

export function buildMotionDatasetJsonlFromSkeletonPayload(payload, options = {}) {
  const row = buildMotionDatasetRowFromSkeletonExport(payload, options);
  return row ? motionDatasetRowToJsonl(row) : '';
}

export function buildSkeletonExportPayloadForCapture({
  sequence = null,
  exercise = {},
  selectedRegion = null,
  overlayJoints = [],
  selectedJoints = [],
  fallbackOverlayJoints = [],
  exerciseLabel = null,
  landmarkNames = [],
  poseConnections = [],
} = {}) {
  if (!sequence?.frames?.length) return { error: 'no_motion_clip', payload: null };
  if (!selectedRegion) return { error: 'missing_body_region', payload: null };
  const payload = buildSkeletonParameterPayload({
    sequence,
    exercise,
    selectedRegion,
    overlayJoints,
    selectedJoints,
    fallbackOverlayJoints,
    exerciseLabel: exerciseLabel || exercise?.label || exercise?.labelTh || exercise?.id || 'Exercise',
    landmarkNames,
    poseConnections,
  });
  return payload ? { error: null, payload } : { error: 'unknown', payload: null };
}

export function buildDatasetJsonlExportForCapture(payload, {
  label = 'unlabeled',
  source = 'therapist_capture',
  subjectId = 'anon_001',
} = {}) {
  const ex = payload?.exercise || {};
  const jsonl = buildMotionDatasetJsonlFromSkeletonPayload(payload, {
    label,
    source,
    subjectId,
    motionLabel: null,
    suggestedLabel: null,
    dataQuality: 'usable',
    labelStatus: 'draft',
    trainable: false,
    scoreable: false,
    landmarkSchemaId: ex.landmarkSchemaId || payload?.flags?.landmarkSchemaId || null,
    bodyRegion: ex.bodyRegion || payload?.flags?.bodyRegion || null,
    primaryRequiredLandmarks: ex.primaryRequiredLandmarks || [],
    stabilizerRequiredLandmarks: ex.stabilizerRequiredLandmarks || [],
    modelInputLandmarks: ex.modelInputLandmarks || [],
    jointNames: ex.jointNames || [],
  });
  return jsonl ? { error: null, jsonl } : { error: 'unknown', jsonl: '' };
}

export function safeExportId(id = 'exercise') {
  return String(id || 'exercise').replace(/[^a-z0-9_-]+/gi, '_');
}

export function exportTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function downloadTextFile(text, filename, {
  type = 'text/plain',
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  scheduleRevoke = (fn) => setTimeout(fn, 1000),
} = {}) {
  if (!documentRef || !urlApi?.createObjectURL) return false;
  const blob = new Blob([text], { type });
  const url = urlApi.createObjectURL(blob);
  const a = documentRef.createElement('a');
  a.href = url;
  a.download = filename;
  documentRef.body.append(a);
  a.click();
  a.remove();
  scheduleRevoke(() => urlApi.revokeObjectURL(url));
  return true;
}

export function downloadJsonFile(payload, filename, options = {}) {
  return downloadTextFile(JSON.stringify(payload, null, 2), filename, {
    ...options,
    type: 'application/json',
  });
}

export function createClipPreviewRuntime({
  state,
  refs,
  activeSequence = () => null,
  overlayJoints = () => [],
  lang = () => 'en',
  icon = () => '',
  formatMs: formatDuration = formatMsDefault,
  makeDrawer = null,
  getDrawer = () => null,
  setDrawer = () => {},
  drawPrimaryAngleOverlay = () => {},
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  devicePixelRatio = () => globalThis.devicePixelRatio || 1,
  getComputedStyleImpl = () => globalThis.getComputedStyle?.(globalThis.document?.body),
} = {}) {
  function runtimeClipPreviewIndex(sequence = activeSequence()) {
    return clipPreviewIndex(state, sequence);
  }

  function runtimeSequenceMarkerLabel(sequence, idx) {
    return sequenceMarkerLabel(sequence, idx, lang());
  }

  function updateControls() {
    const seq = activeSequence();
    if (!refs.previewWrap || !refs.previewRange) return;
    if (!seq?.frames?.length) {
      refs.previewWrap.classList.add('hidden');
      if (refs.videoFrame) refs.videoFrame.classList.remove('previewing');
      return;
    }
    const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(seq);
    const idx = runtimeClipPreviewIndex(seq);
    refs.previewWrap.classList.remove('hidden');
    if (refs.videoFrame) refs.videoFrame.classList.add('previewing');
    refs.previewRange.min = String(startIdx);
    refs.previewRange.max = String(endIdx);
    refs.previewRange.value = String(idx);
    const frame = seq.frames[idx];
    const selectedMs = sequenceDuration(seq, startIdx, endIdx);
    const relativeMs = Math.max(0, sequenceFrameTime(seq, idx) - sequenceFrameTime(seq, startIdx));
    refs.previewPhase.textContent = runtimeSequenceMarkerLabel(seq, idx);
    refs.previewMeta.textContent = `${formatDuration(relativeMs)} / ${formatDuration(selectedMs)} · #${idx + 1}`;
    const th = lang() === 'th';
    refs.previewPlayBtn.innerHTML = icon(state.previewPlaying ? 'pause' : 'play', { size: 15, color: state.previewPlaying ? '#FBFAF5' : 'var(--ink)' }) +
      ' ' + (th ? (state.previewPlaying ? 'หยุด' : 'เล่น') : (state.previewPlaying ? 'Pause' : 'Play'));
    refs.previewPlayBtn.className = 'mini ' + (state.previewPlaying ? 'primary' : '');
    const angles = frame?.jointAngles || {};
    const joints = overlayJoints();
    const primary = joints.find((joint) => Number.isFinite(angles[joint]));
    refs.previewAngle.textContent = primary ? `${primary.replace('_', ' ')} ${Math.round(angles[primary])}°` : '';
    refs.previewStartBtn.className = 'mini' + (idx === startIdx ? ' primary' : '');
    refs.previewTargetBtn.className = 'mini' + (idx === targetIdx ? ' primary' : '');
    refs.previewEndBtn.className = 'mini' + (idx === endIdx ? ' primary' : '');
  }

  function stop() {
    stopClipPlaybackState(state, cancelFrame);
    updateControls();
  }

  function setPreviewIndex(idx, { stopPlayback = true } = {}) {
    const seq = activeSequence();
    if (!seq?.frames?.length) return;
    setClipPreviewIndexState(state, seq, idx);
    if (stopPlayback) stop();
    render();
  }

  function jump(which) {
    const seq = activeSequence();
    if (!seq?.frames?.length) return;
    setPreviewIndex(jumpClipPreviewIndex(seq, which));
  }

  function ensureCanvasSize() {
    if (!refs.canvas) return null;
    const rect = refs.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio(), 2);
    const width = Math.max(640, Math.round((rect.width || 960) * ratio));
    const height = Math.max(400, Math.round((rect.height || 600) * ratio));
    if (refs.canvas.width !== width || refs.canvas.height !== height) {
      refs.canvas.width = width;
      refs.canvas.height = height;
      if (typeof makeDrawer === 'function') setDrawer(makeDrawer(refs.canvas.getContext('2d')));
    }
    return refs.canvas.getContext('2d');
  }

  function mirrorLandmarks(landmarks) {
    if (!Array.isArray(landmarks)) return landmarks;
    return landmarks.map((point) => point && Number.isFinite(point.x)
      ? { ...point, x: 1 - point.x }
      : point);
  }

  function drawFrame(frame, sequence, idx) {
    const ctx = ensureCanvasSize();
    if (!ctx || !frame) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const css = getComputedStyleImpl();
    ctx.fillStyle = css?.getPropertyValue('--surface3')?.trim() || '#ECE5D8';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.strokeStyle = 'rgba(47,93,80,.10)';
    ctx.lineWidth = 1;
    const step = Math.max(42, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) / 8));
    for (let x = 0; x <= ctx.canvas.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ctx.canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= ctx.canvas.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ctx.canvas.width, y); ctx.stroke();
    }
    ctx.restore();

    const previewLandmarks = mirrorLandmarks(frame.landmarks);
    const drawer = getDrawer();
    if (previewLandmarks?.length && drawer) {
      drawer(previewLandmarks, { color: '#2F5D50', accent: '#7BA88F' });
      drawPrimaryAngleOverlay(ctx, previewLandmarks, frame.jointAngles);
    }

    const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
    const label = runtimeSequenceMarkerLabel(sequence, idx);
    const isKey = idx === startIdx || idx === targetIdx || idx === endIdx;
    ctx.save();
    ctx.font = `700 ${Math.round(ctx.canvas.height * 0.035)}px "Inter Tight", "IBM Plex Sans Thai", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = isKey ? '#2F5D50' : 'rgba(44,42,38,.72)';
    ctx.fillText(label, 22, 22);
    ctx.font = `600 ${Math.round(ctx.canvas.height * 0.026)}px "JetBrains Mono", monospace`;
    ctx.fillText(`#${idx + 1} · ${formatDuration(sequenceFrameTime(sequence, idx) - sequenceFrameTime(sequence, startIdx))}`, 22, 58);
    ctx.restore();
  }

  function render() {
    const seq = activeSequence();
    if (!seq?.frames?.length) {
      updateControls();
      if (!state.cameraOn && refs.canvas) refs.canvas.getContext('2d').clearRect(0, 0, refs.canvas.width, refs.canvas.height);
      return;
    }
    const idx = runtimeClipPreviewIndex(seq);
    state.previewFrameIdx = idx;
    drawFrame(seq.frames[idx], seq, idx);
    updateControls();
  }

  function playbackStep(now) {
    const seq = activeSequence();
    const step = stepClipPlaybackState(state, seq, now);
    if (!step.active) return;
    render();
    if (step.done) {
      stop();
      return;
    }
    state.previewRaf = requestFrame(playbackStep);
  }

  function togglePlayback() {
    const seq = activeSequence();
    if (!seq?.frames?.length) return;
    if (state.previewPlaying) {
      stop();
      return;
    }
    startClipPlaybackState(state, seq);
    updateControls();
    state.previewRaf = requestFrame(playbackStep);
  }

  return {
    clipPreviewIndex: runtimeClipPreviewIndex,
    sequenceMarkerLabel: runtimeSequenceMarkerLabel,
    stop,
    setPreviewIndex,
    jump,
    updateControls,
    render,
    togglePlayback,
  };
}

function formatMsDefault(ms) {
  return `${ms}ms`;
}
