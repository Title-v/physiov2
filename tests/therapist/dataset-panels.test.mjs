import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDatasetRecorderPanel } from '../../src/app/therapist/capture/datasetRecorderPanel.js';
import { renderDatasetReviewPanel } from '../../src/app/therapist/capture/datasetReviewPanel.js';

function h(tag, props = {}, ...children) {
  return { tag, props: props || {}, children: children.flat().filter((child) => child != null) };
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

const icon = (name) => `<${name}>`;

test('dataset recorder disables start until primary and stabilizer readiness passes', () => {
  const actions = {
    setDatasetLabelTarget() {},
    setDatasetTargetReps() {},
    startDatasetRecording() {},
    stopDatasetRecording() {},
    exportDatasetBatchJsonl() {},
    saveDatasetBatchToApi() {},
  };
  const panel = renderDatasetRecorderPanel({
    S: {
      aiReadiness: {
        trainable: false,
        dataQuality: 'missing_stabilizer_required',
        schemaId: 'right_arm.v1',
        hint: 'Step back so the stabilizer is visible',
        primary: { names: ['right_shoulder'], missing: [], lowVisibility: [] },
        stabilizer: { names: ['left_shoulder'], missing: ['left_shoulder'], lowVisibility: [] },
      },
      cameraOn: true,
      dataset: { active: false, labelTarget: 'good', targetReps: 10, rows: [] },
    },
    h,
    icon,
    actions,
  });
  const start = findAll(panel, (node) => node.tag === 'button' && /Start recording/.test(textOf(node)))[0];

  assert.equal(start.props.disabled, '');
  assert.match(textOf(panel), /missing_stabilizer_required/);
  assert.match(textOf(panel), /left_shouldermissing/);
});

test('dataset recorder enables start when AI training readiness is trainable', () => {
  const actions = {
    setDatasetLabelTarget() {},
    setDatasetTargetReps() {},
    startDatasetRecording() {},
    stopDatasetRecording() {},
    exportDatasetBatchJsonl() {},
    saveDatasetBatchToApi() {},
  };
  const panel = renderDatasetRecorderPanel({
    S: {
      aiReadiness: {
        trainable: true,
        dataQuality: 'usable',
        schemaId: 'right_arm.v1',
        primary: { names: ['right_shoulder'], missing: [], lowVisibility: [] },
        stabilizer: { names: ['left_shoulder'], missing: [], lowVisibility: [] },
      },
      cameraOn: true,
      dataset: { active: false, labelTarget: 'good', targetReps: 20, rows: [{ id: 'r1' }] },
    },
    h,
    icon,
    actions,
  });
  const start = findAll(panel, (node) => node.tag === 'button' && /Start recording/.test(textOf(node)))[0];

  assert.equal(start.props.disabled, null);
  assert.match(textOf(panel), /Ready to record AI dataset/);
  assert.match(textOf(panel), /Review queue: 1\/20/);
});

test('dataset recorder keeps start disabled until camera is on', () => {
  const actions = {
    setDatasetLabelTarget() {},
    setDatasetTargetReps() {},
    startDatasetRecording() {},
    stopDatasetRecording() {},
    exportDatasetBatchJsonl() {},
    saveDatasetBatchToApi() {},
  };
  const panel = renderDatasetRecorderPanel({
    S: {
      cameraOn: false,
      aiReadiness: {
        trainable: true,
        dataQuality: 'usable',
        schemaId: 'right_arm.v1',
        primary: { names: ['right_shoulder'], missing: [], lowVisibility: [] },
        stabilizer: { names: ['left_shoulder'], missing: [], lowVisibility: [] },
      },
      dataset: { active: false, labelTarget: 'good', targetReps: 10, rows: [] },
    },
    h,
    icon,
    actions,
  });
  const start = findAll(panel, (node) => node.tag === 'button' && /Start recording/.test(textOf(node)))[0];

  assert.equal(start.props.disabled, '');
  assert.match(textOf(panel), /Start the camera before recording an AI dataset/);
});

test('dataset recorder enables API save only for reviewed trainable rows', () => {
  const saves = [];
  const readyRow = {
    labelStatus: 'reviewed',
    trainable: true,
    dataQuality: 'usable',
    motionLabel: 'good',
    repComplete: true,
    completionSource: 'rule_completed_rep',
    landmarkSchemaId: 'right_arm.v1',
    missingPrimary: [],
    missingStabilizer: [],
  };
  const actions = {
    setDatasetLabelTarget() {},
    setDatasetTargetReps() {},
    startDatasetRecording() {},
    stopDatasetRecording() {},
    exportDatasetBatchJsonl() {},
    saveDatasetBatchToApi: () => saves.push('save'),
  };
  const baseState = {
    cameraOn: true,
    aiReadiness: {
      trainable: true,
      dataQuality: 'usable',
      schemaId: 'right_arm.v1',
      primary: { names: ['right_shoulder'], missing: [], lowVisibility: [] },
      stabilizer: { names: ['left_shoulder'], missing: [], lowVisibility: [] },
    },
  };
  const draftPanel = renderDatasetRecorderPanel({
    S: {
      ...baseState,
      dataset: { active: false, labelTarget: 'good', targetReps: 10, rows: [{ labelStatus: 'draft', trainable: false }] },
    },
    h,
    icon,
    actions,
  });
  const disabledSave = findAll(draftPanel, (node) => node.tag === 'button' && /API/.test(textOf(node)))[0];

  assert.equal(disabledSave.props.disabled, '');

  const readyPanel = renderDatasetRecorderPanel({
    S: {
      ...baseState,
      dataset: { active: false, labelTarget: 'good', targetReps: 10, rows: [readyRow] },
    },
    h,
    icon,
    actions,
  });
  const save = findAll(readyPanel, (node) => node.tag === 'button' && /API/.test(textOf(node)))[0];

  assert.equal(save.props.disabled, null);
  save.props.onclick();
  assert.deepEqual(saves, ['save']);
});

test('dataset review disables motion-label buttons for auto rejected reps', () => {
  const previewed = [];
  const panel = renderDatasetReviewPanel({
    S: {
      dataset: {
        reviewOpen: true,
        rows: [{
          id: 'rep_1',
          dataQuality: 'missing_primary_required',
          labelStatus: 'auto_rejected',
          repComplete: true,
          completionSource: 'rule_completed_rep',
          frames: [{}, {}],
          landmarkSchemaId: 'right_arm.v1',
        }],
      },
    },
    h,
    actions: {
      previewDatasetRep: (index) => previewed.push(index),
      reviewDatasetRep() {},
      skipDatasetRep() {},
      toggleDatasetReview() {},
    },
  });
  const labelButtons = findAll(panel, (node) => node.tag === 'button' && ['Good', 'Incomplete', 'Wrong path', 'Unstable'].includes(textOf(node)));

  assert.equal(labelButtons.length, 4);
  assert.equal(labelButtons.every((button) => button.props.disabled === ''), true);
  assert.match(textOf(panel), /missing_primary_required/);
  assert.match(textOf(panel), /Complete: yes · Source: rule_completed_rep/);
  const play = findAll(panel, (node) => node.tag === 'button' && textOf(node) === 'Play')[0];
  assert.equal(play.props.disabled, null);
  play.props.onclick();
  assert.deepEqual(previewed, [0]);
});

test('dataset review marks the actively playing preview row', () => {
  const panel = renderDatasetReviewPanel({
    S: {
      dataset: {
        reviewOpen: true,
        previewRowIndex: 1,
        previewPlaying: true,
        rows: [
          { id: 'rep_1', dataQuality: 'usable', labelStatus: 'draft', repComplete: true, completionSource: 'rule_completed_rep', frames: [{}], landmarkSchemaId: 'right_arm.v1' },
          { id: 'rep_2', dataQuality: 'usable', labelStatus: 'draft', repComplete: true, completionSource: 'rule_completed_rep', frames: [{}], landmarkSchemaId: 'right_arm.v1' },
        ],
      },
    },
    h,
    actions: {
      previewDatasetRep() {},
      reviewDatasetRep() {},
      skipDatasetRep() {},
      toggleDatasetReview() {},
    },
  });
  const playButtons = findAll(panel, (node) => node.tag === 'button' && textOf(node) === 'Play');

  assert.match(textOf(panel), /previewing/);
  assert.equal(playButtons[1].props.class, 'mini primary');
});

test('dataset review disables motion-label buttons for manual stop clips', () => {
  const panel = renderDatasetReviewPanel({
    S: {
      dataset: {
        reviewOpen: true,
        rows: [{
          id: 'rep_manual',
          dataQuality: 'usable',
          labelStatus: 'draft',
          repComplete: false,
          completionSource: 'manual_stop',
          frames: [{}],
          landmarkSchemaId: 'right_arm.v1',
        }],
      },
    },
    h,
    actions: {
      previewDatasetRep() {},
      reviewDatasetRep() {},
      skipDatasetRep() {},
      toggleDatasetReview() {},
    },
  });
  const labelButtons = findAll(panel, (node) => node.tag === 'button' && ['Good', 'Incomplete', 'Wrong path', 'Unstable'].includes(textOf(node)));

  assert.equal(labelButtons.every((button) => button.props.disabled === ''), true);
  assert.match(textOf(panel), /Complete: no · Source: manual_stop/);
  assert.match(textOf(panel), /not trainable/);
});
