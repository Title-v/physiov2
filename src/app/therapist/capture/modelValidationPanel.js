export function renderModelValidationPanel({
  exercise = {},
  reference = null,
  readiness = {},
  h,
  lang = 'en',
}) {
  const referenceReady = !!reference;
  const safetyReady = readiness.scoreable === true;
  const modelReady = !!exercise.activeModelId && exercise.modelStatus === 'deployed';
  return h('div', { class: 'card col gap10' },
    h('div', { class: 'eyebrow' }, lang === 'th' ? 'ทดสอบการตรวจท่า' : 'Motion validation'),
    h('div', { class: 'row between', style: { alignItems: 'center' } },
      h('span', { class: 'pill ' + (referenceReady ? 'good' : 'bad') }, referenceReady ? 'reference ready' : 'missing reference'),
      h('span', { class: 'pill ' + (safetyReady ? 'good' : 'bad') }, safetyReady ? 'safety ready' : (readiness.dataQuality || 'not_ready'))),
    h('div', { class: 'row between', style: { alignItems: 'baseline' } },
      h('span', { class: 'muted' }, 'Schema'),
      h('b', { class: 'mono', style: { fontSize: '11px' } }, readiness.schemaId || exercise.landmarkSchemaId || '—')),
    h('div', { class: 'row between', style: { alignItems: 'baseline' } },
      h('span', { class: 'muted' }, 'AI model'),
      h('b', { class: 'mono', style: { fontSize: '11px' } },
        modelReady ? exercise.activeModelId : (lang === 'th' ? 'fallback rule/reference' : 'fallback rule/reference'))),
    h('div', { class: 'muted', style: { fontSize: '12.5px' } },
      lang === 'th'
        ? (modelReady ? 'ถ้า confidence ผ่าน จะใช้ AI-primary scoring; ถ้าไม่ผ่านจะ fallback reference score' : 'ยังไม่มี model ที่ deploy แล้ว จึงใช้ reference/rule scoring เป็น fallback')
        : (modelReady ? 'AI-primary scoring is used when confidence passes; otherwise reference scoring is used.' : 'No deployed model yet; validation uses reference/rule fallback scoring.')),
  );
}
