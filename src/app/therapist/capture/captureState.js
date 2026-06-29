export function createTherapistCaptureState({ exerciseId, variant } = {}) {
  return {
    cameraOn: false,
    imageMode: false,
    mode: 'setup',
    exId: exerciseId,
    patientId: null,
    patients: [],
    variant,
    reference: null,
    lastVideoTime: -1,
    lmCount: 0,
    latency: 0,
    fps: 0,
    _f: 0,
    _fl: 0,
    boundary: null,
    boundaryFrame: null,
    captureDraft: null,
    recording: null,
    pendingSequence: null,
    angleOverlayJoints: [],
    romBodyRegion: null,
    landmarkFilter: null,
    validationEngine: null,
    validationFrameProcessor: null,
    validationKey: null,
    previewFrameIdx: null,
    previewPlaying: false,
    previewLastAt: 0,
    previewRaf: 0,
  };
}

export function resetValidationState(state) {
  state.validationEngine = null;
  state.validationFrameProcessor = null;
  state.validationKey = null;
}

export function resetPendingSequenceState(state) {
  state.pendingSequence = null;
  state.previewFrameIdx = null;
}
