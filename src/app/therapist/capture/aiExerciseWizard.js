function listLine(h, label, values = []) {
  return h('div', { class: 'row between', style: { alignItems: 'baseline', gap: '12px' } },
    h('span', { class: 'muted', style: { fontSize: '12.5px' } }, label),
    h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, values?.length ? values.join(', ') : '—'));
}

export function renderAiExerciseWizard({
  exercise = {},
  h,
  lang = 'en',
}) {
  const isTemplate = exercise.templateOnly !== false;
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
  );
}
