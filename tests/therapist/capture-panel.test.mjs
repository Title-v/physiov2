import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCapturePanel } from '../../src/app/therapist/capture/capturePanel.js';

function h(tag, props = {}, ...children) {
  return {
    tag,
    props: props || {},
    children: children.flat().filter((child) => child != null),
    append(...nodes) {
      this.children.push(...nodes);
    },
  };
}

function clear(node) {
  node.children = [];
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return `${node.props?.html || ''}${(node.children || []).map(textOf).join('')}`;
}

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}

function renderCapturePanelFixture({ statePatch = {}, actions = {} } = {}) {
  const panel = {
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
  };
  const oldDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === 'panel' ? panel : null),
  };
  const exercise = {
    id: 'shoulder_ai',
    label: 'Shoulder AI',
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
    templateOnly: false,
    tol: 10,
  };
  const baseActions = {
    loadRef() {},
    updateCaptureButtonLabel() {},
    stopClipPlayback() {},
    renderClipPreview() {},
    trimPendingSequence() {},
    saveSequenceReference() {},
    exportSkeletonParameters() {},
    exportMotionDatasetJsonl() {},
    selectRomBodyRegion() {},
    toggleOverlayJoint() {},
    resetRomMeasurement() {},
    savePlanSettings() {},
    togglePlan() {},
    setCaptureWorkflow() {},
    setDatasetLabelTarget() {},
    setDatasetTargetReps() {},
    startDatasetRecording() {},
    stopDatasetRecording() {},
    previewDatasetRep() {},
    reviewDatasetRep() {},
    skipDatasetRep() {},
    toggleDatasetReview() {},
    exportDatasetBatchJsonl() {},
    saveDatasetBatchToApi() {},
    updateTable() {},
    toggleAdvanced() {},
  };
  try {
    renderCapturePanel({
      state: {
        captureWorkflow: 'dataset',
        exId: exercise.id,
        patientId: null,
        reference: null,
        mode: 'setup',
        angleOverlayJoints: [],
        romBodyRegion: 'right_arm',
        advancedOpen: false,
        dataset: {
          active: false,
          labelTarget: 'good',
          targetReps: 10,
          reviewOpen: false,
          rows: [{
            labelStatus: 'reviewed',
            trainable: true,
            dataQuality: 'usable',
            motionLabel: 'good',
            landmarkSchemaId: 'right_arm.v1',
            missingPrimary: [],
            missingStabilizer: [],
          }],
        },
        aiReadiness: {
          trainable: true,
          dataQuality: 'usable',
          schemaId: 'right_arm.v1',
          primary: { names: ['right_shoulder'], missing: [], lowVisibility: [] },
          stabilizer: { names: ['left_shoulder'], missing: [], lowVisibility: [] },
        },
        aiModels: [],
        ...statePatch,
      },
      refs: {},
      dom: {
        h,
        clear,
        icon: (name) => `<${name}>`,
        ringSVG: () => '<ring>',
        toast() {},
        t: (key) => key,
        getLang: () => 'en',
      },
      data: {
        BODY_REGIONS: [{ id: 'right_arm', label: 'Right arm', labelTh: 'แขนขวา' }],
        COUNT_MODES: [],
        EXERCISES: [exercise],
        MOVEMENT_PATTERNS: [],
        JOINT_SPECS: [],
        ANGLE_PICKER_JOINTS: [],
        ROM_BODY_REGION_IDS: ['right_arm'],
        getExercises: () => [exercise],
        getExercise: () => exercise,
        exLabel: (ex) => ex.label,
        saveCustomExercise() {},
        deleteCustomExercise() {},
        getPlan: () => [],
      },
      helpers: {
        buildReferencePanelModel: () => ({
          targetShownText: '-',
          primaryCycleText: '-',
          primaryCycle: {},
          timingText: '',
          patternText: '-',
          trackedLabel: '-',
          jointRows: [],
        }),
        candidateRepJointsForExercise: () => [],
        currentCaptureHint: () => 'capture hint',
        formatMs: (ms) => `${ms}ms`,
      },
      actions: { ...baseActions, ...actions },
    });
  } finally {
    globalThis.document = oldDocument;
  }
  return panel;
}

test('renderCapturePanel forwards dataset API save action to Dataset workflow panel', () => {
  const calls = [];
  const panel = renderCapturePanelFixture({
    actions: {
      saveDatasetBatchToApi: () => calls.push('save'),
    },
  });
  const saveButton = findAll(panel, (node) => node.tag === 'button' && /API/.test(textOf(node)))[0];

  assert.ok(saveButton, 'API save button should render');
  assert.equal(saveButton.props.disabled, null);
  saveButton.props.onclick();
  assert.deepEqual(calls, ['save']);
});

test('renderCapturePanel passes selected AI model manifest into Validate workflow panel', () => {
  const panel = renderCapturePanelFixture({
    statePatch: {
      captureWorkflow: 'validate',
      reference: { kind: 'motion_cycle', jointAngles: { right_shoulder: 90 }, referenceSequence: { frames: [{}, {}] } },
      aiModels: [{
        id: 'right_arm_tcn_v1',
        exerciseId: 'shoulder_ai',
        approved: true,
        landmarkSchemaId: 'right_arm.v1',
      }],
    },
  });

  assert.match(textOf(panel), /right_arm_tcn_v1/);
  assert.match(textOf(panel), /compatible/);
});
