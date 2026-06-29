import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAiExerciseWizardModel,
  renderAiExerciseWizard,
} from '../../src/app/therapist/capture/aiExerciseWizard.js';
import {
  modelManifestSchemaFields,
  resolveBodyRegionLandmarkSchema,
} from '../../shared/ai/BodyRegionLandmarkSchema.js';

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

const schemaFields = modelManifestSchemaFields(resolveBodyRegionLandmarkSchema('right_arm.v1', { fallback: false }));

function exercise(patch = {}) {
  return {
    id: 'shoulder_ai',
    label: 'Shoulder AI',
    source: 'custom',
    templateOnly: false,
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
    modelStatus: 'collecting_data',
    ...schemaFields,
    ...patch,
  };
}

function row(label = 'good', subjectId = 's1') {
  return {
    version: 1,
    exerciseId: 'shoulder_ai',
    motionLabel: label,
    labelStatus: 'reviewed',
    trainable: true,
    scoreable: true,
    dataQuality: 'usable',
    missingPrimary: [],
    missingStabilizer: [],
    subjectId,
    frames: [{ t: 0, landmarks: [], angles: {}, phase: 'rest' }],
    ...schemaFields,
  };
}

function recommendedRows() {
  const labels = [
    ['good', 50],
    ['incomplete', 30],
    ['wrong_path', 30],
    ['unstable', 30],
  ];
  return labels.flatMap(([label, count]) => Array.from({ length: count }, (_, index) => row(label, `s${(index % 5) + 1}`)));
}

test('AI exercise wizard blocks dataset and model steps until schema and reference are ready', () => {
  const model = buildAiExerciseWizardModel({
    exercise: exercise({ landmarkSchemaId: null, modelInputLandmarks: [] }),
    reference: null,
    datasetRows: [row()],
  });

  assert.equal(model.schemaReady, false);
  assert.equal(model.steps.find((step) => step.id === 'schema').status, 'blocked');
  assert.equal(model.steps.find((step) => step.id === 'reference').status, 'blocked');
  assert.equal(model.steps.find((step) => step.id === 'dataset').status, 'blocked');
});

test('AI exercise wizard uses reviewed trainable rows and recommended minimums for dataset readiness', () => {
  const partial = buildAiExerciseWizardModel({
    exercise: exercise(),
    reference: { kind: 'motion_cycle' },
    datasetRows: [row('good')],
  });
  const complete = buildAiExerciseWizardModel({
    exercise: exercise(),
    reference: { kind: 'motion_cycle' },
    datasetRows: recommendedRows(),
  });

  assert.equal(partial.reviewedTrainableRows, 1);
  assert.equal(partial.steps.find((step) => step.id === 'dataset').status, 'active');
  assert.equal(partial.steps.find((step) => step.id === 'model').status, 'blocked');
  assert.equal(complete.dataset.ok, true);
  assert.equal(complete.steps.find((step) => step.id === 'dataset').status, 'done');
  assert.equal(complete.steps.find((step) => step.id === 'model').status, 'active');
});

test('AI exercise wizard marks validation ready only when deployed model and camera safety are ready', () => {
  const model = buildAiExerciseWizardModel({
    exercise: exercise({ activeModelId: 'right_arm_tcn_v1', modelStatus: 'deployed' }),
    reference: { kind: 'motion_cycle' },
    datasetRows: recommendedRows(),
    readiness: { trainable: true, scoreable: true, dataQuality: 'usable' },
  });

  assert.equal(model.modelReady, true);
  assert.equal(model.steps.find((step) => step.id === 'model').status, 'done');
  assert.equal(model.steps.find((step) => step.id === 'validate').status, 'done');
});

test('renderAiExerciseWizard exposes workflow actions for reachable steps', () => {
  const workflows = [];
  const panel = renderAiExerciseWizard({
    exercise: exercise(),
    reference: { kind: 'motion_cycle' },
    datasetRows: [row('good')],
    readiness: { dataQuality: 'usable' },
    h,
    actions: { setCaptureWorkflow: (workflow) => workflows.push(workflow) },
  });
  const buttons = findAll(panel, (node) => node.tag === 'button' && textOf(node) === 'Open');

  assert.match(textOf(panel), /Next stepdataset:active/);
  assert.ok(buttons.length >= 2);
  buttons.map((button) => button.props.onclick());
  assert.ok(workflows.includes('dataset'));
  assert.ok(workflows.includes('validate'));
});
