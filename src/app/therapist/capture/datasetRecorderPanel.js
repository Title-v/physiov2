import { isReviewedTrainableRow } from '../../../../shared/ai/DatasetLabeler.js';

const LABELS = [
  ['good', 'Good', 'ถูกต้อง'],
  ['incomplete', 'Incomplete', 'ไม่สุดช่วง'],
  ['wrong_path', 'Wrong path', 'แนวผิด'],
  ['unstable', 'Unstable', 'ไม่นิ่ง'],
];

function readinessRows(h, title, group = null, lang = 'en') {
  const names = group?.names || [];
  const missing = new Set([...(group?.missing || []), ...(group?.lowVisibility || [])]);
  return h('div', { class: 'col gap6' },
    h('div', { class: 'muted', style: { fontSize: '12.5px', fontWeight: '700' } }, title),
    ...(names.length ? names.map((name) => h('div', { class: 'row between muted', style: { fontSize: '12px' } },
      h('span', {}, name),
      h('b', { style: { color: missing.has(name) ? 'var(--bad)' : 'var(--good)' } }, missing.has(name) ? 'missing' : 'ready'))) : [
      h('div', { class: 'muted', style: { fontSize: '12px' } }, lang === 'th' ? 'ยังไม่มี schema' : 'No schema'),
    ]),
  );
}

export function renderDatasetRecorderPanel({
  S,
  h,
  icon,
  lang = 'en',
  actions,
}) {
  const readiness = S.aiReadiness || {};
  const ready = readiness.trainable === true;
  const cameraReady = S.cameraOn === true;
  const canStart = ready && cameraReady;
  const reviewedCount = (S.dataset.rows || []).filter(isReviewedTrainableRow).length;
  const labelSelect = h('select', {
    style: { width: '100%' },
    onchange: (e) => actions.setDatasetLabelTarget(e.target.value),
  }, ...LABELS.map(([value, en, th]) => h('option', {
    value,
    selected: S.dataset.labelTarget === value ? '' : null,
  }, lang === 'th' ? th : en)));
  const repsInput = h('input', {
    type: 'number',
    min: '1',
    max: '100',
    value: String(S.dataset.targetReps || 10),
    style: { width: '90px', textAlign: 'right' },
    onchange: (e) => actions.setDatasetTargetReps(e.target.value),
  });
  const statusText = !cameraReady
    ? (lang === 'th' ? 'เปิดกล้องก่อนเก็บข้อมูลฝึก AI' : 'Start the camera before recording an AI dataset')
    : ready
    ? (lang === 'th' ? 'พร้อมเก็บข้อมูลฝึก AI' : 'Ready to record AI dataset')
    : (lang === 'th' ? (readiness.hintTh || 'ยังไม่พร้อมเก็บข้อมูล') : (readiness.hint || 'Not trainable yet'));

  return h('div', { class: 'card col gap10' },
    h('div', { class: 'eyebrow' }, lang === 'th' ? 'เก็บข้อมูลฝึก AI' : 'AI dataset recording'),
    h('div', { class: 'row between', style: { alignItems: 'center' } },
      h('span', { class: 'pill ' + (ready ? 'good' : 'bad') }, ready ? 'trainable' : (readiness.dataQuality || 'not_ready')),
      h('span', { class: 'mono muted', style: { fontSize: '11px' } }, readiness.schemaId || 'no schema')),
    h('div', { class: 'muted', style: { fontSize: '12.5px' } }, statusText),
    readinessRows(h, 'Primary', readiness.primary, lang),
    readinessRows(h, 'Stabilizer', readiness.stabilizer, lang),
    h('label', { class: 'col gap6' },
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, lang === 'th' ? 'Label ที่ต้องการเก็บ' : 'Target label'),
      labelSelect),
    h('label', { class: 'row between', style: { alignItems: 'center' } },
      h('span', { class: 'muted' }, lang === 'th' ? 'จำนวน rep เป้าหมาย' : 'Target reps'),
      repsInput),
    h('div', { class: 'row gap6' },
      h('button', {
        class: 'btn ' + (S.dataset.active ? 'danger' : 'primary'),
        disabled: (!S.dataset.active && !canStart) ? '' : null,
        style: { flex: '1' },
        onclick: S.dataset.active ? actions.stopDatasetRecording : actions.startDatasetRecording,
        html: icon(S.dataset.active ? 'close' : 'play', { size: 16, color: S.dataset.active ? '#FBFAF5' : '#FBFAF5' }) + ' ' +
          (S.dataset.active
            ? (lang === 'th' ? 'หยุดเก็บข้อมูล' : 'Stop recording')
            : (lang === 'th' ? 'เริ่มเก็บข้อมูล' : 'Start recording')),
      }),
      h('button', {
        class: 'btn',
        onclick: actions.exportDatasetBatchJsonl,
        html: icon('download', { size: 16 }) + ' JSONL',
      }),
      h('button', {
        class: 'btn',
        disabled: reviewedCount ? null : '',
        onclick: actions.saveDatasetBatchToApi,
        html: icon('save', { size: 16 }) + ' API',
      })),
    h('div', { class: 'muted', style: { fontSize: '12px' } },
      lang === 'th'
        ? `Review queue: ${S.dataset.rows.length}/${S.dataset.targetReps || 10}`
        : `Review queue: ${S.dataset.rows.length}/${S.dataset.targetReps || 10}`),
  );
}
