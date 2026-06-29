import { h, clear, mountNav, onLangChange, getLang, t, icon, ringSVG, toast } from '../../../../shared/core/ui.js';
import { BODY_REGIONS, COUNT_MODES, EXERCISES, MOVEMENT_PATTERNS, getExercises, getExercise, exLabel, saveCustomExercise, updateCustomExercise, deleteCustomExercise } from '../../../../shared/core/exercises.js';
import { getReference, getAllReferences, saveReference, clearReference, getPlan, savePlan, syncPatientCloudData } from '../../../../shared/core/store.js';
import { getSettings, saveSettings } from '../../../../shared/core/store.js';
import { ensureTherapist, getTherapist, logout, isGuest } from '../../../../shared/core/auth-ui.js';
import { fetchPatients, linkPatient, createPatient } from '../../../../shared/core/patients.js';
import { LANDMARK_NAMES, PoseLandmarker, createPoseEngine, makeDrawer, startCamera, stopCamera } from '../../../../shared/ai/PoseDetection.js';
import { jointAngleCalculator, JOINT_SPECS } from '../../../../shared/ai/JointAngleCalculator.js';
import { ANGLE_OVERLAY_COLORS, drawAngleOverlayForJoints } from '../../../../shared/ai/AngleOverlay.js';
import { BOUNDARY_BOX_RATIO, drawBoundaryBox, evaluateBoundaryBox } from '../../../../shared/ai/BoundaryBoxGate.js';
import { buildAlternatingReferenceMotion, buildAlternatingReferenceTrajectory, buildReferenceMotion, buildReferenceTrajectory } from '../../../../shared/ai/MultiJointMotion.js';
import { createMotionQualityEngine, isUsablePracticeReference, REFERENCE_KINDS } from '../../../../shared/ai/MotionQualityEngine.js';
import { createPracticeFrameProcessor } from '../../../../shared/practice/frame.js';

export function mountTherapistCapture() {

  const engine = createPoseEngine();
  const S = {
    cameraOn: false, imageMode: false, mode: 'setup', exId: EXERCISES[0].id, patientId: null, patients: [],
    variant: getSettings().modelVariant, reference: null, lastVideoTime: -1, lmCount: 0, latency: 0, fps: 0, _f: 0, _fl: 0,
    boundary: null, boundaryFrame: null, captureDraft: null, recording: null, pendingSequence: null, angleOverlayJoints: [], romBodyRegion: null,
    validationEngine: null, validationFrameProcessor: null, validationKey: null,
    previewFrameIdx: null, previewPlaying: false, previewLastAt: 0, previewRaf: 0,
  };
  let R = {}; // dom refs
  let drawer = null;
  let authed = false; // gate: render() is a no-op until ensureTherapist() resolves (blocks cross-tab pre-auth paint)
  const SEQUENCE_MIN_FRAMES = 8;
  // Store every detected camera frame until the therapist stops recording.
  const ANGLE_PICKER_JOINTS = [
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
    'back', 'neck',
  ];
  const ROM_BODY_REGION_IDS = ['full', 'upper', 'lower', 'shoulder', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];
  const ROM_REGION_JOINTS = {
    full: ANGLE_PICKER_JOINTS,
    upper: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'back', 'neck'],
    lower: ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
    shoulder: ['left_shoulder', 'right_shoulder'],
    left_arm: ['left_shoulder', 'left_elbow'],
    right_arm: ['right_shoulder', 'right_elbow'],
    left_leg: ['left_hip', 'left_knee'],
    right_leg: ['right_hip', 'right_knee'],
  };
  const ROM_REGION_PRIMARY = {
    full: null,
    upper: 'right_shoulder',
    lower: 'right_knee',
    shoulder: 'right_shoulder',
    left_arm: 'left_shoulder',
    right_arm: 'right_shoulder',
    left_leg: 'left_knee',
    right_leg: 'right_knee',
  };

  function loadRef() { S.reference = getReference(S.exId, S.patientId); }

  async function loadPatientData(patientId) {
    if (patientId) await syncPatientCloudData(patientId);
    loadRef();
  }

  async function refreshPatients(preferredId = null) {
    S.patients = await fetchPatients();
    S.patientId = preferredId && S.patients.some((p) => p.id === preferredId)
      ? preferredId
      : (S.patientId && S.patients.some((p) => p.id === S.patientId) ? S.patientId : null);
    await loadPatientData(S.patientId);
  }

  async function addPatient() {
    const lang = getLang();
    const creating = confirm(lang === 'th'
      ? 'สร้าง patient account ใหม่?\nกด Cancel ถ้าต้องการผูก patient ที่มีอยู่แล้ว'
      : 'Create a new patient account?\nPress Cancel to link an existing patient.');
    try {
      let patient = null;
      if (creating) {
        const name = prompt(lang === 'th' ? 'ชื่อคนไข้' : 'Patient name');
        if (!name) return;
        const email = prompt(lang === 'th' ? 'อีเมลคนไข้ (ต้องไม่ใช่อีเมล therapist)' : 'Patient email (not the therapist email)');
        if (!email) return;
        const password = prompt(lang === 'th' ? 'รหัสผ่านเริ่มต้นของคนไข้' : 'Initial patient password');
        if (!password) return;
        patient = await createPatient({ name, email, password });
      } else {
        const value = prompt(lang === 'th' ? 'Patient email หรือ patient id' : 'Patient email or patient id');
        if (!value) return;
        patient = await linkPatient(value);
      }
      await refreshPatients(patient.id);
      toast(patient.verificationRequired
        ? (lang === 'th' ? `สร้างแล้ว · ${patient.name} · ให้คนไข้ verify email ก่อนเข้าใช้` : `Created · ${patient.name} · ask the patient to verify email before sign-in`)
        : (lang === 'th' ? `พร้อมใช้งานแล้ว · ${patient.name}` : `Patient ready · ${patient.name}`));
      render();
    } catch (e) {
      const exists = e.code === 'email_used_by_non_patient' || e.code === 'exists';
      toast(exists
        ? (lang === 'th' ? 'อีเมลนี้ใช้เป็น therapist อยู่แล้ว' : 'This email is already used by a therapist')
        : (lang === 'th' ? 'สร้าง/ผูกผู้ป่วยไม่สำเร็จ' : 'Could not create/link patient'));
    }
  }

  function boundaryText(boundary) {
    if (!boundary) return t('noPose');
    if (getLang() === 'th') return boundary.hintTh;
    return boundary.hint;
  }

  function boundaryClass(boundary) {
    const status = boundary?.status || 'outside';
    return 'pill ' + (status === 'inside' ? 'good' : 'bad') + ' glass';
  }

  function updateBoundaryUi(boundary, prefix = '') {
    S.boundary = boundary;
    S.boundaryFrame = boundary?.nextFrame || null;
    if (R.poseStatus) {
      R.poseStatus.textContent = prefix ? `${prefix} · ${boundaryText(boundary)}` : boundaryText(boundary);
      R.poseStatus.className = boundaryClass(boundary);
    }
    if (R.captureBtn) R.captureBtn.disabled = !(S.cameraOn && boundary?.status === 'inside');
  }

  function boundaryExercise() {
    if (S.romBodyRegion) {
      return {
        bodyRegion: S.romBodyRegion,
        primaryJoint: ROM_REGION_PRIMARY[S.romBodyRegion] || null,
      };
    }
    return { ...getExercise(S.exId), bodyRegion: 'full', primaryJoint: null };
  }

  function currentBoundary(landmarks, { reset = false } = {}) {
    return evaluateBoundaryBox(landmarks, reset ? null : S.boundaryFrame, boundaryExercise());
  }

  function isMotionExercise(ex = getExercise(S.exId)) {
    return ex?.type !== 'hold';
  }

  function canRecordSequence(ex = getExercise(S.exId)) {
    return isMotionExercise(ex);
  }

  function captureButtonText() {
    const ex = getExercise(S.exId);
    const th = getLang() === 'th';
    if (isMotionExercise(ex)) return th ? 'ใช้ Record motion' : 'Use Record motion';
    return t('captureRef');
  }

  function currentCaptureHint(ex = getExercise(S.exId)) {
    const th = getLang() === 'th';
    if (ex.movementPattern === 'alternating') {
      return th
        ? 'บันทึก 1 cycle เต็ม: rest → เป้าซ้าย → rest → เป้าขวา → rest'
        : 'Record one full cycle: rest → left target → rest → right target → rest.';
    }
    if (isMotionExercise(ex)) {
      return th
        ? 'บันทึก 1 cycle เต็ม: rest → target → rest เพื่อใช้ให้คะแนนแบบ motion'
        : 'Record one full cycle: rest → target → rest for motion scoring.';
    }
    return t('captureHint');
  }

  function updateCaptureButtonLabel() {
    if (!R.captureBtn) return;
    R.captureBtn.innerHTML = icon('cam', { size: 16, color: '#FBFAF5' }) + ' ' + captureButtonText();
  }

  function updateRecordButton() {
    if (!R.recordBtn) return;
    const th = getLang() === 'th';
    const n = S.recording?.frames?.length || 0;
    R.recordBtn.className = 'btn ' + (S.recording ? 'danger' : 'ghost');
    R.recordBtn.innerHTML = icon(S.recording ? 'close' : 'play', { size: 16 }) + ' ' +
      (S.recording
        ? (th ? `หยุด Motion · ${n}` : `Stop motion · ${n}`)
        : (th ? 'Record motion' : 'Record motion'));
  }

  function formatMs(ms) {
    const sec = Math.max(0, Number(ms) || 0) / 1000;
    return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
  }

  function sequenceFrameTime(sequence, idx) {
    const frame = sequence?.frames?.[idx];
    return Number(frame?.t) || 0;
  }

  function sequenceDuration(sequence, startIdx = 0, endIdx = null) {
    if (!sequence?.frames?.length) return 0;
    const lastIdx = endIdx == null ? sequence.frames.length - 1 : endIdx;
    return Math.max(0, sequenceFrameTime(sequence, lastIdx) - sequenceFrameTime(sequence, startIdx));
  }

  function pendingSequenceIndexes(sequence) {
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

  function inferSequenceTargetIndex(frames) {
    if (!Array.isArray(frames) || frames.length < 3) return 0;
    const restAngles = frames[0]?.jointAngles || {};
    const candidateJoints = candidateRepJointsForExercise(getExercise(S.exId));
    const joints = (candidateJoints.length ? candidateJoints : JOINT_SPECS.map((s) => s.joint))
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

  function trimPendingSequence(which, rawValue) {
    const seq = S.pendingSequence;
    if (!seq?.frames?.length) return;
    const maxIdx = seq.frames.length - 1;
    const value = Math.max(0, Math.min(maxIdx, Math.round(Number(rawValue))));
    const current = pendingSequenceIndexes(seq);
    const minGap = 1;
    if (which === 'start') {
      seq.startIdx = Math.min(value, current.targetIdx - minGap);
      seq.targetIdx = current.targetIdx;
      seq.endIdx = current.endIdx;
    } else if (which === 'target') {
      seq.startIdx = current.startIdx;
      seq.targetIdx = Math.max(current.startIdx + minGap, Math.min(current.endIdx - minGap, value));
      seq.endIdx = current.endIdx;
    } else {
      seq.startIdx = current.startIdx;
      seq.targetIdx = current.targetIdx;
      seq.endIdx = Math.max(value, current.targetIdx + minGap);
    }
    const next = pendingSequenceIndexes(seq);
    seq.startIdx = next.startIdx;
    seq.targetIdx = next.targetIdx;
    seq.endIdx = next.endIdx;
    S.previewFrameIdx = which === 'start' ? next.startIdx : which === 'target' ? next.targetIdx : next.endIdx;
    stopClipPlayback();
    renderPanel();
    renderClipPreview();
  }

  function selectedSequenceRange(sequence) {
    const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
    const frames = (sequence?.frames || []).slice(startIdx, endIdx + 1);
    return { startIdx, targetIdx, endIdx, targetOffset: Math.max(0, targetIdx - startIdx), frames };
  }

  function selectedSequenceFrames(sequence) {
    return selectedSequenceRange(sequence).frames;
  }

  function activePendingSequence() {
    return S.pendingSequence?.exerciseId === S.exId ? S.pendingSequence : null;
  }

  function stopClipPlayback() {
    S.previewPlaying = false;
    S.previewLastAt = 0;
    if (S.previewRaf) cancelAnimationFrame(S.previewRaf);
    S.previewRaf = 0;
    updateClipPreviewControls();
  }

  function clipPreviewIndex(sequence = activePendingSequence()) {
    if (!sequence?.frames?.length) return 0;
    const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
    const fallback = Number.isFinite(S.previewFrameIdx) ? S.previewFrameIdx : targetIdx;
    return Math.max(startIdx, Math.min(endIdx, Math.round(fallback)));
  }

  function sequenceMarkerLabel(sequence, idx) {
    const lang = getLang();
    const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
    if (idx === startIdx) return lang === 'th' ? 'Rest เริ่ม' : 'Start rest';
    if (idx === targetIdx) return 'Target / peak';
    if (idx === endIdx) return lang === 'th' ? 'Rest จบ' : 'End rest';
    return lang === 'th' ? 'Preview' : 'Preview';
  }

  function setClipPreviewIndex(idx, { stop = true } = {}) {
    const seq = activePendingSequence();
    if (!seq?.frames?.length) return;
    const { startIdx, endIdx } = pendingSequenceIndexes(seq);
    S.previewFrameIdx = Math.max(startIdx, Math.min(endIdx, Math.round(Number(idx))));
    if (stop) stopClipPlayback();
    renderClipPreview();
  }

  function jumpClipPreview(which) {
    const seq = activePendingSequence();
    if (!seq?.frames?.length) return;
    const indexes = pendingSequenceIndexes(seq);
    const idx = which === 'start' ? indexes.startIdx : which === 'target' ? indexes.targetIdx : indexes.endIdx;
    setClipPreviewIndex(idx);
  }

  function setSequenceMarkerFromPreview(which) {
    const seq = activePendingSequence();
    if (!seq?.frames?.length) return;
    trimPendingSequence(which, clipPreviewIndex(seq));
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function phaseForClipFrame(index, targetOffset, totalFrames) {
    if (index === 0) return 'rest_start';
    if (index === targetOffset) return 'target';
    if (index === totalFrames - 1) return 'rest_end';
    return index < targetOffset ? 'outbound' : 'return';
  }

  function buildSkeletonParameterPayload(sequence = activePendingSequence()) {
    if (!sequence?.frames?.length) return null;
    const selectedRegion = sequence.bodyRegionFlag || selectedBodyRegionFlag();
    if (!selectedRegion) return null;
    const { startIdx, targetIdx, endIdx, targetOffset, frames } = selectedSequenceRange(sequence);
    if (!frames.length) return null;
    const firstT = sequenceFrameTime(sequence, startIdx);
    const targetT = sequenceFrameTime(sequence, targetIdx);
    const endT = sequenceFrameTime(sequence, endIdx);
    const ex = getExercise(S.exId);
    const overlayJoints = Array.isArray(sequence.angleOverlayJoints) ? sequence.angleOverlayJoints : S.angleOverlayJoints;
    const selectedJoints = candidateRepJointsForExercise(ex, selectedRegion.id, overlayJoints);
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
    return {
      schema: 'physioai.skeleton_clip.v1',
      exportedAt: new Date().toISOString(),
      flags: {
        bodyRegionRequired: true,
        bodyRegionSelected: true,
        bodyRegion: selectedRegion.id,
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
        id: ex.id,
        label: exLabel(ex, t),
        bodyRegion: selectedRegion.id,
        movementPattern: ex.movementPattern || 'unilateral',
        selectedOverlayJoints: overlayJoints?.length ? overlayJoints : activeOverlayJoints(),
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
      landmarkNames: LANDMARK_NAMES,
      skeletonConnections: (PoseLandmarker.POSE_CONNECTIONS || []).map(({ start, end }) => ({
        start,
        end,
        startName: LANDMARK_NAMES[start] || String(start),
        endName: LANDMARK_NAMES[end] || String(end),
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
            name: LANDMARK_NAMES[index] || String(index),
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

  function exportSkeletonParameters() {
    const sequence = activePendingSequence();
    if (!sequence?.frames?.length) {
      toast(getLang() === 'th' ? 'ยังไม่มีคลิป motion ให้ export' : 'No motion clip to export.');
      return;
    }
    if (!(sequence.bodyRegionFlag || selectedBodyRegionFlag())) {
      toast(getLang() === 'th' ? 'เลือก Body region ใน Motion setup ก่อน export JSON' : 'Select a Motion setup body region before exporting JSON.');
      return;
    }
    const payload = buildSkeletonParameterPayload();
    if (!payload) {
      toast(getLang() === 'th' ? 'Export JSON ไม่สำเร็จ' : 'Could not export JSON.');
      return;
    }
    const safeId = String(S.exId || 'exercise').replace(/[^a-z0-9_-]+/gi, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(payload, `physioai_skeleton_${safeId}_${stamp}.json`);
    toast(getLang() === 'th' ? 'Export skeleton parameters แล้ว' : 'Skeleton parameters exported.');
  }

  function updateClipPreviewControls() {
    const seq = activePendingSequence();
    if (!R.previewWrap || !R.previewRange) return;
    if (!seq?.frames?.length) {
      R.previewWrap.classList.add('hidden');
      if (R.videoFrame) R.videoFrame.classList.remove('previewing');
      return;
    }
    const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(seq);
    const idx = clipPreviewIndex(seq);
    R.previewWrap.classList.remove('hidden');
    if (R.videoFrame) R.videoFrame.classList.add('previewing');
    R.previewRange.min = String(startIdx);
    R.previewRange.max = String(endIdx);
    R.previewRange.value = String(idx);
    const frame = seq.frames[idx];
    const selectedMs = sequenceDuration(seq, startIdx, endIdx);
    const relativeMs = Math.max(0, sequenceFrameTime(seq, idx) - sequenceFrameTime(seq, startIdx));
    R.previewPhase.textContent = sequenceMarkerLabel(seq, idx);
    R.previewMeta.textContent = `${formatMs(relativeMs)} / ${formatMs(selectedMs)} · #${idx + 1}`;
    R.previewPlayBtn.innerHTML = icon(S.previewPlaying ? 'pause' : 'play', { size: 15, color: S.previewPlaying ? '#FBFAF5' : 'var(--ink)' }) +
      ' ' + (getLang() === 'th' ? (S.previewPlaying ? 'หยุด' : 'เล่น') : (S.previewPlaying ? 'Pause' : 'Play'));
    R.previewPlayBtn.className = 'mini ' + (S.previewPlaying ? 'primary' : '');
    const angles = frame?.jointAngles || {};
    const joints = activeOverlayJoints();
    const primary = joints.find((joint) => Number.isFinite(angles[joint]));
    R.previewAngle.textContent = primary ? `${primary.replace('_', ' ')} ${Math.round(angles[primary])}°` : '';
    R.previewStartBtn.className = 'mini' + (idx === startIdx ? ' primary' : '');
    R.previewTargetBtn.className = 'mini' + (idx === targetIdx ? ' primary' : '');
    R.previewEndBtn.className = 'mini' + (idx === endIdx ? ' primary' : '');
  }

  function ensurePreviewCanvasSize() {
    if (!R.canvas) return null;
    const rect = R.canvas.getBoundingClientRect();
    const width = Math.max(640, Math.round((rect.width || 960) * Math.min(window.devicePixelRatio || 1, 2)));
    const height = Math.max(400, Math.round((rect.height || 600) * Math.min(window.devicePixelRatio || 1, 2)));
    if (R.canvas.width !== width || R.canvas.height !== height) {
      R.canvas.width = width;
      R.canvas.height = height;
      drawer = makeDrawer(R.canvas.getContext('2d'));
    }
    return R.canvas.getContext('2d');
  }

  function drawClipPreviewFrame(frame, sequence, idx) {
    const ctx = ensurePreviewCanvasSize();
    if (!ctx || !frame) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const css = getComputedStyle(document.body);
    ctx.fillStyle = css.getPropertyValue('--surface3').trim() || '#ECE5D8';
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

    const previewLandmarks = mirrorPreviewLandmarks(frame.landmarks);
    if (previewLandmarks?.length && drawer) {
      drawer(previewLandmarks, { color: '#2F5D50', accent: '#7BA88F' });
      const wasImageMode = S.imageMode;
      S.imageMode = true;
      drawPrimaryAngleOverlay(ctx, previewLandmarks, frame.jointAngles);
      S.imageMode = wasImageMode;
    }

    const { startIdx, targetIdx, endIdx } = pendingSequenceIndexes(sequence);
    const label = sequenceMarkerLabel(sequence, idx);
    const isKey = idx === startIdx || idx === targetIdx || idx === endIdx;
    ctx.save();
    ctx.font = `700 ${Math.round(ctx.canvas.height * 0.035)}px "Inter Tight", "IBM Plex Sans Thai", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = isKey ? '#2F5D50' : 'rgba(44,42,38,.72)';
    ctx.fillText(label, 22, 22);
    ctx.font = `600 ${Math.round(ctx.canvas.height * 0.026)}px "JetBrains Mono", monospace`;
    ctx.fillText(`#${idx + 1} · ${formatMs(sequenceFrameTime(sequence, idx) - sequenceFrameTime(sequence, startIdx))}`, 22, 58);
    ctx.restore();
  }

  function mirrorPreviewLandmarks(landmarks) {
    if (!Array.isArray(landmarks)) return landmarks;
    return landmarks.map((point) => point && Number.isFinite(point.x)
      ? { ...point, x: 1 - point.x }
      : point);
  }

  function renderClipPreview() {
    const seq = activePendingSequence();
    if (!seq?.frames?.length) {
      updateClipPreviewControls();
      if (!S.cameraOn && R.canvas) R.canvas.getContext('2d').clearRect(0, 0, R.canvas.width, R.canvas.height);
      return;
    }
    const idx = clipPreviewIndex(seq);
    S.previewFrameIdx = idx;
    drawClipPreviewFrame(seq.frames[idx], seq, idx);
    updateClipPreviewControls();
  }

  function clipPlaybackStep(now) {
    const seq = activePendingSequence();
    if (!S.previewPlaying || !seq?.frames?.length) return;
    const { startIdx, endIdx } = pendingSequenceIndexes(seq);
    const currentIdx = clipPreviewIndex(seq);
    if (!S.previewLastAt) S.previewLastAt = now;
    const nextT = sequenceFrameTime(seq, currentIdx) + Math.max(0, now - S.previewLastAt);
    let nextIdx = currentIdx;
    while (nextIdx < endIdx && sequenceFrameTime(seq, nextIdx) < nextT) nextIdx++;
    S.previewFrameIdx = Math.max(startIdx, Math.min(endIdx, nextIdx));
    S.previewLastAt = now;
    renderClipPreview();
    if (S.previewFrameIdx >= endIdx) {
      stopClipPlayback();
      return;
    }
    S.previewRaf = requestAnimationFrame(clipPlaybackStep);
  }

  function toggleClipPlayback() {
    const seq = activePendingSequence();
    if (!seq?.frames?.length) return;
    if (S.previewPlaying) {
      stopClipPlayback();
      return;
    }
    const { startIdx, endIdx } = pendingSequenceIndexes(seq);
    if (clipPreviewIndex(seq) >= endIdx) S.previewFrameIdx = startIdx;
    S.previewPlaying = true;
    S.previewLastAt = 0;
    updateClipPreviewControls();
    S.previewRaf = requestAnimationFrame(clipPlaybackStep);
  }

  function defaultOverlayJoint() {
    const ex = getExercise(S.exId);
    return S.reference?.dominantJoint || S.reference?.primaryJoint || ex.dominantJoint || ex.primaryJoint;
  }

  function activeOverlayJoints() {
    const selected = (S.angleOverlayJoints || []).filter((joint) => JOINT_SPECS.some((s) => s.joint === joint));
    if (selected.length) return [...new Set(selected)];
    return [defaultOverlayJoint()].filter(Boolean);
  }

  function bodyRegionFlag(regionId, source = 'motion_setup') {
    const region = BODY_REGIONS.find((r) => r.id === regionId);
    if (!region) return null;
    const joints = (ROM_REGION_JOINTS[region.id] || []).filter((joint) => JOINT_SPECS.some((s) => s.joint === joint));
    return {
      required: true,
      selected: true,
      id: region.id,
      label: region.label,
      labelTh: region.labelTh,
      source,
      primaryJoint: ROM_REGION_PRIMARY[region.id] || null,
      joints,
      usedForBoundary: true,
      usedForRepScoring: true,
    };
  }

  function selectedBodyRegionFlag(source = 'motion_setup') {
    return bodyRegionFlag(S.romBodyRegion, source);
  }

  function candidateRepJointsForExercise(ex = getExercise(S.exId), bodyRegion = null, overlayJoints = S.angleOverlayJoints) {
    const isKnownJoint = (joint) => JOINT_SPECS.some((s) => s.joint === joint);
    const selected = (overlayJoints || []).filter(isKnownJoint);
    const explicitRegion = bodyRegion || S.romBodyRegion;
    const region = explicitRegion || ex.bodyRegion || 'full';
    const regional = (ROM_REGION_JOINTS[region] || []).filter(isKnownJoint);
    if (explicitRegion && regional.length) return [...new Set(regional)];
    const fallback = ex.repJoints || ex.primaryJoints || [ex.dominantJoint || ex.primaryJoint].filter(Boolean);
    return [...new Set((selected.length ? selected : (regional.length ? regional : fallback)).filter(Boolean))];
  }

  function referenceExerciseForCapture(ex = getExercise(S.exId), bodyRegion = null) {
    const captureRegion = bodyRegion || S.romBodyRegion || ex.bodyRegion || 'full';
    const base = { ...ex, bodyRegion: captureRegion };
    return {
      ...base,
      preferredRepJoints: candidateRepJointsForExercise(base, captureRegion),
    };
  }

  function toggleOverlayJoint(joint) {
    const current = new Set(S.angleOverlayJoints || []);
    if (current.has(joint)) current.delete(joint);
    else current.add(joint);
    S.angleOverlayJoints = [...current];
    renderPanel();
  }

  function selectRomBodyRegion(regionId) {
    const joints = ROM_REGION_JOINTS[regionId] || [];
    S.romBodyRegion = regionId;
    S.boundaryFrame = null;
    S.angleOverlayJoints = joints.filter((joint) => JOINT_SPECS.some((s) => s.joint === joint));
    renderPanel();
  }

  function resetRomMeasurement() {
    S.romBodyRegion = null;
    S.boundaryFrame = null;
    S.angleOverlayJoints = [];
    renderPanel();
  }

  // ── Top bar ─────────────────────────────────────────────────
  function topbar() {
    const lang = getLang();
    const patients = S.patients;
    const top = document.getElementById('top'); clear(top);
    const libraryLabel = lang === 'th' ? 'คลังท่าของฉัน' : 'My exercise library';
    const patientSel = h('select', { onchange: async (e) => {
          S.patientId = e.target.value || null;
          try { await loadPatientData(S.patientId); }
          catch { toast(getLang() === 'th' ? 'โหลดข้อมูลผู้ป่วยจากคลาวด์ไม่สำเร็จ' : 'Could not load patient cloud data'); loadRef(); }
          renderPanel();
        } },
        h('option', { value: '', selected: S.patientId ? null : '' }, libraryLabel),
        ...patients.map((p) => h('option', { value: p.id, selected: p.id === S.patientId ? '' : null }, p.name)));
    const me = getTherapist();
    const whoName = me?.name || (isGuest() ? 'Guest' : (lang === 'th' ? 'นักกายภาพ' : 'Therapist'));
    const whoBtn = h('button', { class: 'btn ghost', title: isGuest() ? (lang === 'th' ? 'ออกจากเดโม' : 'Exit demo') : (lang === 'th' ? 'ออกจากระบบ' : 'Log out'),
      onclick: () => { logout(); location.reload(); } }, whoName);
    const addPatientBtn = h('button', { class: 'btn ghost', title: lang === 'th' ? 'ผูกผู้ป่วย' : 'Link patient',
      onclick: addPatient, html: icon('plus', { size: 16 }) });
    const modelSel = h('select', { onchange: (e) => { S.variant = e.target.value; saveSettings({ modelVariant: S.variant }); if (engine.state.ready) { engine.close(); engine.init(S.variant).catch(() => {}); } } },
      h('option', { value: 'lite', selected: S.variant === 'lite' ? '' : null }, t('modelLite')),
      h('option', { value: 'full', selected: S.variant === 'full' ? '' : null }, t('modelFull')),
      h('option', { value: 'heavy', selected: S.variant === 'heavy' ? '' : null }, t('modelHeavy')));
    R.statusPill = h('span', { class: 'pill' }, t('loadingModel'));
    R.camBtn = h('button', { class: 'btn primary', html: icon('cam', { size: 16, color: '#FBFAF5' }) + ' ' + t('startCamera'), onclick: toggleCamera });
    top.append(h('div', { class: 'topbar' },
      h('div', { class: 'brand-row' },
        h('div', { class: 'logo-mark', html: '<img src="/shared/assets/logo-reversed.svg" width="20" height="20" alt="PhysioAI"/>' }),
        h('div', {}, h('div', { class: 'wordmark', html: 'Physio<b>AI</b>' }), h('div', { style: { fontSize: '15px', fontWeight: '600' } }, t('captureTitle'))),
      ),
      h('div', { class: 'row gap10 wrap', style: { justifyContent: 'flex-end' } }, R.statusPill, addPatientBtn, patientSel, modelSel, whoBtn, R.camBtn),
    ));
  }

  // ── Layout ──────────────────────────────────────────────────
  function render() {
    if (!authed) return;
    topbar();
    const root = document.getElementById('root'); clear(root);
    const video = h('video', { autoplay: '', muted: '', playsinline: '' });
    const canvas = h('canvas');
    R.video = video; R.canvas = canvas;
    R.modeBadge = h('span', { class: 'pill brand' }, S.mode.toUpperCase());
    R.poseStatus = h('span', { class: 'pill glass' }, t('noPose'));
    R.captureBtn = h('button', { class: 'btn primary', disabled: '', html: icon('cam', { size: 16, color: '#FBFAF5' }) + ' ' + captureButtonText(), onclick: capture });
    R.previewPhase = h('b', {}, 'Preview');
    R.previewMeta = h('span', { class: 'mono' }, '0.0s');
    R.previewAngle = h('span', { class: 'mono' }, '');
    R.previewRange = h('input', { type: 'range', min: '0', max: '1', value: '0', oninput: (e) => setClipPreviewIndex(Number(e.target.value), { stop: true }) });
    R.previewPlayBtn = h('button', { class: 'mini', onclick: toggleClipPlayback, html: icon('play', { size: 15 }) + ' Play' });
    const th = getLang() === 'th';
    R.previewStartBtn = h('button', { class: 'mini', onclick: () => jumpClipPreview('start') }, th ? 'Rest เริ่ม' : 'Start');
    R.previewTargetBtn = h('button', { class: 'mini', onclick: () => jumpClipPreview('target') }, 'Target');
    R.previewEndBtn = h('button', { class: 'mini', onclick: () => jumpClipPreview('end') }, th ? 'Rest จบ' : 'End');
    const setStartBtn = h('button', { class: 'mini', onclick: () => setSequenceMarkerFromPreview('start') }, th ? 'ตั้ง start' : 'Set start');
    const setTargetBtn = h('button', { class: 'mini', onclick: () => setSequenceMarkerFromPreview('target') }, th ? 'ตั้ง target' : 'Set target');
    const setEndBtn = h('button', { class: 'mini', onclick: () => setSequenceMarkerFromPreview('end') }, th ? 'ตั้ง end' : 'Set end');
    const exportParamsBtn = h('button', { class: 'mini', onclick: exportSkeletonParameters }, 'Export JSON');
    R.previewWrap = h('div', { class: 'clip-player hidden' },
      h('div', { class: 'clip-player-head' },
        h('span', { class: 'eyebrow' }, th ? 'ดู Motion' : 'Motion preview'),
        h('span', { class: 'row gap6', style: { alignItems: 'baseline' } }, R.previewPhase, R.previewMeta)),
      R.previewRange,
      h('div', { class: 'clip-player-controls' }, R.previewPlayBtn, R.previewStartBtn, R.previewTargetBtn, R.previewEndBtn, h('span', { class: 'grow' }), R.previewAngle),
      h('div', { class: 'clip-marker-row' }, setStartBtn, setTargetBtn, setEndBtn, exportParamsBtn),
    );

    const main = h('div', { class: 'cap-main' },
      h('div', { class: 'video-card' },
        R.videoFrame = h('div', { class: 'video-frame' }, video, canvas, h('div', { class: 'video-hud' }, R.modeBadge, R.poseStatus), R.previewWrap),
        h('div', { class: 'video-actions' },
          h('div', { class: 'mode-toggle' },
            R.setupBtn = h('button', { class: S.mode === 'setup' ? 'active' : '', onclick: () => setMode('setup') }, t('setup')),
            R.valBtn = h('button', { class: S.mode === 'validate' ? 'active' : '', onclick: () => setMode('validate') }, t('validate')),
          ),
          h('div', { class: 'grow' }),
          R.captureBtn,
          R.recordBtn = h('button', { class: 'btn ghost', html: icon('play', { size: 16 }) + ' ' + (getLang() === 'th' ? 'Record motion' : 'Record motion'), onclick: toggleSequenceRecording }),
          h('button', { class: 'btn', html: icon('cam', { size: 16 }) + ' ' + t('fromImage'), onclick: () => document.getElementById('imgInput').click() }),
          h('button', { class: 'btn', html: icon('check', { size: 16 }) + ' ' + (getLang() === 'th' ? 'ส่งออก Refs' : 'Export refs'), onclick: exportRefs }),
          h('button', { class: 'btn', html: icon('plus', { size: 16 }) + ' ' + (getLang() === 'th' ? 'นำเข้า' : 'Import'), onclick: () => document.getElementById('refInput').click() }),
          h('button', { class: 'btn ghost', html: icon('trash', { size: 16 }), onclick: clearRef }),
        ),
      ),
      h('div', { id: 'panel', class: 'panel' }),
    );
    root.append(main);
    drawer = makeDrawer(canvas.getContext('2d'));
    renderPanel();
    updateRecordButton();
    mountNav('therapist/capture');
  }

  function motionClipEditor(lang) {
    const seq = S.pendingSequence;
    if (!seq?.frames?.length || seq.exerciseId !== S.exId) return null;
    const ex = getExercise(S.exId);
    const isAlternating = ex?.movementPattern === 'alternating';
    const n = seq.frames.length;
    const { startIdx, targetIdx, endIdx, targetOffset, frames } = selectedSequenceRange(seq);
    const selected = Math.max(0, endIdx - startIdx + 1);
    const startTime = sequenceFrameTime(seq, startIdx);
    const targetTime = sequenceFrameTime(seq, targetIdx);
    const endTime = sequenceFrameTime(seq, endIdx);
    const fullDuration = sequenceDuration(seq);
    const selectedDuration = sequenceDuration(seq, startIdx, endIdx);
    const outboundDuration = sequenceDuration(seq, startIdx, targetIdx);
    const returnDuration = sequenceDuration(seq, targetIdx, endIdx);
    const startPct = n > 1 ? (startIdx / (n - 1)) * 100 : 0;
    const targetPct = n > 1 ? (targetIdx / (n - 1)) * 100 : 50;
    const endPct = n > 1 ? (endIdx / (n - 1)) * 100 : 100;
    const rangeStyle = { width: '100%', accentColor: 'var(--brand)' };
    const saveSelected = async () => {
      if (frames.length < SEQUENCE_MIN_FRAMES) {
        toast(lang === 'th' ? 'ช่วงที่เลือกสั้นเกินไป' : 'Selected clip is too short.');
        return;
      }
      if (targetOffset <= 0 || targetOffset >= frames.length - 1) {
        toast(lang === 'th' ? 'เลือก target ให้อยู่ระหว่าง rest ทั้งสองฝั่ง' : 'Select a target point between the two rest points.');
        return;
      }
      const ok = await saveSequenceReference(frames, targetOffset, seq.bodyRegionFlag);
      if (ok) {
        S.pendingSequence = null;
        S.previewFrameIdx = null;
        stopClipPlayback();
        renderPanel();
      }
    };
    const discard = () => {
      S.pendingSequence = null;
      S.previewFrameIdx = null;
      stopClipPlayback();
      renderPanel();
      toast(lang === 'th' ? 'ทิ้งคลิป motion แล้ว' : 'Motion clip discarded.');
    };
    return h('div', { class: 'card col gap10' },
      h('div', { class: 'eyebrow' }, lang === 'th' ? 'ตัดช่วง Motion' : 'Motion clip editor'),
      h('div', { class: 'muted', style: { fontSize: '12.5px' } },
        isAlternating
          ? (lang === 'th'
            ? `อัดไว้ ${n} เฟรม · ${formatMs(fullDuration)} เลือก 1 รอบเต็ม: rest → ซ้าย → rest → ขวา → rest`
            : `Recorded ${n} frames · ${formatMs(fullDuration)}. Select one full cycle: rest → left → rest → right → rest.`)
          : (lang === 'th'
            ? `อัดไว้ ${n} เฟรม · ${formatMs(fullDuration)} เลือก 1 รอบเต็ม: rest เริ่ม → target → rest จบ`
            : `Recorded ${n} frames · ${formatMs(fullDuration)}. Select one full cycle: start rest → target → end rest.`)),
      h('div', { style: { position: 'relative', height: '12px', borderRadius: '999px', background: 'var(--surface2)', boxShadow: 'inset 0 0 0 1px var(--line)' } },
        h('div', { style: {
          position: 'absolute',
          left: `${startPct}%`,
          right: `${Math.max(0, 100 - targetPct)}%`,
          top: '0',
          bottom: '0',
          borderRadius: '999px 0 0 999px',
          background: 'var(--brand)',
        } }),
        h('div', { style: {
          position: 'absolute',
          left: `${targetPct}%`,
          right: `${Math.max(0, 100 - endPct)}%`,
          top: '0',
          bottom: '0',
          borderRadius: '0 999px 999px 0',
          background: 'var(--good)',
        } }),
        h('span', { style: {
          position: 'absolute',
          left: `calc(${targetPct}% - 5px)`,
          top: '-4px',
          width: '20px',
          height: '20px',
          borderRadius: '999px',
          background: 'var(--surface)',
          border: '3px solid var(--brand)',
          boxSizing: 'border-box',
        } })),
      h('label', { class: 'col gap6' },
        h('div', { class: 'row between muted', style: { fontSize: '12px' } },
          h('span', {}, lang === 'th' ? 'Rest เริ่ม' : 'Start rest'),
          h('b', { class: 'mono' }, `${formatMs(startTime)} · #${startIdx + 1}`)),
        h('input', { type: 'range', min: '0', max: String(n - 1), value: String(startIdx), style: rangeStyle,
          oninput: (e) => trimPendingSequence('start', e.target.value) })),
      h('label', { class: 'col gap6' },
        h('div', { class: 'row between muted', style: { fontSize: '12px' } },
          h('span', {}, lang === 'th' ? 'Target / peak' : 'Target / peak'),
          h('b', { class: 'mono' }, `${formatMs(targetTime)} · #${targetIdx + 1}`)),
        h('input', { type: 'range', min: '0', max: String(n - 1), value: String(targetIdx), style: rangeStyle,
          oninput: (e) => trimPendingSequence('target', e.target.value) })),
      h('label', { class: 'col gap6' },
        h('div', { class: 'row between muted', style: { fontSize: '12px' } },
          h('span', {}, lang === 'th' ? 'Rest จบ' : 'End rest'),
          h('b', { class: 'mono' }, `${formatMs(endTime)} · #${endIdx + 1}`)),
        h('input', { type: 'range', min: '0', max: String(n - 1), value: String(endIdx), style: rangeStyle,
          oninput: (e) => trimPendingSequence('end', e.target.value) })),
      h('div', { class: 'row between muted', style: { fontSize: '12.5px' } },
        h('span', {}, lang === 'th' ? 'ช่วงที่จะบันทึก' : 'Selected clip'),
        h('b', { class: 'mono' }, `${selected} frames · ${formatMs(selectedDuration)}`)),
      h('div', { class: 'row between muted', style: { fontSize: '12.5px' } },
        h('span', {}, lang === 'th' ? 'แบ่งช่วง' : 'Split'),
        h('b', { class: 'mono' }, `${formatMs(outboundDuration)} out · ${formatMs(returnDuration)} back`)),
      h('div', { class: 'row gap6' },
        h('button', { class: 'btn primary', style: { flex: '1' }, onclick: saveSelected,
          html: icon('check', { size: 16, color: '#FBFAF5' }) + ' ' + (lang === 'th' ? 'บันทึก 1 รอบเต็ม' : 'Save full cycle') }),
        h('button', { class: 'btn', onclick: exportSkeletonParameters,
          html: icon('download', { size: 16 }) + ' Export JSON' }),
        h('button', { class: 'btn ghost', onclick: discard }, lang === 'th' ? 'ทิ้ง' : 'Discard')),
    );
  }

  function renderPanel() {
    loadRef();
    const panel = document.getElementById('panel'); if (!panel) return; clear(panel);
    const ex = getExercise(S.exId);
    const lang = getLang();
    if (S.captureDraft?.exerciseId !== S.exId) S.captureDraft = null;
    if (S.pendingSequence?.exerciseId !== S.exId) {
      S.pendingSequence = null;
      S.previewFrameIdx = null;
      stopClipPlayback();
    }
    updateCaptureButtonLabel();

    // Exercise selector — built-in + therapist's custom exercises (+ create new)
    const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '9px', background: 'var(--surface)', font: 'inherit', fontSize: '13px', color: 'inherit', boxSizing: 'border-box' };
    function newExerciseForm(lng) {
      const selectedExerciseRegion = BODY_REGIONS.find((r) => r.id === S.romBodyRegion);
      const regionName = selectedExerciseRegion ? (lng === 'th' ? selectedExerciseRegion.labelTh : selectedExerciseRegion.label) : '';
      const nameIn = h('input', { type: 'text', value: S.nx?.label || '', placeholder: lng === 'th' ? 'ชื่อท่า เช่น ยกแขนด้านข้าง' : 'Exercise name', style: inputStyle, oninput: (e) => { S.nx = { ...(S.nx || {}), label: e.target.value }; } });
      const regionNote = h('div', {
        class: 'muted',
        style: { fontSize: '12.5px', color: selectedExerciseRegion ? 'var(--ink2)' : 'var(--bad)' },
      }, selectedExerciseRegion
        ? (lng === 'th' ? `ใช้ส่วนร่างกายจาก Motion setup: ${regionName}` : `Uses Motion setup body region: ${regionName}`)
        : (lng === 'th' ? 'เลือก Body region ใน Motion setup ก่อน' : 'Select a body region in Motion setup first'));
      const typeSel = h('select', { style: inputStyle, onchange: (e) => { S.nx = { ...(S.nx || {}), type: e.target.value }; renderPanel(); } },
        h('option', { value: 'rep' }, lng === 'th' ? 'นับครั้ง (Reps)' : 'Reps'),
        h('option', { value: 'hold' }, lng === 'th' ? 'ค้างท่า (Hold)' : 'Hold'));
      const patternSel = h('select', { style: inputStyle, onchange: (e) => { S.nx = { ...(S.nx || {}), movementPattern: e.target.value }; renderPanel(); } },
        ...MOVEMENT_PATTERNS.map((p) => h('option', { value: p.id, selected: (S.nx?.movementPattern || 'bilateralSync') === p.id ? '' : null }, lng === 'th' ? p.labelTh : p.label)));
      const countModeSel = h('select', { style: inputStyle, onchange: (e) => { S.nx = { ...(S.nx || {}), countMode: e.target.value }; } },
        ...COUNT_MODES.map((m) => h('option', { value: m.id, selected: (S.nx?.countMode || 'per_side') === m.id ? '' : null }, lng === 'th' ? m.labelTh : m.label)));
      const err = h('div', { class: 'muted', style: { fontSize: '12px', color: 'var(--bad)', minHeight: '14px' } }, '');
      const save = () => {
        try {
          const created = saveCustomExercise({
            label: S.nx?.label,
            bodyRegion: S.romBodyRegion,
            type: S.nx?.type || 'rep',
            movementPattern: S.nx?.movementPattern || 'bilateralSync',
            countMode: S.nx?.countMode || 'per_side',
          });
          S.exId = created.id; S.newEx = false; S.nx = null; S.captureDraft = null; renderPanel();
          toast(lng === 'th' ? 'เพิ่มลงคลังท่าแล้ว — เริ่มจากจับท่าพัก' : 'Saved to library — capture the rest pose first');
        } catch { err.textContent = lng === 'th' ? 'กรอกชื่อ และเลือกส่วนของร่างกาย' : 'Enter a name and pick a body region'; }
      };
      return h('div', { class: 'col gap6', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--line)' } },
        h('div', { class: 'muted', style: { fontSize: '12px' } }, lng === 'th' ? 'สร้างท่าใหม่ในคลังของคุณ (ค่อย assign ให้คนไข้ใน Plan Builder)' : 'Create an exercise in your library (assign it later in Plan Builder)'),
        nameIn, regionNote, typeSel,
        (S.nx?.type || 'rep') === 'rep' ? patternSel : null,
        (S.nx?.type || 'rep') === 'rep' && (S.nx?.movementPattern || 'bilateralSync') === 'alternating' ? countModeSel : null,
        err,
        h('div', { class: 'row gap6' },
          h('button', { class: 'btn primary', style: { flex: '1' }, disabled: selectedExerciseRegion ? null : '', onclick: save }, lng === 'th' ? 'บันทึกท่า' : 'Add exercise'),
          h('button', { class: 'btn ghost', onclick: () => { S.newEx = false; S.nx = null; renderPanel(); } }, lng === 'th' ? 'ยกเลิก' : 'Cancel')));
    }
    const exerciseChoices = getExercises();
    const exercisePill = (e) => {
      const pill = h('button', { class: 'pill' + (e.id === S.exId ? ' brand' : ''), onclick: () => { S.exId = e.id; S.newEx = false; S.captureDraft = null; renderPanel(); } }, exLabel(e, t));
      if (e.source !== 'custom') return pill;
      const del = h('button', { class: 'pill', title: lang === 'th' ? 'ลบท่านี้' : 'Delete', style: { padding: '6px 8px' }, onclick: () => { deleteCustomExercise(e.id); S.captureDraft = null; if (S.exId === e.id) S.exId = EXERCISES[0].id; renderPanel(); } }, '×');
      return h('span', { class: 'row', style: { alignItems: 'center' } }, pill, del);
    };
    const exercisePills = exerciseChoices.map(exercisePill);
    const selectedRegion = BODY_REGIONS.find((r) => r.id === (ex.bodyRegion || 'full'));
    const selectedRegionLabel = selectedRegion ? (lang === 'th' ? selectedRegion.labelTh : selectedRegion.label) : (ex.bodyRegion || '—');
    const newPill = h('button', { class: 'pill', onclick: () => { S.newEx = !S.newEx; renderPanel(); }, html: icon('plus', { size: 13 }) + ' ' + (lang === 'th' ? 'เพิ่มท่าใหม่' : 'New exercise') });
    const exSel = h('div', { class: 'card' },
      h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, t('exercise')),
      h('div', { class: 'row gap6 wrap' }, ...exercisePills, newPill),
      h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' } },
        (lang === 'th' ? 'ส่วนร่างกายของท่านี้: ' : 'Body part for this exercise: ') + selectedRegionLabel),
      S.newEx ? newExerciseForm(lang) : null,
    );
    const selectedOverlay = new Set(S.angleOverlayJoints || []);
    const regionChip = (region) => h('button', {
      class: 'pill' + (S.romBodyRegion === region.id ? ' brand' : ''),
      onclick: () => selectRomBodyRegion(region.id),
    }, lang === 'th' ? region.labelTh : region.label);
    const angleChip = (spec) => h('button', {
      class: 'pill' + (selectedOverlay.has(spec.joint) ? ' brand' : ''),
      onclick: () => toggleOverlayJoint(spec.joint),
    }, lang === 'th' ? spec.labelTh : spec.label);
    const autoChip = h('button', {
      class: 'pill' + (!selectedOverlay.size ? ' brand' : ''),
      onclick: resetRomMeasurement,
    }, lang === 'th' ? 'อัตโนมัติตามท่า' : 'Auto');
    const angleCard = h('div', { class: 'card' },
      h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, lang === 'th' ? 'ตั้งค่า Motion บนวิดีโอ' : 'Motion setup'),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginBottom: '8px' } }, lang === 'th' ? 'เลือกส่วนร่างกาย' : 'Body region'),
      h('div', { class: 'row gap6 wrap' },
        ...ROM_BODY_REGION_IDS
          .map((id) => BODY_REGIONS.find((region) => region.id === id))
          .filter(Boolean)
          .map(regionChip)),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '12px', marginBottom: '8px' } }, lang === 'th' ? 'ปรับรายข้อต่อ' : 'Fine-tune joints'),
      h('div', { class: 'row gap6 wrap' },
        autoChip,
        ...ANGLE_PICKER_JOINTS
          .map((joint) => JOINT_SPECS.find((s) => s.joint === joint))
          .filter(Boolean)
          .map(angleChip)),
      h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' } },
        lang === 'th'
          ? (S.romBodyRegion
            ? 'Boundary จะเขียวเมื่อส่วนร่างกายที่เลือกอยู่ในกรอบ; ส่วนอื่นไม่บังคับ'
            : (selectedOverlay.size ? 'เลือกแสดงมุมได้หลายจุดพร้อมกัน; ตารางด้านล่างยังคำนวณครบทุกข้อ' : 'โหมด Auto จะแสดงมุมหลักของท่าที่เลือก'))
          : (S.romBodyRegion
            ? 'Boundary turns green when the selected body region is framed; other regions are ignored.'
            : (selectedOverlay.size ? 'Show multiple movement angles at once; the table still computes every angle.' : 'Auto shows the selected exercise primary angle'))),
    );

    // Score (validate)
    R.scoreBox = h('div', { html: ringSVG(0, { size: 84, thickness: 8, color: 'var(--brand)', label: '—', fontSize: 24 }) });
    R.scoreText = h('div', { class: 'muted', style: { fontSize: '13px' } }, S.reference ? (S.mode === 'setup' ? t('validate') : t('cueNoPose')) : currentCaptureHint(ex));
    const scoreCard = h('div', { class: 'card row gap16' }, R.scoreBox, h('div', { class: 'grow col gap6' }, h('div', { class: 'eyebrow' }, t('accuracy')), R.scoreText));

    // Joint angle table
    R.tbody = h('tbody');
    for (const spec of JOINT_SPECS) {
      R.tbody.append(h('tr', { class: 'none', dataset: { joint: spec.joint } },
        h('td', {}, lang === 'th' ? spec.labelTh : spec.label),
        h('td', { class: 'num ref' }, '—'), h('td', { class: 'num live' }, '—'),
        h('td', { class: 'num delta' }, '—'), h('td', { class: 'num status' }, '—')));
    }
    const table = h('div', { class: 'card' },
      h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, lang === 'th' ? `มุมข้อต่อ (${JOINT_SPECS.length} จุด)` : `Joint angles (${JOINT_SPECS.length})`),
      h('table', { class: 'data angles' },
        h('thead', {}, h('tr', {}, h('th', {}, lang === 'th' ? 'ข้อต่อ' : 'Joint'),
          h('th', { class: 'num' }, 'Ref'), h('th', { class: 'num' }, 'Live'), h('th', { class: 'num' }, 'Δ'), h('th', { class: 'num' }, 'OK'))),
        R.tbody),
    );

    // Reference = the quality target only: captured pose + targetAngle + tolerance.
    // Dosage (reps/sets/hold) and schedule now live in the Plan Builder (per patient),
    // so they are NOT edited here anymore — keeping a single source of truth.
    S.plan = { tol: S.reference?.plan?.tol ?? ex.tol };
    const refMeta = S.reference
      ? `${t('jointsCaptured', { n: Object.values(S.reference.jointAngles).filter((v) => v != null).length })}${S.reference.referenceSequence?.sampleCount ? ' · trajectory ' + S.reference.referenceSequence.sampleCount : ''}${S.reference.source ? ' · ' + S.reference.source : ''}`
      : currentCaptureHint(ex);
    const inPlan = S.patientId ? getPlan(S.patientId).includes(S.exId) : false;
    const numField = (label, key, min, max) => h('label', { class: 'row between', style: { alignItems: 'center' } },
      h('span', { class: 'muted' }, label),
      h('input', {
        type: 'number', value: String(S.plan[key]), min: String(min), max: String(max),
        style: { width: '90px', textAlign: 'right', padding: '5px 9px', border: '1px solid var(--line)', borderRadius: '9px', background: 'var(--surface)', font: 'inherit', color: 'inherit' },
        onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) S.plan[key] = v; },
      }));
    const primaryJoint = S.reference?.dominantJoint || S.reference?.primaryJoint || ex.dominantJoint || ex.primaryJoint;
    const jointName = (joint) => {
      const spec = JOINT_SPECS.find((s) => s.joint === joint);
      return spec ? (lang === 'th' ? spec.labelTh : spec.label) : joint;
    };
    const degText = (value) => Number.isFinite(value) ? `${Math.round(value)}°` : '—';
    const trajectoryRangeFor = (joint) => {
      const values = (S.reference?.referenceSequence?.frames || [])
        .map((frame) => frame?.angles?.[joint])
        .filter((value) => Number.isFinite(value));
      if (!values.length) return null;
      return Math.max(...values) - Math.min(...values);
    };
    const cycleAnglesFor = (joint) => {
      if (!S.reference) return { rest: null, target: null, returned: null, range: null, endpointRange: null, trajectoryRange: null };
      const motion = S.reference?.jointMotion?.[joint] || null;
      const rest = motion?.rest ?? S.reference?.restJointAngles?.[joint] ?? S.reference?.plan?.restAngle;
      const target = motion?.target ?? S.reference?.targetJointAngles?.[joint] ?? S.reference?.jointAngles?.[joint] ?? S.reference?.plan?.targetAngle;
      const returned = S.reference?.returnRestJointAngles?.[joint] ?? null;
      const endpointRange = Number.isFinite(rest) && Number.isFinite(target) ? Math.abs(target - rest) : null;
      const trajectoryRange = motion?.trajectoryRange ?? trajectoryRangeFor(joint);
      const range = Math.max(endpointRange || 0, trajectoryRange || 0);
      return { rest, target, returned, range, endpointRange, trajectoryRange };
    };
    const primaryCycle = cycleAnglesFor(primaryJoint);
    const targetShownText = S.reference && Number.isFinite(primaryCycle.target)
      ? `${Math.round(primaryCycle.target)}°`
      : '—';
    const tracked = S.reference?.repJoints || (isMotionExercise(ex)
      ? candidateRepJointsForExercise(ex, S.romBodyRegion || ex.bodyRegion || 'full')
      : (ex.repJoints || [S.reference?.dominantJoint || ex.primaryJoint].filter(Boolean)));
    const requested = S.reference?.requestedRepJoints || [];
    const skippedRequested = requested.filter((joint) => !tracked.includes(joint));
    const trackedLabel = tracked.length
      ? tracked.join(', ') +
        (skippedRequested.length
          ? (lang === 'th' ? ` · ไม่มีข้อมูล ${skippedRequested.join(', ')}` : ` · unavailable ${skippedRequested.join(', ')}`)
          : (!S.reference && isMotionExercise(ex) ? (lang === 'th' ? ' (candidate)' : ' (candidate)') : ''))
      : (lang === 'th' ? 'ระบบจะเลือกจาก motion ตอนบันทึก' : 'detected from motion during capture');
    const seqPhases = S.reference?.referenceSequence?.phases;
    const timingText = seqPhases?.targetMs != null && seqPhases?.restEndMs != null
      ? `${formatMs(seqPhases.targetMs - (seqPhases.restStartMs || 0))} out · ${formatMs(seqPhases.restEndMs - seqPhases.targetMs)} back`
      : (S.reference?.referenceSequence?.durationMs ? formatMs(S.reference.referenceSequence.durationMs) : null);
    const primaryCycleText = S.reference ? [
      degText(primaryCycle.rest),
      degText(primaryCycle.target),
      primaryCycle.returned != null ? degText(primaryCycle.returned) : null,
    ].filter(Boolean).join(' → ') : '— → —';
    const roleText = (role) => {
      if (role === 'primary_motion') return lang === 'th' ? 'หลัก' : 'primary';
      if (role === 'coordinated_motion') return lang === 'th' ? 'ร่วมขยับ' : 'coordinated';
      if (role === 'reference_pattern') return lang === 'th' ? 'แพทเทิร์น' : 'pattern';
      return lang === 'th' ? 'ติดตาม' : 'tracked';
    };
    const jointCycleRows = S.reference && tracked.length
      ? h('div', { class: 'col gap6', style: { padding: '8px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' } },
        ...tracked.map((joint) => {
          const c = cycleAnglesFor(joint);
          const role = S.reference?.jointMotion?.[joint]?.role || S.reference?.jointRoles?.[joint]?.role;
          const values = [degText(c.rest), degText(c.target), c.returned != null ? degText(c.returned) : null].filter(Boolean).join(' → ');
          const suffix = Number.isFinite(c.range)
            ? ` · ${roleText(role)} ${Math.round(c.range)}°${c.trajectoryRange ? ' path' : ''}`
            : '';
          return h('div', { class: 'row between', style: { alignItems: 'baseline', gap: '12px' } },
            h('span', { class: 'muted', style: { fontSize: '12.5px' } }, jointName(joint)),
            h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, values + suffix));
        }))
      : null;
    const presCard = h('div', { class: 'card col gap10' },
      h('div', { class: 'eyebrow' }, lang === 'th' ? 'ค่าอ้างอิง (สำหรับให้คะแนน)' : 'Reference target (for scoring)'),
      h('div', { class: 'muted', style: { fontSize: '12.5px' } }, refMeta),
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, t('targetAngle')), h('b', { class: 'mono' }, targetShownText)),
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, lang === 'th' ? 'Rest → Target → Rest' : 'Rest → Target → Rest'),
        h('b', { class: 'mono', style: { fontSize: '12px', textAlign: 'right' } }, primaryCycleText)),
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, lang === 'th' ? 'Motion range / Timing' : 'Motion range / Timing'),
        h('b', { class: 'mono', style: { fontSize: '12px', textAlign: 'right' } },
          `${Number.isFinite(primaryCycle.range) ? Math.round(primaryCycle.range) + '°' : '—'}${timingText ? ' · ' + timingText : ''}`)),
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, lang === 'th' ? 'Pattern' : 'Pattern'), h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, S.reference?.movementPattern || ex.movementPattern || 'unilateral')),
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, lang === 'th' ? 'ข้อต่อที่ติดตาม' : 'Tracked joints'), h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, trackedLabel)),
      jointCycleRows,
      numField(lang === 'th' ? 'ค่าเผื่อ (±°)' : 'Tolerance (±°)', 'tol', 1, 45),
      h('button', { class: 'btn block', onclick: savePlanSettings,
        html: icon('check', { size: 16 }) + ' ' + (lang === 'th' ? 'บันทึกค่าอ้างอิง' : 'Save target') }),
      h('button', { class: 'btn ' + (inPlan ? 'ghost' : 'primary') + ' block', disabled: S.patientId ? null : '', onclick: togglePlan,
        html: icon(inPlan ? 'check' : 'plus', { size: 16, color: inPlan ? 'var(--brand)' : '#FBFAF5' }) + ' ' + (S.patientId ? (inPlan ? t('removeFromPlan') : t('addToPlan')) : (lang === 'th' ? 'เลือกคนไข้เพื่อเพิ่มในแผน' : 'Select patient to add')) }),
      h('div', { class: 'muted', style: { fontSize: '12px', textAlign: 'center' } },
        lang === 'th' ? 'ตั้งจำนวนครั้ง / เซ็ต / ความถี่ ที่หน้า Plan Builder' : 'Set reps / sets / frequency in Plan Builder'),
    );

    const clipEditor = motionClipEditor(lang);
    panel.append(exSel, angleCard, ...(clipEditor ? [clipEditor] : []), scoreCard, table, presCard);
    if (S.reference) updateTable(null); // show ref column
    renderClipPreview();
  }

  // ── Engine + camera loop ────────────────────────────────────
  async function initEngine() {
    try {
      R.statusPill.textContent = t('loadingModel'); R.statusPill.className = 'pill warn';
      const info = await engine.init(S.variant);
      R.statusPill.textContent = (lang() === 'th' ? 'พร้อม' : 'Ready') + ' · ' + info.delegate; R.statusPill.className = 'pill good';
    } catch (e) {
      R.statusPill.textContent = (lang() === 'th' ? 'โหลดโมเดลไม่สำเร็จ' : 'Model failed'); R.statusPill.className = 'pill bad';
    }
  }
  const lang = () => getLang();

  async function toggleCamera() {
    if (S.cameraOn) return stopCam();
    try {
      await startCamera(R.video, { facingMode: 'user' });
      if (!engine.state.ready) await initEngine();
      R.canvas.width = R.video.videoWidth; R.canvas.height = R.video.videoHeight;
      R.canvas.style.transform = ''; S.imageMode = false; // restore selfie-mirror after any image preview
      S.cameraOn = true; S.boundary = null; S.boundaryFrame = null;
      R.camBtn.className = 'btn danger'; R.camBtn.innerHTML = icon('close', { size: 16, color: '#FBFAF5' }) + ' ' + t('stopCamera');
      R.captureBtn.disabled = true;
      requestAnimationFrame(loop);
    } catch (e) { toast(t('cameraDenied')); }
  }
  function stopCam() {
    if (S.recording) {
      S.recording = null;
      updateRecordButton();
    }
    stopCamera(R.video); S.cameraOn = false; S.boundary = null; S.boundaryFrame = null;
    R.camBtn.className = 'btn primary'; R.camBtn.innerHTML = icon('cam', { size: 16, color: '#FBFAF5' }) + ' ' + t('startCamera');
    R.captureBtn.disabled = true;
    if (activePendingSequence()) renderClipPreview();
    else R.canvas.getContext('2d').clearRect(0, 0, R.canvas.width, R.canvas.height);
  }

  function loop() {
    if (!S.cameraOn) return;
    if (engine.state.ready && R.video.currentTime !== S.lastVideoTime) {
      S.lastVideoTime = R.video.currentTime;
      const t0 = performance.now();
      const res = engine.detectVideo(R.video, performance.now());
      S.latency = Math.round(performance.now() - t0);
      renderResult(res);
    }
    requestAnimationFrame(loop);
  }

  function renderResult(res) {
    if (activePendingSequence()) return;
    const ctx = R.canvas.getContext('2d');
    ctx.clearRect(0, 0, R.canvas.width, R.canvas.height);
    const live = res?.landmarks?.[0];
    if (!live) {
      const boundary = currentBoundary(null, { reset: true });
      drawBoundaryBox(ctx, boundary);
      updateBoundaryUi(boundary, t('noPose'));
      updateTable(null); updateScore(null); return;
    }
    const boundary = currentBoundary(live);
    updateBoundaryUi(boundary, `${live.length} pts`);
    const liveAngles = jointAngleCalculator(live);

    let col = ['#2F5D50', '#7BA88F'];
    if (S.reference && S.mode === 'validate') {
      const ex = getExercise(S.exId);
      const validationProcessor = validationProcessorFor(ex, S.reference);
      if (validationProcessor) {
        const frame = validationProcessor.processPracticeFrame({
          timestamp: performance.now(),
          landmarks: live,
          previousBoundaryFrame: S.boundaryFrame,
          liveAngles,
          boundary,
        });
        const snapshot = frame.snapshot;
        const score = snapshot.overallScore;
        col = score >= 75 ? ['#2F5D50', '#7BA88F'] : score >= 50 ? ['#9C7344', '#C8955A'] : ['#8C4F40', '#B86C5A'];
        if (frame.ghostLandmarks) drawer(frame.ghostLandmarks, { ghost: true });
        updateScore(score, snapshot.cue?.text);
      } else {
        updateScore(null, currentCaptureHint(ex));
      }
    } else updateScore(null);
    drawer(live, { color: col[0], accent: col[1] });
    drawBoundaryBox(ctx, boundary);
    drawPrimaryAngleOverlay(ctx, live, liveAngles);
    updateTable(liveAngles);
    maybeRecordSequenceFrame({ landmarks: live, jointAngles: liveAngles, boundary, now: performance.now() });
  }

  function drawPrimaryAngleOverlay(ctx, landmarks, liveAngles) {
    drawAngleOverlayForJoints(ctx, landmarks, liveAngles, activeOverlayJoints(), {
      colors: ANGLE_OVERLAY_COLORS,
      lang: getLang(),
      mirrorText: !S.imageMode,
    });
  }

  function updateTable(liveAngles) {
    const ex = getExercise(S.exId);
    const tolOverride = toleranceOverride(ex, S.reference);
    for (const spec of JOINT_SPECS) {
      const tr = R.tbody.querySelector(`tr[data-joint="${spec.joint}"]`); if (!tr) continue;
      const ref = S.reference?.jointAngles?.[spec.joint];
      const live = liveAngles?.[spec.joint];
      const tol = tolOverride[spec.joint] ?? null;
      tr.querySelector('.ref').textContent = ref == null ? '—' : `${ref.toFixed(0)}°`;
      tr.querySelector('.live').textContent = live == null ? '—' : `${live.toFixed(0)}°`;
      if (ref == null || live == null) { tr.querySelector('.delta').textContent = '—'; tr.querySelector('.status').textContent = '—'; tr.className = 'none'; continue; }
      const d = Math.abs(ref - live); const tt = tol ?? 15;
      tr.querySelector('.delta').textContent = `${d.toFixed(0)}°`;
      if (d <= tt) { tr.querySelector('.status').textContent = '✓'; tr.className = 'ok'; }
      else if (d <= tt * 2) { tr.querySelector('.status').textContent = '~'; tr.className = 'warn'; }
      else { tr.querySelector('.status').textContent = '✗'; tr.className = 'bad'; }
    }
  }

  function updateScore(score, text = null) {
    if (!R.scoreBox) return;
    if (score == null) {
      R.scoreBox.innerHTML = ringSVG(0, { size: 84, thickness: 8, color: 'var(--brand)', label: '—', fontSize: 24 });
      R.scoreText.textContent = text || (!S.reference ? currentCaptureHint() : S.mode === 'setup' ? t('validate') : t('cueNoPose'));
      return;
    }
    const col = score >= 75 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
    R.scoreBox.innerHTML = ringSVG(score / 100, { size: 84, thickness: 8, color: col, label: String(score), fontSize: 24 });
    R.scoreText.textContent = text || (score >= 75 ? t('refSaved') : t('cueAdjust'));
  }

  function cleanLandmarks(landmarks) {
    return landmarks.map((k) => ({ x: k.x, y: k.y, z: k.z, visibility: k.visibility }));
  }

  function cleanAngles(jointAngles) {
    const out = {};
    for (const spec of JOINT_SPECS) {
      const value = jointAngles?.[spec.joint];
      if (Number.isFinite(value)) out[spec.joint] = Math.round(value * 10) / 10;
    }
    return out;
  }

  function toleranceOverride(ex, ref = S.reference) {
    const joints = ref?.repJoints || ex.repJoints || [ref?.dominantJoint || ref?.primaryJoint || ex.primaryJoint].filter(Boolean);
    const out = {};
    for (const joint of joints) out[joint] = ref?.jointMotion?.[joint]?.tol ?? S.plan?.tol ?? ex.tol;
    return out;
  }

  function maybeRecordSequenceFrame({ landmarks, jointAngles, boundary, now }) {
    if (!S.recording) return;
    if (boundary?.status !== 'inside') return;
    S.recording.frames.push({
      t: Math.round(now - S.recording.startedAt),
      jointAngles: cleanAngles(jointAngles),
      landmarks: cleanLandmarks(landmarks),
    });
    updateRecordButton();
  }

  function startSequenceRecording() {
    const ex = getExercise(S.exId);
    const regionFlag = selectedBodyRegionFlag();
    if (!regionFlag) {
      toast(getLang() === 'th' ? 'เลือก Body region ใน Motion setup ก่อนบันทึก motion' : 'Select a Motion setup body region before recording motion.');
      return;
    }
    if (!S.cameraOn || !engine.state.ready) { toast(t('startCamera')); return; }
    if (!canRecordSequence(ex)) {
      toast(getLang() === 'th' ? 'ท่านี้ยังไม่รองรับ motion sequence' : 'This exercise does not support motion sequence recording yet');
      return;
    }
    const now = performance.now();
    S.pendingSequence = null;
    S.previewFrameIdx = null;
    stopClipPlayback();
    S.recording = {
      exerciseId: S.exId,
      bodyRegionFlag: regionFlag,
      angleOverlayJoints: [...(S.angleOverlayJoints || [])],
      startedAt: now,
      frames: [],
    };
    updateRecordButton();
    renderPanel();
    toast(ex.movementPattern === 'alternating'
      ? (getLang() === 'th' ? 'เริ่มบันทึก motion · ทำ 1 รอบ: rest → ซ้าย → rest → ขวา → rest' : 'Recording motion · perform one full cycle: rest → left → rest → right → rest')
      : (getLang() === 'th' ? 'เริ่มบันทึก motion · ทำ 1 รอบ: rest → target → rest' : 'Recording motion · perform one full cycle: rest → target → rest'));
  }

  async function stopSequenceRecording() {
    const recording = S.recording;
    S.recording = null;
    updateRecordButton();
    if (!recording || recording.exerciseId !== S.exId) return;
    if (recording.frames.length < SEQUENCE_MIN_FRAMES) {
      toast(getLang() === 'th' ? 'motion สั้นเกินไป ลองบันทึกใหม่' : 'Motion was too short. Record again.');
      return;
    }
    const targetIdx = inferSequenceTargetIndex(recording.frames);
    S.pendingSequence = {
      exerciseId: S.exId,
      bodyRegionFlag: recording.bodyRegionFlag,
      angleOverlayJoints: recording.angleOverlayJoints,
      frames: recording.frames,
      startIdx: 0,
      targetIdx,
      endIdx: recording.frames.length - 1,
    };
    S.previewFrameIdx = targetIdx;
    stopClipPlayback();
    renderPanel();
    renderClipPreview();
    toast(getLang() === 'th' ? 'เลือก rest เริ่ม, target, และ rest จบ ก่อนบันทึก' : 'Select start rest, target, and end rest before saving.');
  }

  function toggleSequenceRecording() {
    if (S.recording) void stopSequenceRecording();
    else startSequenceRecording();
  }

  // ── Actions ─────────────────────────────────────────────────
  function setMode(m) {
    S.mode = m;
    R.modeBadge.textContent = m.toUpperCase(); R.modeBadge.className = 'pill ' + (m === 'setup' ? 'brand' : 'good');
    R.setupBtn.className = m === 'setup' ? 'active' : ''; R.valBtn.className = m === 'validate' ? 'active' : '';
    resetValidationEngine();
    updateScore(null);
  }

  function resetValidationEngine() {
    S.validationEngine = null;
    S.validationFrameProcessor = null;
    S.validationKey = null;
  }

  function validationDoseFor(ex) {
    return {
      reps: Number(ex?.reps) || 1,
      sets: Number(ex?.sets) || 1,
      holdSec: Number(ex?.holdSec) || 10,
    };
  }

  function validationReferenceKey(ex, ref) {
    return [
      ex?.id || S.exId,
      ref?.capturedAt || '',
      ref?.kind || '',
      ref?.referenceVersion || '',
      ref?.referenceSequence?.sampleCount || '',
    ].join('|');
  }

  function validationProcessorFor(ex, ref) {
    if (!isUsablePracticeReference(ref, ex)) return null;
    const key = validationReferenceKey(ex, ref);
    if (!S.validationEngine || S.validationKey !== key) {
      S.validationEngine = createMotionQualityEngine({
        exercise: ex,
        reference: ref,
        dose: validationDoseFor(ex),
        lang: getLang(),
      });
      S.validationFrameProcessor = createPracticeFrameProcessor({
        exercise: ex,
        reference: ref,
        motionEngine: S.validationEngine,
      });
      S.validationKey = key;
    }
    return S.validationFrameProcessor;
  }

  async function persistReference(ref, successText = t('refSaved')) {
    try {
      await saveReference(S.exId, ref, S.patientId);
    } catch (e) {
      toast(S.patientId
        ? (getLang() === 'th' ? 'บันทึก reference ขึ้นคลาวด์ไม่สำเร็จ' : 'Reference cloud save failed')
        : (getLang() === 'th' ? 'บันทึก reference ในคลังไม่สำเร็จ' : 'Library reference save failed'));
      return false;
    }
    S.reference = ref;
    S.captureDraft = null;
    resetValidationEngine();
    updateCaptureButtonLabel();
    toast(!S.patientId && successText === t('refSaved')
      ? (getLang() === 'th' ? 'บันทึกในคลังท่าของฉันแล้ว' : 'Saved to my exercise library')
      : successText);
    renderPanel();
    return true;
  }

  async function saveHoldReference({ landmarks, jointAngles, boundary, source = null }) {
    const exC = getExercise(S.exId);
    const captureRegion = S.romBodyRegion || exC.bodyRegion || 'full';
    const scoringJoints = candidateRepJointsForExercise(exC, captureRegion)
      .filter((joint) => Number.isFinite(jointAngles?.[joint]));
    const primaryJoint = exC.dominantJoint || exC.primaryJoint || scoringJoints[0];
    if (!primaryJoint || !Number.isFinite(jointAngles?.[primaryJoint])) {
      toast(getLang() === 'th' ? 'ยังอ่านมุมของท่านี้ไม่ครบ' : 'Not enough joint angles for this hold.');
      return false;
    }
    const clean = cleanLandmarks(landmarks);
    const updated = exC.source === 'custom'
      ? updateCustomExercise(S.exId, {
          bodyRegion: captureRegion,
          jointAngles,
          landmarks: clean,
          targetJointAngles: jointAngles,
          targetLandmarks: clean,
          target: Math.round(jointAngles[primaryJoint] ?? exC.target),
          tol: S.plan?.tol ?? exC.tol,
          repMode: 'hold',
          primaryJoint,
          dominantJoint: primaryJoint,
          repJoints: scoringJoints,
          primaryJoints: scoringJoints,
          pendingAutoPrimary: false,
        })
      : exC;
    const ref = {
      kind: REFERENCE_KINDS.HOLD_POSE,
      referenceVersion: 2,
      scoringVersion: 2,
      capturedAt: new Date().toISOString(), variant: S.variant, exerciseId: S.exId,
      source,
      exercise: updated.source === 'custom' ? updated : undefined,
      bodyRegion: captureRegion,
      movementPattern: 'hold',
      countMode: updated.countMode,
      primaryJoint,
      dominantJoint: primaryJoint,
      repMode: 'hold',
      scoringJoints,
      repJoints: scoringJoints,
      primaryJoints: scoringJoints,
      holdTargetAngles: jointAngles,
      holdTargetLandmarks: clean,
      holdMinDurationMs: Math.max(1, Number(updated.holdSec || exC.holdSec || 10)) * 1000,
      targetJointAngles: jointAngles,
      targetLandmarks: clean,
      jointAngles,
      landmarks: clean,
      jointMotion: Object.fromEntries(scoringJoints.map((joint) => [joint, { tol: S.plan?.tol ?? updated.tol ?? 15, usedForScoring: true }])),
      boundaryStatus: boundary.status, boundaryBoxRatio: BOUNDARY_BOX_RATIO, boundaryWillExit: !!boundary.willExit,
      plan: {
        tol: S.plan?.tol ?? updated.tol,
        targetAngle: Math.round(jointAngles[primaryJoint] ?? updated.target),
        restAngle: updated.rest,
        dir: updated.dir,
      },
    };
    return await persistReference(ref);
  }

  async function saveMotionReference({
    motion,
    targetAngles,
    targetLandmarks,
    boundary,
    source = null,
    referenceSequence = null,
    bodyRegion = null,
    returnRestAngles = null,
    returnRestLandmarks = null,
  }) {
    const exC = getExercise(S.exId);
    const th = getLang() === 'th';
    const tol = S.plan?.tol ?? exC.tol;
    const captureRegion = bodyRegion || exC.bodyRegion || 'full';
    if (exC.type !== 'hold' && !referenceSequence) {
      toast(th
        ? 'บันทึก full motion cycle ด้วย Record motion ก่อนใช้ scoring'
        : 'Record a full motion cycle before saving the scoring reference.');
      return false;
    }
    const referenceKind = motion.movementPattern === 'alternating'
      ? REFERENCE_KINDS.ALTERNATING_MOTION_CYCLE
      : REFERENCE_KINDS.MOTION_CYCLE;
    const updated = exC.source === 'custom'
      ? updateCustomExercise(S.exId, {
          ...motion,
          bodyRegion: captureRegion,
          jointAngles: targetAngles,
          landmarks: targetLandmarks,
          referenceSequence,
          returnRestJointAngles: returnRestAngles,
          returnRestLandmarks,
          target: motion.targetAngle,
          rest: motion.restAngle,
          tol,
          pendingAutoPrimary: false,
          autoPrimaryJoint: true,
        })
      : exC;
    const ref = {
      kind: referenceKind,
      referenceVersion: 2,
      scoringVersion: 2,
      capturedAt: new Date().toISOString(), variant: S.variant, exerciseId: S.exId, source,
      exercise: updated.source === 'custom' ? updated : undefined,
      bodyRegion: captureRegion,
      movementPattern: motion.movementPattern,
      alternatingSides: motion.alternatingSides,
      countMode: motion.countMode,
      jointAngles: targetAngles,
      landmarks: targetLandmarks,
      restJointAngles: motion.restJointAngles,
      targetJointAngles: motion.targetJointAngles,
      targetJointAnglesBySide: motion.targetJointAnglesBySide,
      restLandmarks: motion.restLandmarks,
      targetLandmarks: motion.targetLandmarks,
      targetLandmarksBySide: motion.targetLandmarksBySide,
      returnRestJointAngles: returnRestAngles,
      returnRestLandmarks,
      repMode: motion.repMode,
      repJoints: motion.repJoints,
      primaryJoints: motion.primaryJoints,
      scoringJoints: motion.repJoints,
      requestedRepJoints: motion.requestedRepJoints,
      jointRoles: motion.jointRoles,
      dominantJoint: motion.dominantJoint,
      primaryJoint: motion.primaryJoint,
      jointMotion: motion.jointMotion,
      sideMotions: motion.sideMotions,
      boundaryStatus: boundary.status,
      boundaryBoxRatio: BOUNDARY_BOX_RATIO,
      boundaryWillExit: !!boundary.willExit,
      referenceSequence,
      targetReachThreshold: 0.85,
      restThreshold: 0.2,
      plan: { tol, targetAngle: motion.targetAngle, restAngle: motion.restAngle, dir: motion.dir },
    };
    const seqText = referenceSequence
      ? (th ? ` · trajectory ${referenceSequence.sampleCount} เฟรม` : ` · ${referenceSequence.sampleCount} trajectory frames`)
      : '';
    const baseText = !S.patientId
      ? (th ? 'บันทึกในคลังท่าแล้ว' : 'Saved to library')
      : (th ? 'บันทึกแล้ว' : 'Reference saved');
    return await persistReference(ref, th ? `${baseText} · ใช้ ${motion.repJoints.length} rep joints${seqText}` : `${baseText} · ${motion.repJoints.length} rep joints${seqText}`);
  }

  function sideCandidateJointsForAlternating(ex, bodyRegion, side) {
    const fromExercise = candidateRepJointsForExercise(ex, bodyRegion, [])
      .filter((joint) => joint.startsWith(`${side}_`));
    if (fromExercise.length) return fromExercise;
    return (ROM_REGION_JOINTS[bodyRegion] || ROM_REGION_JOINTS.full)
      .filter((joint) => joint.startsWith(`${side}_`));
  }

  function movementMagnitude(restAngles, angles, joints) {
    const values = joints
      .map((joint) => {
        const rest = restAngles?.[joint];
        const live = angles?.[joint];
        return Number.isFinite(rest) && Number.isFinite(live) ? Math.abs(live - rest) : null;
      })
      .filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function inferTargetIndexForJoints(frames, startIdx, endIdx, restAngles, joints) {
    const start = Math.max(1, Math.min(frames.length - 2, Math.round(startIdx)));
    const end = Math.max(start, Math.min(frames.length - 2, Math.round(endIdx)));
    let bestIdx = start;
    let bestMagnitude = -Infinity;
    for (let i = start; i <= end; i++) {
      const magnitude = movementMagnitude(restAngles, frames[i]?.jointAngles, joints);
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  async function saveSequenceReference(frames, targetOffset = null, regionFlag = null) {
    const exC = getExercise(S.exId);
    const th = getLang() === 'th';
    const first = frames[0];
    const hasCycleTarget = Number.isInteger(targetOffset);
    const targetIdx = hasCycleTarget
      ? Math.max(1, Math.min(frames.length - 2, targetOffset))
      : frames.length - 1;
    const target = frames[targetIdx];
    const last = frames[frames.length - 1];
    const captureRegion = regionFlag?.id || S.romBodyRegion || exC.bodyRegion || 'full';
    const referenceExercise = referenceExerciseForCapture(exC, captureRegion);
    try {
      if (exC.movementPattern === 'alternating') {
        const leftJoints = sideCandidateJointsForAlternating(referenceExercise, captureRegion, 'left');
        const rightJoints = sideCandidateJointsForAlternating(referenceExercise, captureRegion, 'right');
        if (!leftJoints.length || !rightJoints.length) throw new Error('missing-side-joints');
        const mid = Math.floor((frames.length - 1) / 2);
        const leftTargetIdx = inferTargetIndexForJoints(frames, 1, Math.max(1, mid), first.jointAngles, leftJoints);
        const rightTargetIdx = inferTargetIndexForJoints(frames, Math.min(frames.length - 2, Math.max(leftTargetIdx + 2, mid)), frames.length - 2, first.jointAngles, rightJoints);
        if (leftTargetIdx >= rightTargetIdx) throw new Error('bad-alternating-sequence');
        const leftTarget = frames[leftTargetIdx];
        const rightTarget = frames[rightTargetIdx];
        const motion = buildAlternatingReferenceMotion({
          exercise: referenceExercise,
          restAngles: first.jointAngles,
          leftTargetAngles: leftTarget.jointAngles,
          rightTargetAngles: rightTarget.jointAngles,
          restLandmarks: first.landmarks,
          leftTargetLandmarks: leftTarget.landmarks,
          rightTargetLandmarks: rightTarget.landmarks,
        });
        const referenceSequence = buildAlternatingReferenceTrajectory({ frames, motion, leftTargetIdx, rightTargetIdx });
        if (!referenceSequence) throw new Error('bad-alternating-trajectory');
        return await saveMotionReference({
          motion,
          targetAngles: leftTarget.jointAngles,
          targetLandmarks: leftTarget.landmarks,
          boundary: { status: 'inside', willExit: false },
          source: 'sequence:live-alternating-cycle',
          referenceSequence,
          bodyRegion: captureRegion,
          returnRestAngles: last.jointAngles,
          returnRestLandmarks: last.landmarks,
        });
      }
      const motion = buildReferenceMotion({
        exercise: referenceExercise,
        restAngles: first.jointAngles,
        targetAngles: target.jointAngles,
        restLandmarks: first.landmarks,
        targetLandmarks: target.landmarks,
      });
      const referenceSequence = buildReferenceTrajectory({
        frames,
        motion,
        targetFrameIndex: hasCycleTarget ? targetIdx : null,
        targetFrameT: hasCycleTarget ? target.t : null,
      });
      if (!referenceSequence) throw new Error('bad-sequence');
      const ok = await saveMotionReference({
        motion,
        targetAngles: target.jointAngles,
        targetLandmarks: target.landmarks,
        boundary: { status: 'inside', willExit: false },
        source: hasCycleTarget ? 'sequence:live-cycle' : 'sequence:live',
        referenceSequence,
        bodyRegion: captureRegion,
        returnRestAngles: hasCycleTarget ? last.jointAngles : null,
        returnRestLandmarks: hasCycleTarget ? last.landmarks : null,
      });
      return ok;
    } catch (e) {
      toast(exC.movementPattern === 'alternating'
        ? (th ? 'motion ยังไม่ชัดพอ ลองบันทึก rest → ซ้าย → rest → ขวา → rest ใหม่' : 'Motion was not clear enough. Record rest → left → rest → right → rest again.')
        : (th ? 'motion ยังไม่ชัดพอ ลองบันทึก rest → target → rest ใหม่' : 'Motion was not clear enough. Record rest → target → rest again.'));
      return false;
    }
  }

  function saveDetectedPose({ landmarks, jointAngles, boundary, source = null }) {
    const exC = getExercise(S.exId);
    if (isMotionExercise(exC)) {
      toast(currentCaptureHint(exC));
      return;
    }
    void saveHoldReference({ landmarks, jointAngles, boundary, source });
  }

  function capture() {
    if (!engine.state.ready) { toast(t('loadingModel')); return; }
    const res = engine.detectVideo(R.video, performance.now());
    const live = res?.landmarks?.[0];
    if (!live) { toast(t('noPose')); return; }
    const boundary = currentBoundary(live);
    updateBoundaryUi(boundary, `${live.length} pts`);
    if (boundary.status !== 'inside') {
      toast(getLang() === 'th' ? boundary.hintTh : boundary.hint);
      return;
    }
    const jointAngles = jointAngleCalculator(live);
    saveDetectedPose({ landmarks: live, jointAngles, boundary });
  }

  async function clearRef() {
    try {
      await clearReference(S.exId, S.patientId);
      S.reference = null;
      S.captureDraft = null;
      resetValidationEngine();
      updateCaptureButtonLabel();
      toast(t('done'));
      renderPanel();
    } catch (e) {
      toast(S.patientId
        ? (getLang() === 'th' ? 'ลบ reference บนคลาวด์ไม่สำเร็จ' : 'Reference cloud delete failed')
        : (getLang() === 'th' ? 'ลบ reference ในคลังไม่สำเร็จ' : 'Library reference delete failed'));
    }
  }

  function exportRefs() {
    const all = getAllReferences(S.patientId);
    if (!Object.keys(all).length) { toast(getLang() === 'th' ? 'ยังไม่มี reference' : 'No references yet'); return; }
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'physioai_references.json' });
    document.body.append(a); a.click(); a.remove();
    toast(getLang() === 'th' ? 'ส่งออกแล้ว' : 'Exported');
  }

  async function importRefs(file) {
    if (!file) return;
    try {
      const all = JSON.parse(await file.text());
      let n = 0;
      for (const [exId, ref] of Object.entries(all)) {
        if (ref && ref.jointAngles) { await saveReference(exId, ref, S.patientId); n++; }
      }
      loadRef(); renderPanel();
      toast((getLang() === 'th' ? 'นำเข้าแล้ว ' : 'Imported ') + n + ' refs');
    } catch (e) { toast(S.patientId
      ? (getLang() === 'th' ? 'ไฟล์ไม่ถูกต้อง หรือบันทึกขึ้นคลาวด์ไม่สำเร็จ' : 'Invalid file or cloud save failed')
      : (getLang() === 'th' ? 'ไฟล์ไม่ถูกต้อง หรือบันทึกเข้าคลังไม่สำเร็จ' : 'Invalid file or library save failed')); }
  }

  async function togglePlan() {
    if (!S.patientId) { toast(getLang() === 'th' ? 'เลือกผู้ป่วยก่อน' : 'Select a patient first'); return; }
    const plan = getPlan(S.patientId);
    const next = plan.includes(S.exId) ? plan.filter((x) => x !== S.exId) : [...plan, S.exId];
    try {
      await savePlan(S.patientId, next);
      const name = S.patients.find((p) => p.id === S.patientId)?.name || '';
      toast(t('planSaved', { name }));
      renderPanel();
    } catch (e) {
      toast(getLang() === 'th' ? 'บันทึกขึ้นคลาวด์ไม่สำเร็จ' : 'Cloud save failed');
    }
  }

  async function savePlanSettings() {
    if (!S.reference) { toast(currentCaptureHint()); return; }
    const ex = getExercise(S.exId);
    const joint = S.reference.dominantJoint || S.reference.primaryJoint || ex.primaryJoint;
    const targetAngle = Math.round(S.reference.jointAngles?.[joint] ?? S.reference.plan?.targetAngle ?? ex.target);
    const restAngle = Math.round(S.reference.restJointAngles?.[joint] ?? S.reference.plan?.restAngle ?? ex.rest);
    const dir = S.reference.jointMotion?.[joint]?.dir ?? S.reference.plan?.dir ?? ex.dir;
    S.reference = { ...S.reference, plan: { ...S.plan, targetAngle, restAngle, dir } };
    if (ex.source === 'custom') {
      updateCustomExercise(S.exId, { tol: S.plan.tol, target: targetAngle, rest: restAngle, dir });
    }
    await persistReference(S.reference);
  }

  // Paint a loaded still image into the SAME video-frame overlay the live camera uses,
  // so the BlazePose skeleton is drawn over the photo (instead of the camera feed).
  // A loaded photo must NOT be selfie-mirrored, so we drop the canvas's scaleX(-1).
  function showImageOnCanvas(img) {
    if (S.cameraOn) stopCam();                 // switch from live feed to still preview
    S.imageMode = true; S.boundary = null; S.boundaryFrame = null;
    const w = img.naturalWidth || img.width, hgt = img.naturalHeight || img.height;
    R.canvas.width = w; R.canvas.height = hgt; // buffer = image size → skeleton (normalized × size) aligns
    R.canvas.style.transform = 'none';
    const ctx = R.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);          // photo fills the canvas; drawer() paints on top
  }

  async function fromImage(file) {
    if (!file) return;
    toast(getLang() === 'th' ? 'กำลังตรวจจับ…' : 'Detecting…');
    const img = new Image(); img.src = URL.createObjectURL(file);
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); });
      if (!engine.state.ready) await initEngine();
      showImageOnCanvas(img);                   // show the photo in the frame right away
      const res = await engine.detectImage(img);
      const det = res?.landmarks?.[0];
      if (!det) {                               // no pose → keep the photo visible, flag it
        const boundary = currentBoundary(null, { reset: true });
        drawBoundaryBox(R.canvas.getContext('2d'), boundary);
        updateBoundaryUi(boundary, t('noPose'));
        toast(t('noPose')); URL.revokeObjectURL(img.src); return;
      }
      drawer(det, { color: '#2F5D50', accent: '#7BA88F' });          // skeleton over the photo
      const boundary = currentBoundary(det, { reset: true });
      drawBoundaryBox(R.canvas.getContext('2d'), boundary);
      updateBoundaryUi(boundary, `${det.length} pts`);
      const jointAngles = jointAngleCalculator(det);
      drawPrimaryAngleOverlay(R.canvas.getContext('2d'), det, jointAngles);
      updateTable(jointAngles);
      if (boundary.status !== 'inside') {
        toast(getLang() === 'th' ? boundary.hintTh : boundary.hint);
        URL.revokeObjectURL(img.src); return;
      }
      saveDetectedPose({ landmarks: det, jointAngles, boundary, source: 'image:' + file.name });
      renderPanel();                            // rebuild side panel (does NOT touch the video canvas)
      updateTable(jointAngles);                 // fill the Live column from the detected pose
      URL.revokeObjectURL(img.src);
    } catch (e) { toast(t('noPose')); URL.revokeObjectURL(img.src); }
  }

  const imgInput = document.getElementById('imgInput');
  const refInput = document.getElementById('refInput');
  let disposed = false;

  const handleImageInput = (e) => { fromImage(e.target.files?.[0]); e.target.value = ''; };
  const handleRefInput = (e) => { importRefs(e.target.files?.[0]); e.target.value = ''; };
  const handleKeydown = (e) => {
    if (e.code === 'Space' && S.cameraOn && S.mode === 'setup') {
      e.preventDefault();
      capture();
    }
  };
  const handleBeforeUnload = () => { stopCamera(R.video); engine.close(); };

  imgInput?.addEventListener('change', handleImageInput);
  refInput?.addEventListener('change', handleRefInput);
  document.addEventListener('keydown', handleKeydown);
  const unsubscribeLang = onLangChange(render);
  window.addEventListener('beforeunload', handleBeforeUnload);

  (async () => {
    await ensureTherapist();              // gate: therapist login overlay if not signed in
    if (disposed) return;
    authed = true;
    try {
      await refreshPatients();              // real linked patients; demo only when explicitly enabled/local
    } catch (e) {
      if (disposed) return;
      toast(getLang() === 'th' ? 'โหลดรายชื่อผู้ป่วยไม่สำเร็จ' : 'Could not load patients');
      S.patients = [];
      S.patientId = null;
    }
    if (disposed) return;
    render();
    void initEngine();
  })();

  return () => {
    disposed = true;
    try { stopClipPlayback(); } catch {}
    try { if (S.previewRaf) cancelAnimationFrame(S.previewRaf); } catch {}
    try { stopCamera(R.video); } catch {}
    try { engine.close(); } catch {}
    imgInput?.removeEventListener('change', handleImageInput);
    refInput?.removeEventListener('change', handleRefInput);
    document.removeEventListener('keydown', handleKeydown);
    if (typeof unsubscribeLang === 'function') unsubscribeLang();
    window.removeEventListener('beforeunload', handleBeforeUnload);
    document.querySelectorAll('.nav, .nav-back').forEach((node) => node.remove());
    const topNode = document.getElementById('top');
    const rootNode = document.getElementById('root');
    if (topNode) clear(topNode);
    if (rootNode) clear(rootNode);
  };
}
