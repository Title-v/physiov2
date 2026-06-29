import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTherapistCaptureState,
  resetPendingSequenceState,
  resetValidationState,
} from '../../src/app/therapist/capture/captureState.js';

test('createTherapistCaptureState seeds controller defaults without starting camera state', () => {
  const state = createTherapistCaptureState({ exerciseId: 'shoulder', variant: 'full' });

  assert.equal(state.exId, 'shoulder');
  assert.equal(state.variant, 'full');
  assert.equal(state.mode, 'setup');
  assert.equal(state.cameraOn, false);
  assert.equal(state.recording, null);
  assert.deepEqual(state.angleOverlayJoints, []);
});

test('capture state reset helpers clear validation and pending sequence state only', () => {
  const state = createTherapistCaptureState({ exerciseId: 'knee', variant: 'lite' });
  state.validationEngine = {};
  state.validationFrameProcessor = {};
  state.validationKey = 'abc';
  state.pendingSequence = { frames: [{}] };
  state.previewFrameIdx = 3;
  state.reference = { id: 'keep' };

  resetValidationState(state);
  resetPendingSequenceState(state);

  assert.equal(state.validationEngine, null);
  assert.equal(state.validationFrameProcessor, null);
  assert.equal(state.validationKey, null);
  assert.equal(state.pendingSequence, null);
  assert.equal(state.previewFrameIdx, null);
  assert.deepEqual(state.reference, { id: 'keep' });
});
