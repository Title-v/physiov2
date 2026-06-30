import { modelReadinessForExercise } from './aiExerciseWizard.js';

export function renderModelValidationPanel({
  exercise = {},
  reference = null,
  readiness = {},
  modelManifest = null,
  h,
  lang = 'en',
}) {
  const referenceReady = !!reference;
  const safetyReady = readiness.scoreable === true;
  const modelStatus = modelReadinessForExercise(exercise, modelManifest);
  const modelReady = modelStatus.ready;
  const modelConfiguredButUnverified = modelStatus.configured && !modelReady;
  const modelLabel = modelReady
    ? (exercise.activeModelId || modelManifest?.name || modelManifest?.id || 'approved')
    : modelStatus.configured
      ? `${exercise.activeModelId} · ${modelStatus.reason}`
      : (lang === 'th' ? 'fallback rule/reference' : 'fallback rule/reference');
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
        modelLabel)),
    h('div', { class: 'row between', style: { alignItems: 'baseline' } },
      h('span', { class: 'muted' }, lang === 'th' ? 'Model schema' : 'Model schema'),
      h('b', { class: 'mono', style: { fontSize: '11px' } },
        modelStatus.manifestLoaded
          ? (modelStatus.schemaMatches ? 'compatible' : 'mismatch')
          : (modelStatus.configured ? 'unverified' : '—'))),
    h('div', { class: 'muted', style: { fontSize: '12.5px' } },
      lang === 'th'
        ? (modelReady
          ? 'ถ้า confidence ผ่าน จะใช้ AI-primary scoring; ถ้าไม่ผ่านจะ fallback reference score'
          : modelConfiguredButUnverified
            ? 'มี model ที่ตั้งค่าไว้ แต่ต้อง verify manifest/schema ก่อน จึง fallback reference/rule scoring'
            : 'ยังไม่มี model ที่ deploy แล้ว จึงใช้ reference/rule scoring เป็น fallback')
        : (modelReady
          ? 'AI-primary scoring is used when confidence passes; otherwise reference scoring is used.'
          : modelConfiguredButUnverified
            ? 'A deployed model is configured, but manifest/schema compatibility is not verified yet; validation falls back to reference/rule scoring.'
            : 'No deployed model yet; validation uses reference/rule fallback scoring.')),
  );
}
