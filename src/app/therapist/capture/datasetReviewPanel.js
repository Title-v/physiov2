const LABELS = [
  ['good', 'Good', 'ถูกต้อง'],
  ['incomplete', 'Incomplete', 'ไม่สุดช่วง'],
  ['wrong_path', 'Wrong path', 'แนวผิด'],
  ['unstable', 'Unstable', 'ไม่นิ่ง'],
];

export function renderDatasetReviewPanel({
  S,
  h,
  lang = 'en',
  actions,
}) {
  const rows = S.dataset.rows || [];
  return h('div', { class: 'card col gap10' },
    h('div', { class: 'row between', style: { alignItems: 'center' } },
      h('div', { class: 'eyebrow' }, lang === 'th' ? 'Review reps' : 'Dataset review'),
      h('button', { class: 'mini', onclick: actions.toggleDatasetReview }, S.dataset.reviewOpen ? 'Hide' : 'Show')),
    !S.dataset.reviewOpen ? h('div', { class: 'muted', style: { fontSize: '12.5px' } },
      lang === 'th' ? `${rows.length} reps รอ review` : `${rows.length} reps in queue`) : null,
    S.dataset.reviewOpen && !rows.length ? h('div', { class: 'muted', style: { fontSize: '12.5px' } },
      lang === 'th' ? 'ยังไม่มี rep ใน queue' : 'No reps in the review queue yet') : null,
    ...(S.dataset.reviewOpen ? rows.map((row, index) => {
      const reviewed = row.labelStatus === 'reviewed';
      const rejected = row.labelStatus === 'auto_rejected' || row.dataQuality !== 'usable';
      const previewing = S.dataset.previewRowIndex === index && S.dataset.previewPlaying;
      return h('div', { class: 'col gap6', style: { borderTop: '1px solid var(--line)', paddingTop: '8px' } },
        h('div', { class: 'row between', style: { alignItems: 'baseline' } },
          h('b', {}, `Rep ${index + 1}`),
          h('span', { class: 'pill ' + (previewing ? 'brand' : reviewed ? 'good' : rejected ? 'bad' : 'warn') },
            previewing ? 'previewing' : reviewed ? `reviewed ${row.motionLabel}` : (row.dataQuality || row.labelStatus || 'draft'))),
        h('div', { class: 'muted', style: { fontSize: '12px' } },
          `${row.frames?.length || 0} frames · schema ${row.landmarkSchemaId || 'missing'}`),
        h('div', { class: 'row gap6 wrap' },
          h('button', {
            class: 'mini' + (previewing ? ' primary' : ''),
            disabled: row.frames?.length ? null : '',
            onclick: () => actions.previewDatasetRep?.(index),
          }, lang === 'th' ? 'เล่น' : 'Play'),
          ...LABELS.map(([value, en, th]) => h('button', {
            class: 'mini',
            disabled: rejected ? '' : null,
            onclick: () => actions.reviewDatasetRep(index, value),
          }, lang === 'th' ? th : en)),
          h('button', { class: 'mini', onclick: () => actions.skipDatasetRep(index) }, lang === 'th' ? 'ข้าม' : 'Skip')),
      );
    }) : []),
  );
}
