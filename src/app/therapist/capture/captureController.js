import { h, clear, mountNav, onLangChange, getLang, t, icon, ringSVG, toast } from '../../../../shared/core/ui.js';
import { BODY_REGIONS, COUNT_MODES, EXERCISES, MOVEMENT_PATTERNS, getExercises, getExercise, exLabel, saveCustomExercise, updateCustomExercise, deleteCustomExercise } from '../../../../shared/core/exercises.js';
import { getReference, getAllReferences, saveReference, clearReference, getPlan, savePlan, syncPatientCloudData } from '../../../../shared/core/store.js';
import { getSettings, saveSettings } from '../../../../shared/core/store.js';
import { apiPost } from '../../../../shared/core/api.js';
import { exerciseWithModelManifest, fetchAiModels, selectModelManifestForExercise } from '../../../../shared/core/ai-models.js';
import { ensureTherapist, getTherapist, logout, isGuest } from '../../../../shared/core/auth-ui.js';
import { fetchPatients, linkPatient, createPatient } from '../../../../shared/core/patients.js';
import { LANDMARK_NAMES, PoseLandmarker, createPoseEngine, makeDrawer, startCamera, stopCamera } from '../../../../shared/ai/PoseDetection.js';
import { jointAngleCalculator, JOINT_SPECS } from '../../../../shared/ai/JointAngleCalculator.js';
import { ANGLE_OVERLAY_COLORS, drawAngleOverlayForJoints } from '../../../../shared/ai/AngleOverlay.js';
import { BOUNDARY_BOX_RATIO, drawBoundaryBox, evaluateBoundaryBox } from '../../../../shared/ai/BoundaryBoxGate.js';
import { createEmaLandmarkFilter } from '../../../../shared/ai/LandmarkFilters.js';
import { createMotionDatasetRecorder } from '../../../../shared/ai/MotionDatasetRecorder.js';
import { isReviewedTrainableRow, reviewDatasetRow } from '../../../../shared/ai/DatasetLabeler.js';
import { motionDatasetRowsToJsonl } from '../../../../shared/ai/MotionDataset.js';
import { createTherapistCaptureState, resetValidationState } from './captureState.js';
import { completedDatasetRepFromSnapshot, completionSourceFromSnapshot, datasetPhaseFromSnapshot } from './datasetCapture.js';
import {
  persistReferenceForCapture,
  saveHoldReferenceForCapture,
  saveMotionReferenceForCapture,
  saveSequenceReferenceForCapture,
} from './referenceSaver.js';
import {
  boundaryClass as captureBoundaryClass,
  boundaryText as captureBoundaryText,
  canRecordSequence,
  captureButtonText as captureUiButtonText,
  captureHint,
  buildReferencePanelModel,
  isMotionExercise,
} from './captureUI.js';
import {
  ANGLE_PICKER_JOINTS,
  ROM_BODY_REGION_IDS,
  ROM_REGION_JOINTS,
  ROM_REGION_PRIMARY,
  activeOverlayJoints as captureActiveOverlayJoints,
  bodyRegionFlag as captureBodyRegionFlag,
  candidateRepJointsForExercise as captureCandidateRepJointsForExercise,
  cleanAngles,
  cleanLandmarks,
  referenceExerciseForCapture as captureReferenceExerciseForCapture,
  toleranceOverride as captureToleranceOverride,
} from './captureJoints.js';
import {
  appendSequenceRecordingFrame,
  beginSequenceRecordingState,
  finishSequenceRecordingState,
  formatMs,
  sequenceStartProblem,
} from './sequenceRecorder.js';
import {
  buildDatasetJsonlExportForCapture,
  buildDatasetPreviewSequence,
  buildSkeletonExportPayloadForCapture,
  createClipPreviewRuntime,
  downloadJsonFile,
  downloadTextFile,
  exportTimestamp,
  safeExportId,
  startClipPlaybackState,
  stepClipPlaybackState,
  stopClipPlaybackState,
  setSequenceMarkerFromPreviewIndex,
} from './previewController.js';
import { getValidationFrameProcessor, validationFeedbackText } from './validationController.js';
import { prepareLiveCaptureFrameWithAi } from './captureFrame.js';
import { saveReviewedDatasetRows } from './datasetStorage.js';
import { renderCapturePanel } from './capturePanel.js';
import { renderCaptureShell, renderCaptureTopbar } from './captureShell.js';

export function mountTherapistCapture() {

  const engine = createPoseEngine();
  const S = createTherapistCaptureState({
    exerciseId: EXERCISES[0].id,
    variant: getSettings().modelVariant,
  });
  let R = {}; // dom refs
  let drawer = null;
  let renderingLiveFrame = false;
  let authed = false; // gate: render() is a no-op until ensureTherapist() resolves (blocks cross-tab pre-auth paint)

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

  async function refreshAiModels() {
    S.aiModels = await fetchAiModels();
    S.aiModelsLoaded = true;
    resetValidationEngine();
  }

  function activeModelManifestForExercise(ex = getExercise(S.exId)) {
    return selectModelManifestForExercise(ex, S.aiModels);
  }

  function exerciseForAiRuntime(ex = getExercise(S.exId)) {
    return exerciseWithModelManifest(ex, activeModelManifestForExercise(ex));
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
    return captureBoundaryText(boundary, { lang: getLang(), translate: t });
  }

  function boundaryClass(boundary) {
    return captureBoundaryClass(boundary);
  }

  function updateBoundaryUi(boundary, prefix = '') {
    S.boundary = boundary;
    S.boundaryFrame = boundary?.nextFrame || null;
    updateAiReadinessFromBoundary(boundary);
    if (R.poseStatus) {
      R.poseStatus.textContent = prefix ? `${prefix} · ${boundaryText(boundary)}` : boundaryText(boundary);
      R.poseStatus.className = boundaryClass(boundary);
    }
    if (R.captureBtn) R.captureBtn.disabled = !(S.cameraOn && boundary?.status === 'inside');
  }

  function updateAiReadinessFromBoundary(boundary) {
    S.aiReadiness = {
      schemaId: boundary?.landmarkSchemaId || getExercise(S.exId)?.landmarkSchemaId || null,
      trainable: boundary?.trainable === true,
      scoreable: boundary?.scoreable === true,
      missingPrimary: boundary?.primary ? [...(boundary.primary.missing || []), ...(boundary.primary.lowVisibility || [])] : [],
      missingStabilizer: boundary?.stabilizer ? [...(boundary.stabilizer.missing || []), ...(boundary.stabilizer.lowVisibility || [])] : [],
      dataQuality: boundary?.dataQuality || null,
      hint: boundary?.hint || '',
      hintTh: boundary?.hintTh || '',
      primary: boundary?.primary || null,
      stabilizer: boundary?.stabilizer || null,
    };
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

  function captureButtonText() {
    return captureUiButtonText(getExercise(S.exId), { lang: getLang(), translate: t });
  }

  function currentCaptureHint(ex = getExercise(S.exId)) {
    return captureHint(ex, { lang: getLang(), translate: t });
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

  function trimPendingSequence(which, rawValue) {
    const seq = S.pendingSequence;
    if (!seq?.frames?.length) return;
    const next = setSequenceMarkerFromPreviewIndex(seq, which, rawValue);
    S.previewFrameIdx = which === 'start' ? next.startIdx : which === 'target' ? next.targetIdx : next.endIdx;
    stopClipPlayback();
    renderPanel();
    renderClipPreview();
  }

  function activePendingSequence() {
    return S.pendingSequence?.exerciseId === S.exId ? S.pendingSequence : null;
  }

  const clipPreviewRuntime = createClipPreviewRuntime({
    state: S,
    refs: R,
    activeSequence: activePendingSequence,
    overlayJoints: activeOverlayJoints,
    lang: getLang,
    icon,
    formatMs,
    makeDrawer,
    getDrawer: () => drawer,
    setDrawer: (nextDrawer) => { drawer = nextDrawer; },
    drawPrimaryAngleOverlay: (ctx, landmarks, jointAngles) => {
      const wasImageMode = S.imageMode;
      S.imageMode = true;
      drawPrimaryAngleOverlay(ctx, landmarks, jointAngles);
      S.imageMode = wasImageMode;
    },
    requestFrame: requestAnimationFrame,
    cancelFrame: cancelAnimationFrame,
  });

  function stopClipPlayback() {
    clipPreviewRuntime.stop();
  }

  function clipPreviewIndex(sequence = activePendingSequence()) {
    return clipPreviewRuntime.clipPreviewIndex(sequence);
  }

  function sequenceMarkerLabel(sequence, idx) {
    return clipPreviewRuntime.sequenceMarkerLabel(sequence, idx);
  }

  function setClipPreviewIndex(idx, { stop = true } = {}) {
    clipPreviewRuntime.setPreviewIndex(idx, { stopPlayback: stop });
  }

  function jumpClipPreview(which) {
    clipPreviewRuntime.jump(which);
  }

  function setSequenceMarkerFromPreview(which) {
    const seq = activePendingSequence();
    if (!seq?.frames?.length) return;
    trimPendingSequence(which, clipPreviewIndex(seq));
  }

  function buildCurrentSkeletonParameterPayload() {
    const sequence = activePendingSequence();
    const ex = getExercise(S.exId);
    const selectedRegion = sequence?.bodyRegionFlag || selectedBodyRegionFlag();
    const overlayJoints = Array.isArray(sequence?.angleOverlayJoints) ? sequence.angleOverlayJoints : S.angleOverlayJoints;
    return buildSkeletonExportPayloadForCapture({
      sequence,
      exercise: ex,
      selectedRegion,
      overlayJoints,
      selectedJoints: candidateRepJointsForExercise(ex, selectedRegion?.id, overlayJoints),
      fallbackOverlayJoints: activeOverlayJoints(),
      exerciseLabel: exLabel(ex, t),
      landmarkNames: LANDMARK_NAMES,
      poseConnections: PoseLandmarker.POSE_CONNECTIONS || [],
    });
  }

  function toastExportError(error, format = 'JSON') {
    if (error === 'no_motion_clip') {
      toast(getLang() === 'th' ? 'ยังไม่มีคลิป motion ให้ export' : 'No motion clip to export.');
    } else if (error === 'missing_body_region') {
      toast(getLang() === 'th'
        ? `เลือก Body region ใน Motion setup ก่อน export ${format}`
        : `Select a Motion setup body region before exporting ${format}.`);
    } else {
      toast(getLang() === 'th' ? `Export ${format} ไม่สำเร็จ` : `Could not export ${format}.`);
    }
  }

  function exportSkeletonParameters() {
    const { payload, error } = buildCurrentSkeletonParameterPayload();
    if (error) {
      toastExportError(error, 'JSON');
      return;
    }
    if (!payload) {
      toastExportError('unknown', 'JSON');
      return;
    }
    const safeId = safeExportId(S.exId);
    const stamp = exportTimestamp();
    downloadJsonFile(payload, `physioai_skeleton_${safeId}_${stamp}.json`);
    toast(getLang() === 'th' ? 'Export debug skeleton JSON แล้ว' : 'Debug skeleton JSON exported.');
  }

  function exportMotionDatasetJsonl() {
    const { payload, error } = buildCurrentSkeletonParameterPayload();
    if (error) {
      toastExportError(error, 'JSONL');
      return;
    }
    const { jsonl, error: datasetError } = buildDatasetJsonlExportForCapture(payload, {
      label: 'unlabeled',
      source: 'therapist_capture',
      subjectId: 'anon_001',
    });
    if (datasetError) {
      toastExportError(datasetError, 'JSONL');
      return;
    }
    const safeId = safeExportId(S.exId);
    const stamp = exportTimestamp();
    downloadTextFile(jsonl, `physioai_dataset_${safeId}_${stamp}.jsonl`, { type: 'application/x-ndjson' });
    toast(getLang() === 'th'
      ? 'Export debug JSONL แล้ว ไฟล์นี้ยังไม่ใช่ trainable rep'
      : 'Debug JSONL exported. This clip is not a trainable rep.');
  }

  function datasetRecorder() {
    if (!S.dataset.recorder) {
      const ex = getExercise(S.exId);
      S.dataset.recorder = createMotionDatasetRecorder({
        exercise: ex,
        landmarkSchemaId: ex.landmarkSchemaId,
        labelTarget: S.dataset.labelTarget,
        targetReps: S.dataset.targetReps,
      });
    }
    return S.dataset.recorder;
  }

  function setDatasetLabelTarget(value) {
    S.dataset.labelTarget = value;
    S.dataset.recorder = null;
    renderPanel();
  }

  function setDatasetTargetReps(value) {
    const n = Math.max(1, Math.min(100, Number(value) || 10));
    S.dataset.targetReps = n;
    S.dataset.recorder = null;
    renderPanel();
  }

  function startDatasetRecording() {
    const th = getLang() === 'th';
    if (!S.cameraOn || !engine.state.ready) {
      toast(th ? 'เปิดกล้องก่อนเก็บข้อมูล' : 'Start the camera before recording a dataset.');
      return;
    }
    if (!S.aiReadiness.trainable) {
      toast(th ? (S.aiReadiness.hintTh || 'ยังไม่พร้อมเก็บข้อมูลฝึก AI') : (S.aiReadiness.hint || 'AI training readiness is not ready.'));
      return;
    }
    const recorder = datasetRecorder();
    recorder.start();
    S.dataset.active = true;
    renderPanel();
    toast(th ? 'เริ่มเก็บข้อมูลฝึก AI' : 'AI dataset recording started.');
  }

  function stopDatasetRecording() {
    const recorder = datasetRecorder();
    if (S.dataset.active && recorder.frames.length) {
      const row = recorder.completeRep({
        reviewed: false,
        suggestedLabel: S.dataset.labelTarget,
        repComplete: false,
        completionSource: 'manual_stop',
      });
      S.dataset.rows = recorder.rows;
      if (row.dataQuality !== 'usable') {
        toast(getLang() === 'th' ? `rep ถูก reject: ${row.dataQuality}` : `Rep rejected: ${row.dataQuality}`);
      } else {
        toast(getLang() === 'th'
          ? 'clip ที่หยุดเองยังไม่ครบ rep จึงไม่ใช้ train'
          : 'Manual stop created an incomplete clip that is not trainable.');
      }
    }
    recorder.stop();
    S.dataset.active = false;
    S.dataset.reviewOpen = true;
    renderPanel();
  }

  function maybeRecordDatasetFrame({ landmarks, jointAngles, boundary, snapshot, now }) {
    if (!S.dataset.active) return;
    const recorder = datasetRecorder();
    recorder.pushFrame({
      timestamp: now,
      landmarks,
      jointAngles,
      boundary,
      phase: datasetPhaseFromSnapshot(snapshot),
      safety: {
        status: boundary?.readinessStatus,
        dataQuality: boundary?.dataQuality,
        schemaId: boundary?.landmarkSchemaId,
        missingPrimary: S.aiReadiness.missingPrimary,
        missingStabilizer: S.aiReadiness.missingStabilizer,
      },
    });
    if (completedDatasetRepFromSnapshot(snapshot)) {
      recorder.completeRep({
        reviewed: false,
        suggestedLabel: S.dataset.labelTarget,
        repComplete: true,
        completionSource: completionSourceFromSnapshot(snapshot) || 'rule_completed_rep',
      });
      S.dataset.rows = recorder.rows;
      if (S.dataset.rows.length >= S.dataset.targetReps) {
        S.dataset.active = false;
        recorder.stop();
        S.dataset.reviewOpen = true;
        toast(getLang() === 'th' ? 'เก็บครบ target reps แล้ว' : 'Target reps recorded.');
      }
      renderPanel();
    }
  }

  function reviewDatasetRep(index, label) {
    try {
      const rows = S.dataset.rows.slice();
      rows[index] = reviewDatasetRow(rows[index], label);
      S.dataset.rows = rows;
      renderPanel();
    } catch {
      toast(getLang() === 'th' ? 'label ไม่ถูกต้อง' : 'Invalid label.');
    }
  }

  function stopDatasetPreview({ clearSequence = false, rerender = false } = {}) {
    stopClipPlaybackState(S.dataset, cancelAnimationFrame);
    if (clearSequence) {
      S.dataset.previewSequence = null;
      S.dataset.previewRowIndex = null;
      S.dataset.previewFrameIdx = null;
    }
    if (rerender) renderPanel();
  }

  function drawDatasetPreviewFrame(sequence, index) {
    const frame = sequence?.frames?.[index];
    if (!frame || !R.canvas) return false;
    const ctx = R.canvas.getContext('2d');
    ctx.clearRect(0, 0, R.canvas.width, R.canvas.height);
    const landmarks = frame.landmarks || [];
    if (landmarks.length) {
      drawer ||= makeDrawer(ctx);
      drawer(landmarks, { color: '#2F5D50', accent: '#7BA88F' });
      drawBoundaryBox(ctx, { status: frame.boundaryStatus === 'inside' ? 'inside' : 'outside' });
      drawPrimaryAngleOverlay(ctx, landmarks, frame.jointAngles || {});
    }
    updateTable(frame.jointAngles || {});
    const total = sequence.frames.length;
    const phase = frame.phase || 'preview';
    updateScore(null, `Preview rep ${(S.dataset.previewRowIndex ?? 0) + 1} · ${phase} · ${index + 1}/${total}`);
    return true;
  }

  function stepDatasetPreview(now) {
    const sequence = S.dataset.previewSequence;
    const step = stepClipPlaybackState(S.dataset, sequence, now);
    if (!step.active) return;
    drawDatasetPreviewFrame(sequence, step.index);
    if (step.done) {
      stopDatasetPreview({ rerender: true });
      return;
    }
    S.dataset.previewRaf = requestAnimationFrame(stepDatasetPreview);
  }

  function previewDatasetRep(index) {
    const row = S.dataset.rows?.[index];
    const sequence = buildDatasetPreviewSequence(row);
    if (!sequence || !R.canvas) {
      toast(getLang() === 'th' ? 'ไม่มี frame ให้ preview' : 'No dataset frame to preview.');
      return;
    }
    stopClipPlayback();
    stopDatasetPreview();
    S.dataset.previewRowIndex = index;
    S.dataset.previewSequence = sequence;
    S.dataset.previewFrameIdx = 0;
    drawDatasetPreviewFrame(sequence, 0);
    if (sequence.frames.length > 1 && startClipPlaybackState(S.dataset, sequence)) {
      renderPanel();
      drawDatasetPreviewFrame(sequence, 0);
      S.dataset.previewRaf = requestAnimationFrame(stepDatasetPreview);
    }
  }

  function skipDatasetRep(index) {
    const rows = S.dataset.rows.slice();
    if (rows[index]) {
      rows[index] = {
        ...rows[index],
        labelStatus: 'skipped',
        trainable: false,
        scoreable: false,
      };
      S.dataset.rows = rows;
      renderPanel();
    }
  }

  function toggleDatasetReview() {
    S.dataset.reviewOpen = !S.dataset.reviewOpen;
    renderPanel();
  }

  function exportDatasetBatchJsonl() {
    const rows = (S.dataset.rows || []).filter(isReviewedTrainableRow);
    if (!rows.length) {
      toast(getLang() === 'th' ? 'ยังไม่มี reviewed/trainable rows ให้ export' : 'No reviewed/trainable rows to export.');
      return;
    }
    const safeId = safeExportId(S.exId);
    const stamp = exportTimestamp();
    downloadTextFile(motionDatasetRowsToJsonl(rows), `physioai_dataset_batch_${safeId}_${stamp}.jsonl`, { type: 'application/x-ndjson' });
    toast(getLang() === 'th' ? `Export ${rows.length} reviewed reps แล้ว` : `Exported ${rows.length} reviewed reps.`);
  }

  async function saveDatasetBatchToApi() {
    const rows = S.dataset.rows || [];
    if (!rows.some(isReviewedTrainableRow)) {
      toast(getLang() === 'th' ? 'ยังไม่มี reviewed/trainable rows ให้บันทึก' : 'No reviewed/trainable rows to save.');
      return;
    }
    const result = await saveReviewedDatasetRows({
      rows,
      patientId: S.patientId,
      postDataset: apiPost,
    });
    if (result.ok) {
      toast(getLang() === 'th'
        ? `บันทึก dataset ${result.saved} reps แล้ว`
        : `Saved ${result.saved} dataset reps.`);
      return;
    }
    console.warn('dataset_save_failed', result.errors);
    toast(getLang() === 'th'
      ? `บันทึกได้ ${result.saved}/${result.attempted} reps`
      : `Saved ${result.saved}/${result.attempted} dataset reps.`);
  }

  function updateClipPreviewControls() {
    clipPreviewRuntime.updateControls();
  }

  function renderClipPreview() {
    clipPreviewRuntime.render();
  }

  function toggleClipPlayback() {
    clipPreviewRuntime.togglePlayback();
  }

  function activeOverlayJoints() {
    return captureActiveOverlayJoints({
      selectedJoints: S.angleOverlayJoints || [],
      reference: S.reference,
      exercise: getExercise(S.exId),
    });
  }

  function bodyRegionFlag(regionId, source = 'motion_setup') {
    return captureBodyRegionFlag(regionId, source);
  }

  function selectedBodyRegionFlag(source = 'motion_setup') {
    return bodyRegionFlag(S.romBodyRegion, source);
  }

  function candidateRepJointsForExercise(ex = getExercise(S.exId), bodyRegion = null, overlayJoints = S.angleOverlayJoints) {
    return captureCandidateRepJointsForExercise(ex, {
      bodyRegion,
      overlayJoints,
      romBodyRegion: S.romBodyRegion,
    });
  }

  function referenceExerciseForCapture(ex = getExercise(S.exId), bodyRegion = null) {
    return captureReferenceExerciseForCapture(ex, {
      bodyRegion,
      romBodyRegion: S.romBodyRegion,
      overlayJoints: S.angleOverlayJoints,
    });
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
    S.angleOverlayJoints = joints.filter((joint) => JOINT_SPECS.some((spec) => spec.joint === joint));
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
    renderCaptureTopbar({
      state: S,
      refs: R,
      dom: { h, clear, icon, t, getLang },
      data: { getTherapist, isGuest },
      actions: {
        addPatient,
        toggleCamera,
        logoutAndReload: () => { logout(); location.reload(); },
        onPatientChange: async (e) => {
          S.patientId = e.target.value || null;
          try { await loadPatientData(S.patientId); }
          catch {
            toast(getLang() === 'th' ? 'โหลดข้อมูลผู้ป่วยจากคลาวด์ไม่สำเร็จ' : 'Could not load patient cloud data');
            loadRef();
          }
          renderPanel();
        },
        onModelChange: (e) => {
          S.variant = e.target.value;
          saveSettings({ modelVariant: S.variant });
          if (engine.state.ready) {
            engine.close();
            engine.init(S.variant).catch(() => {});
          }
        },
      },
    });
  }

  // ── Layout ──────────────────────────────────────────────────
  function render() {
    if (!authed) return;
    topbar();
    const { canvas } = renderCaptureShell({
      state: S,
      refs: R,
      dom: { h, clear, icon, t, getLang },
      actions: {
        captureButtonText,
        capture,
        setMode,
        toggleSequenceRecording,
        setClipPreviewIndex,
        toggleClipPlayback,
        jumpClipPreview,
        setSequenceMarkerFromPreview,
        exportSkeletonParameters,
        exportMotionDatasetJsonl,
        exportRefs,
        importRefsClick: () => document.getElementById('refInput').click(),
        imageInputClick: () => document.getElementById('imgInput').click(),
        clearRef,
      },
    });
    drawer = makeDrawer(canvas.getContext('2d'));
    renderPanel();
    updateRecordButton();
    mountNav('therapist/capture');
  }

  function renderPanel() {
    renderCapturePanel({
      state: S,
      refs: R,
      dom: {
        h,
        clear,
        icon,
        ringSVG,
        toast,
        t,
        getLang,
      },
      data: {
        BODY_REGIONS,
        COUNT_MODES,
        EXERCISES,
        MOVEMENT_PATTERNS,
        JOINT_SPECS,
        ANGLE_PICKER_JOINTS,
        ROM_BODY_REGION_IDS,
        getExercises,
        getExercise,
        exLabel,
        saveCustomExercise,
        deleteCustomExercise,
        getPlan,
      },
      helpers: {
        buildReferencePanelModel,
        candidateRepJointsForExercise,
        currentCaptureHint,
        formatMs,
      },
      actions: {
        loadRef,
        updateCaptureButtonLabel,
        stopClipPlayback,
        renderClipPreview,
        trimPendingSequence,
        saveSequenceReference,
        exportSkeletonParameters,
        exportMotionDatasetJsonl,
        selectRomBodyRegion,
        toggleOverlayJoint,
        resetRomMeasurement,
        savePlanSettings,
        togglePlan,
        updateTable,
        setCaptureWorkflow,
        setDatasetLabelTarget,
        setDatasetTargetReps,
        startDatasetRecording,
        stopDatasetRecording,
        previewDatasetRep,
        reviewDatasetRep,
        skipDatasetRep,
        toggleDatasetReview,
        exportDatasetBatchJsonl,
        saveDatasetBatchToApi,
        toggleAdvanced,
      },
    });
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
      S.landmarkFilter = createEmaLandmarkFilter({ minVisibility: exerciseForAiRuntime()?.minVisibility ?? 0.35 });
      R.camBtn.className = 'btn danger'; R.camBtn.innerHTML = icon('close', { size: 16, color: '#FBFAF5' }) + ' ' + t('stopCamera');
      R.captureBtn.disabled = true;
      requestAnimationFrame(loop);
    } catch (e) { toast(t('cameraDenied')); }
  }
  function stopCam() {
    stopDatasetPreview({ clearSequence: true });
    if (S.recording) {
      S.recording = null;
      updateRecordButton();
    }
    S.landmarkFilter?.reset();
    stopCamera(R.video); S.cameraOn = false; S.boundary = null; S.boundaryFrame = null; S.landmarkFilter = null;
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
      renderResult(res).catch((error) => {
        console.warn('Capture render failed', error);
      });
    }
    requestAnimationFrame(loop);
  }

  async function renderResult(res) {
    if (activePendingSequence()) return;
    if (S.dataset.previewPlaying) return;
    if (renderingLiveFrame) return;
    renderingLiveFrame = true;
    try {
      const ctx = R.canvas.getContext('2d');
      ctx.clearRect(0, 0, R.canvas.width, R.canvas.height);
      const exercise = exerciseForAiRuntime();
      const frame = await prepareLiveCaptureFrameWithAi({
        rawLandmarks: res?.landmarks?.[0] || null,
        landmarkFilter: S.landmarkFilter,
        exercise,
        reference: S.reference,
        mode: S.mode,
        previousBoundaryFrame: S.boundaryFrame,
        currentBoundary,
        validationProcessorFor,
        now: () => performance.now(),
      });
      if (!frame.hasPose) {
        drawBoundaryBox(ctx, frame.boundary);
        updateBoundaryUi(frame.boundary, t('noPose'));
        updateTable(null); updateScore(null); return;
      }
      updateBoundaryUi(frame.boundary, `${frame.live.length} pts`);
      if (frame.snapshot) {
        if (frame.ghostLandmarks) drawer(frame.ghostLandmarks, { ghost: true });
        updateScore(frame.snapshot.overallScore, validationFeedbackText(frame.snapshot, frame.snapshot.cue?.text, { lang: getLang() }));
      } else if (frame.validationUnavailable) {
        updateScore(null, currentCaptureHint(exercise));
      } else updateScore(null);
      drawer(frame.live, { color: frame.colors[0], accent: frame.colors[1] });
      drawBoundaryBox(ctx, frame.boundary);
      drawPrimaryAngleOverlay(ctx, frame.live, frame.liveAngles);
      updateTable(frame.liveAngles);
      maybeRecordSequenceFrame({ landmarks: frame.live, jointAngles: frame.liveAngles, boundary: frame.boundary, now: performance.now() });
      maybeRecordDatasetFrame({
        landmarks: frame.live,
        jointAngles: frame.liveAngles,
        boundary: frame.boundary,
        snapshot: frame.snapshot,
        now: performance.now(),
      });
    } finally {
      renderingLiveFrame = false;
    }
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

  function toleranceOverride(ex, ref = S.reference) {
    return captureToleranceOverride(ex, ref, S.plan);
  }

  function maybeRecordSequenceFrame({ landmarks, jointAngles, boundary, now }) {
    const appended = appendSequenceRecordingFrame(S.recording, {
      landmarks,
      jointAngles,
      boundary,
      now,
      cleanAngles,
      cleanLandmarks,
    });
    if (appended) updateRecordButton();
  }

  function startSequenceRecording() {
    const ex = getExercise(S.exId);
    const regionFlag = selectedBodyRegionFlag();
    const problem = sequenceStartProblem({
      exercise: ex,
      bodyRegionFlag: regionFlag,
      cameraOn: S.cameraOn,
      engineReady: engine.state.ready,
      canRecord: canRecordSequence,
    });
    if (problem === 'missing_body_region') {
      toast(getLang() === 'th' ? 'เลือก Body region ใน Motion setup ก่อนบันทึก motion' : 'Select a Motion setup body region before recording motion.');
      return;
    }
    if (problem === 'camera_not_ready') { toast(t('startCamera')); return; }
    if (problem === 'unsupported_exercise') {
      toast(getLang() === 'th' ? 'ท่านี้ยังไม่รองรับ motion sequence' : 'This exercise does not support motion sequence recording yet');
      return;
    }
    const now = performance.now();
    S.landmarkFilter?.reset();
    stopClipPlayback();
    beginSequenceRecordingState(S, {
      exerciseId: S.exId,
      bodyRegionFlag: regionFlag,
      angleOverlayJoints: [...(S.angleOverlayJoints || [])],
      startedAt: now,
    });
    updateRecordButton();
    renderPanel();
    toast(ex.movementPattern === 'alternating'
      ? (getLang() === 'th' ? 'เริ่มบันทึก motion · ทำ 1 รอบ: rest → ซ้าย → rest → ขวา → rest' : 'Recording motion · perform one full cycle: rest → left → rest → right → rest')
      : (getLang() === 'th' ? 'เริ่มบันทึก motion · ทำ 1 รอบ: rest → target → rest' : 'Recording motion · perform one full cycle: rest → target → rest'));
  }

  async function stopSequenceRecording() {
    updateRecordButton();
    const result = finishSequenceRecordingState(S, {
      exerciseId: S.exId,
      candidateJoints: candidateRepJointsForExercise(getExercise(S.exId)),
      fallbackJoints: JOINT_SPECS.map((s) => s.joint),
    });
    if (result.reason === 'wrong_exercise') return;
    if (result.reason === 'too_short') {
      toast(getLang() === 'th' ? 'motion สั้นเกินไป ลองบันทึกใหม่' : 'Motion was too short. Record again.');
      return;
    }
    if (!result.ok) return;
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
  function setCaptureWorkflow(workflow) {
    S.captureWorkflow = ['reference', 'dataset', 'validate'].includes(workflow) ? workflow : 'reference';
    if (S.captureWorkflow !== 'dataset') stopDatasetPreview({ clearSequence: true });
    setMode(S.captureWorkflow === 'validate' ? 'validate' : 'setup');
    renderPanel();
  }

  function toggleAdvanced() {
    S.advancedOpen = !S.advancedOpen;
    renderPanel();
  }

  function setMode(m) {
    S.mode = m;
    R.modeBadge.textContent = m.toUpperCase(); R.modeBadge.className = 'pill ' + (m === 'setup' ? 'brand' : 'good');
    R.setupBtn.className = m === 'setup' ? 'active' : ''; R.valBtn.className = m === 'validate' ? 'active' : '';
    resetValidationEngine();
    updateScore(null);
  }

  function resetValidationEngine() {
    resetValidationState(S);
  }

  function validationProcessorFor(ex, ref) {
    return getValidationFrameProcessor(S, exerciseForAiRuntime(ex), ref, {
      fallbackExerciseId: S.exId,
      lang: getLang,
    });
  }

  function handleReferenceSaveResult(result, successText = t('refSaved')) {
    const th = getLang() === 'th';
    const exC = getExercise(S.exId);
    if (result.reason === 'missing_hold_angles') {
      toast(th ? 'ยังอ่านมุมของท่านี้ไม่ครบ' : 'Not enough joint angles for this hold.');
      return false;
    }
    if (result.reason === 'motion_requires_sequence') {
      toast(th
        ? 'บันทึก full motion cycle ด้วย Record motion ก่อนใช้ scoring'
        : 'Record a full motion cycle before saving the scoring reference.');
      return false;
    }
    if (result.reason === 'bad_sequence') {
      toast(exC.movementPattern === 'alternating'
        ? (th ? 'motion ยังไม่ชัดพอ ลองบันทึก rest → ซ้าย → rest → ขวา → rest ใหม่' : 'Motion was not clear enough. Record rest → left → rest → right → rest again.')
        : (th ? 'motion ยังไม่ชัดพอ ลองบันทึก rest → target → rest ใหม่' : 'Motion was not clear enough. Record rest → target → rest again.'));
      return false;
    }
    if (result.reason === 'validation_failed') {
      toast(th
        ? `reference ยังไม่พร้อม: ${result.issues.join(', ')}`
        : `Reference not ready: ${result.issues.join(', ')}`);
      return false;
    }
    if (result.reason === 'save_failed') {
      toast(S.patientId
        ? (th ? 'บันทึก reference ขึ้นคลาวด์ไม่สำเร็จ' : 'Reference cloud save failed')
        : (th ? 'บันทึก reference ในคลังไม่สำเร็จ' : 'Library reference save failed'));
      return false;
    }
    if (!result.ok) return false;
    resetValidationEngine();
    updateCaptureButtonLabel();
    toast(result.successText || (!S.patientId && successText === t('refSaved')
      ? (th ? 'บันทึกในคลังท่าของฉันแล้ว' : 'Saved to my exercise library')
      : successText));
    renderPanel();
    return true;
  }

  async function persistReference(ref, successText = t('refSaved')) {
    const result = await persistReferenceForCapture({
      state: S,
      ref,
      exercise: getExercise(S.exId),
      exerciseId: S.exId,
      patientId: S.patientId,
      saveReference,
    });
    return handleReferenceSaveResult(result, successText);
  }

  async function saveHoldReference({ landmarks, jointAngles, boundary, source = null }) {
    const exC = getExercise(S.exId);
    const result = await saveHoldReferenceForCapture({
      state: S,
      exercise: exC,
      exerciseId: S.exId,
      variant: S.variant,
      landmarks,
      jointAngles,
      boundary,
      source,
      candidateRepJointsForExercise,
      cleanLandmarks,
      updateCustomExercise,
      saveReference,
      patientId: S.patientId,
      boundaryBoxRatio: BOUNDARY_BOX_RATIO,
    });
    return handleReferenceSaveResult(result);
  }

  async function saveMotionReference(payload) {
    const exC = getExercise(S.exId);
    const result = await saveMotionReferenceForCapture({
      state: S,
      exercise: exC,
      exerciseId: S.exId,
      variant: S.variant,
      ...payload,
      updateCustomExercise,
      saveReference,
      patientId: S.patientId,
      boundaryBoxRatio: BOUNDARY_BOX_RATIO,
      lang: getLang(),
    });
    return handleReferenceSaveResult(result);
  }

  async function saveSequenceReference(frames, targetOffset = null, regionFlag = null) {
    const exC = getExercise(S.exId);
    const result = await saveSequenceReferenceForCapture({
      state: S,
      exercise: exC,
      exerciseId: S.exId,
      variant: S.variant,
      frames,
      targetOffset,
      regionFlag,
      referenceExerciseForCapture,
      candidateRepJointsForExercise,
      regionJoints: ROM_REGION_JOINTS,
      updateCustomExercise,
      saveReference,
      patientId: S.patientId,
      boundaryBoxRatio: BOUNDARY_BOX_RATIO,
      lang: getLang(),
    });
    return handleReferenceSaveResult(result);
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
    try {
      await refreshAiModels();
    } catch {
      if (disposed) return;
      S.aiModels = [];
      S.aiModelsLoaded = false;
      toast(getLang() === 'th' ? 'โหลด metadata โมเดล AI ไม่สำเร็จ' : 'Could not load AI model metadata');
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
