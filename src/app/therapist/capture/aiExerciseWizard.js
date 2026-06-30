import { evaluateDatasetReadiness } from '../../../../shared/ai/ModelApprovalCriteria.js';

function listLine(h, label, values = []) {
  return h('div', { class: 'row between', style: { alignItems: 'baseline', gap: '12px' } },
    h('span', { class: 'muted', style: { fontSize: '12.5px' } }, label),
    h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, values?.length ? values.join(', ') : '—'));
}

function hasSchemaMetadata(exercise = {}) {
  return !!exercise.landmarkSchemaId &&
    ['primaryRequiredLandmarks', 'stabilizerRequiredLandmarks', 'modelInputLandmarks', 'jointNames']
      .every((key) => Array.isArray(exercise[key]) && exercise[key].length);
}

export function modelReadinessForExercise(exercise = {}, modelManifest = null) {
  const schemaId = exercise.landmarkSchemaId || null;
  const configured = !!exercise.activeModelId && exercise.modelStatus === 'deployed';
  if (!modelManifest) {
    return {
      configured,
      manifestLoaded: false,
      approved: false,
      schemaMatches: false,
      idMatches: null,
      ready: false,
      reason: configured ? 'manifest_not_loaded' : (exercise.modelStatus || 'not_trained'),
    };
  }
  const manifestId = modelManifest.id || modelManifest.modelId || modelManifest.name || null;
  const idMatches = !exercise.activeModelId || manifestId === exercise.activeModelId;
  const approved = modelManifest.approved === true;
  const schemaMatches = !!schemaId && modelManifest.landmarkSchemaId === schemaId;
  const ready = approved && schemaMatches && idMatches;
  return {
    configured,
    manifestLoaded: true,
    approved,
    schemaMatches,
    idMatches,
    ready,
    reason: ready
      ? 'model_ready'
      : !approved
        ? 'model_not_approved'
        : !schemaMatches
          ? 'schema_mismatch'
          : 'model_id_mismatch',
  };
}

function stepStatus({ ready = false, blocked = false, active = false } = {}) {
  if (ready) return 'done';
  if (blocked) return 'blocked';
  if (active) return 'active';
  return 'pending';
}

export function buildAiExerciseWizardModel({
  exercise = {},
  reference = null,
  datasetRows = [],
  readiness = {},
  modelManifest = null,
} = {}) {
  const schemaReady = hasSchemaMetadata(exercise);
  const referenceReady = !!reference;
  const dataset = evaluateDatasetReadiness(datasetRows);
  const reviewedTrainableRows = dataset.trainableRows || 0;
  const enoughDataset = dataset.ok;
  const modelStatus = modelReadinessForExercise(exercise, modelManifest);
  const modelReady = modelStatus.ready;
  const safetyReady = readiness.trainable === true || readiness.scoreable === true;
  const steps = [
    {
      id: 'schema',
      label: 'Schema',
      status: stepStatus({ ready: schemaReady, blocked: !schemaReady }),
      detail: exercise.landmarkSchemaId || 'missing schema',
    },
    {
      id: 'reference',
      label: 'Reference',
      status: stepStatus({ ready: referenceReady, blocked: !schemaReady, active: schemaReady }),
      detail: referenceReady ? (reference.kind || 'ready') : 'capture required',
      workflow: 'reference',
    },
    {
      id: 'dataset',
      label: 'Dataset',
      status: stepStatus({
        ready: enoughDataset,
        blocked: !schemaReady || !referenceReady,
        active: referenceReady && reviewedTrainableRows > 0,
      }),
      detail: `${reviewedTrainableRows} trainable rows`,
      workflow: 'dataset',
      dataset,
    },
    {
      id: 'model',
      label: 'Model',
      status: stepStatus({
        ready: modelReady,
        blocked: !enoughDataset,
        active: enoughDataset,
      }),
      detail: modelReady ? (exercise.activeModelId || modelManifest?.name || 'approved') : modelStatus.reason,
    },
    {
      id: 'validate',
      label: 'Validate',
      status: stepStatus({
        ready: modelReady && safetyReady,
        blocked: !referenceReady && !modelReady,
        active: referenceReady || modelReady,
      }),
      detail: safetyReady ? 'safety ready' : (readiness.dataQuality || 'camera readiness pending'),
      workflow: 'validate',
    },
  ];
  const nextStep = steps.find((step) => step.status !== 'done' && step.status !== 'blocked') ||
    steps.find((step) => step.status === 'blocked') ||
    steps.at(-1);
  return {
    schemaReady,
    referenceReady,
    modelReady,
    safetyReady,
    dataset,
    modelStatus,
    reviewedTrainableRows,
    steps,
    nextStep,
  };
}

const STATUS_CLASS = {
  done: 'good',
  active: 'brand',
  pending: 'warn',
  blocked: 'bad',
};

function stepLabel(step, lang) {
  const labels = {
    schema: lang === 'th' ? 'Schema' : 'Schema',
    reference: lang === 'th' ? 'Reference' : 'Reference',
    dataset: lang === 'th' ? 'Dataset' : 'Dataset',
    model: lang === 'th' ? 'Model' : 'Model',
    validate: lang === 'th' ? 'Validate' : 'Validate',
  };
  return labels[step.id] || step.label;
}

function statusLabel(status, lang) {
  const labels = {
    done: lang === 'th' ? 'พร้อม' : 'ready',
    active: lang === 'th' ? 'ทำต่อ' : 'next',
    pending: lang === 'th' ? 'รอข้อมูล' : 'pending',
    blocked: lang === 'th' ? 'ติดเงื่อนไข' : 'blocked',
  };
  return labels[status] || status;
}

function renderWizardStep(h, step, { lang = 'en', actions = {} } = {}) {
  const canJump = !!step.workflow && step.status !== 'blocked' && typeof actions.setCaptureWorkflow === 'function';
  return h('div', { class: 'row between', style: { alignItems: 'center', gap: '10px', borderTop: '1px solid var(--line)', paddingTop: '8px' } },
    h('div', { class: 'col gap4', style: { minWidth: 0 } },
      h('div', { class: 'row gap6', style: { alignItems: 'center' } },
        h('span', { class: `pill ${STATUS_CLASS[step.status] || 'warn'}` }, statusLabel(step.status, lang)),
        h('b', {}, stepLabel(step, lang))),
      h('span', { class: 'muted mono', style: { fontSize: '11px' } }, step.detail || '—')),
    canJump
      ? h('button', { class: 'mini', onclick: () => actions.setCaptureWorkflow(step.workflow) }, lang === 'th' ? 'เปิด' : 'Open')
      : null);
}

export function renderAiExerciseWizard({
  exercise = {},
  reference = null,
  datasetRows = [],
  readiness = {},
  modelManifest = null,
  h,
  lang = 'en',
  actions = {},
}) {
  const isTemplate = exercise.templateOnly !== false;
  const model = buildAiExerciseWizardModel({ exercise, reference, datasetRows, readiness, modelManifest });
  return h('div', { class: 'card col gap10' },
    h('div', { class: 'eyebrow' }, lang === 'th' ? 'AI exercise setup' : 'AI exercise setup'),
    h('div', { class: 'row between', style: { alignItems: 'center' } },
      h('span', { class: 'pill ' + (isTemplate ? 'warn' : 'good') },
        isTemplate ? (lang === 'th' ? 'template/demo' : 'template/demo') : (lang === 'th' ? 'custom exercise' : 'custom exercise')),
      h('span', { class: 'mono muted', style: { fontSize: '11px' } }, exercise.landmarkSchemaId || 'no schema')),
    h('div', { class: 'muted', style: { fontSize: '12.5px' } },
      lang === 'th'
        ? 'ตั้ง schema ของท่าให้ชัดก่อนเก็บ reference หรือ dataset'
        : 'Confirm the schema before capturing references or AI dataset rows.'),
    listLine(h, 'Primary', exercise.primaryRequiredLandmarks || []),
    listLine(h, 'Stabilizer', exercise.stabilizerRequiredLandmarks || []),
    listLine(h, 'Model input', exercise.modelInputLandmarks || []),
    listLine(h, 'Joints', exercise.jointNames || []),
    h('div', { class: 'row between', style: { alignItems: 'baseline' } },
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Model'),
      h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } },
        exercise.activeModelId ? `${exercise.activeModelId} · ${exercise.modelStatus || 'unknown'}` : (exercise.modelStatus || 'not_trained'))),
    h('div', { class: 'row between', style: { alignItems: 'baseline' } },
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, lang === 'th' ? 'ขั้นต่อไป' : 'Next step'),
      h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } },
        model.nextStep ? `${model.nextStep.id}:${model.nextStep.status}` : '—')),
    ...model.steps.map((step) => renderWizardStep(h, step, { lang, actions })),
  );
}
