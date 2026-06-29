import { buildMotionClipEditorModel } from './previewController.js';
import { SEQUENCE_MIN_FRAMES } from './sequenceRecorder.js';
import { renderDatasetRecorderPanel } from './datasetRecorderPanel.js';
import { renderDatasetReviewPanel } from './datasetReviewPanel.js';
import { renderAiExerciseWizard } from './aiExerciseWizard.js';
import { renderModelValidationPanel } from './modelValidationPanel.js';

export function renderCapturePanel({
  state: S,
  refs: R,
  dom,
  data,
  helpers,
  actions,
}) {
  const {
    h,
    clear,
    icon,
    ringSVG,
    toast,
    t,
    getLang,
  } = dom;
  const {
    BODY_REGIONS,
    COUNT_MODES,
    EXERCISES,
    MOVEMENT_PATTERNS,
    JOINT_SPECS,
    ANGLE_PICKER_JOINTS,
    ROM_BODY_REGION_IDS,
    getExercises,
    getExercise,
    exLabel,
    saveCustomExercise,
    deleteCustomExercise,
    getPlan,
  } = data;
  const {
    buildReferencePanelModel,
    candidateRepJointsForExercise,
    currentCaptureHint,
    formatMs,
  } = helpers;
  const {
    loadRef,
    updateCaptureButtonLabel,
    stopClipPlayback,
    renderClipPreview,
    trimPendingSequence,
    saveSequenceReference,
    exportSkeletonParameters,
    exportMotionDatasetJsonl,
    selectRomBodyRegion,
    toggleOverlayJoint,
    resetRomMeasurement,
    savePlanSettings,
    togglePlan,
    setCaptureWorkflow,
    setDatasetLabelTarget,
    setDatasetTargetReps,
    startDatasetRecording,
    stopDatasetRecording,
    reviewDatasetRep,
    skipDatasetRep,
    toggleDatasetReview,
    exportDatasetBatchJsonl,
    toggleAdvanced,
  } = actions;

  loadRef();
  const panel = document.getElementById('panel'); if (!panel) return; clear(panel);
  const ex = getExercise(S.exId);
  const lang = getLang();
  if (S.captureDraft?.exerciseId !== S.exId) S.captureDraft = null;
  if (S.pendingSequence?.exerciseId !== S.exId) {
    S.pendingSequence = null;
    S.previewFrameIdx = null;
    stopClipPlayback();
  }
  updateCaptureButtonLabel();

  const workflowTabs = h('div', { class: 'card col gap10' },
    h('div', { class: 'eyebrow' }, lang === 'th' ? 'Workflow' : 'Workflow'),
    h('div', { class: 'mode-toggle', style: { width: '100%' } },
      h('button', {
        class: S.captureWorkflow === 'reference' ? 'active' : '',
        onclick: () => setCaptureWorkflow('reference'),
      }, lang === 'th' ? 'บันทึกท่าให้คนไข้' : 'Reference'),
      h('button', {
        class: S.captureWorkflow === 'dataset' ? 'active' : '',
        onclick: () => setCaptureWorkflow('dataset'),
      }, lang === 'th' ? 'เก็บข้อมูลฝึก AI' : 'Dataset'),
      h('button', {
        class: S.captureWorkflow === 'validate' ? 'active' : '',
        onclick: () => setCaptureWorkflow('validate'),
      }, lang === 'th' ? 'ทดสอบการตรวจท่า' : 'Validate')),
    h('button', { class: 'mini', onclick: toggleAdvanced }, S.advancedOpen ? (lang === 'th' ? 'ซ่อน Advanced' : 'Hide advanced') : (lang === 'th' ? 'เปิด Advanced' : 'Show advanced')),
  );

  const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '9px', background: 'var(--surface)', font: 'inherit', fontSize: '13px', color: 'inherit', boxSizing: 'border-box' };
  function newExerciseForm(lng) {
    const selectedExerciseRegion = BODY_REGIONS.find((r) => r.id === S.romBodyRegion);
    const regionName = selectedExerciseRegion ? (lng === 'th' ? selectedExerciseRegion.labelTh : selectedExerciseRegion.label) : '';
    const nameIn = h('input', { type: 'text', value: S.nx?.label || '', placeholder: lng === 'th' ? 'ชื่อท่า เช่น ยกแขนด้านข้าง' : 'Exercise name', style: inputStyle, oninput: (e) => { S.nx = { ...(S.nx || {}), label: e.target.value }; } });
    const regionNote = h('div', {
      class: 'muted',
      style: { fontSize: '12.5px', color: selectedExerciseRegion ? 'var(--ink2)' : 'var(--bad)' },
    }, selectedExerciseRegion
      ? (lng === 'th' ? `ใช้ส่วนร่างกายจาก Motion setup: ${regionName}` : `Uses Motion setup body region: ${regionName}`)
      : (lng === 'th' ? 'เลือก Body region ใน Motion setup ก่อน' : 'Select a body region in Motion setup first'));
    const typeSel = h('select', { style: inputStyle, onchange: (e) => { S.nx = { ...(S.nx || {}), type: e.target.value }; renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions }); } },
      h('option', { value: 'rep' }, lng === 'th' ? 'นับครั้ง (Reps)' : 'Reps'),
      h('option', { value: 'hold' }, lng === 'th' ? 'ค้างท่า (Hold)' : 'Hold'));
    const patternSel = h('select', { style: inputStyle, onchange: (e) => { S.nx = { ...(S.nx || {}), movementPattern: e.target.value }; renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions }); } },
      ...MOVEMENT_PATTERNS.map((p) => h('option', { value: p.id, selected: (S.nx?.movementPattern || 'bilateralSync') === p.id ? '' : null }, lng === 'th' ? p.labelTh : p.label)));
    const countModeSel = h('select', { style: inputStyle, onchange: (e) => { S.nx = { ...(S.nx || {}), countMode: e.target.value }; } },
      ...COUNT_MODES.map((m) => h('option', { value: m.id, selected: (S.nx?.countMode || 'per_side') === m.id ? '' : null }, lng === 'th' ? m.labelTh : m.label)));
    const err = h('div', { class: 'muted', style: { fontSize: '12px', color: 'var(--bad)', minHeight: '14px' } }, '');
    const save = () => {
      try {
        const created = saveCustomExercise({
          label: S.nx?.label,
          bodyRegion: S.romBodyRegion,
          type: S.nx?.type || 'rep',
          movementPattern: S.nx?.movementPattern || 'bilateralSync',
          countMode: S.nx?.countMode || 'per_side',
        });
        S.exId = created.id; S.newEx = false; S.nx = null; S.captureDraft = null; S.landmarkFilter?.reset(); renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions });
        toast(lng === 'th' ? 'เพิ่มลงคลังท่าแล้ว — เริ่มจากจับท่าพัก' : 'Saved to library — capture the rest pose first');
      } catch { err.textContent = lng === 'th' ? 'กรอกชื่อ และเลือกส่วนของร่างกาย' : 'Enter a name and pick a body region'; }
    };
    return h('div', { class: 'col gap6', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--line)' } },
      h('div', { class: 'muted', style: { fontSize: '12px' } }, lng === 'th' ? 'สร้างท่าใหม่ในคลังของคุณ (ค่อย assign ให้คนไข้ใน Plan Builder)' : 'Create an exercise in your library (assign it later in Plan Builder)'),
      nameIn, regionNote, typeSel,
      (S.nx?.type || 'rep') === 'rep' ? patternSel : null,
      (S.nx?.type || 'rep') === 'rep' && (S.nx?.movementPattern || 'bilateralSync') === 'alternating' ? countModeSel : null,
      err,
      h('div', { class: 'row gap6' },
        h('button', { class: 'btn primary', style: { flex: '1' }, disabled: selectedExerciseRegion ? null : '', onclick: save }, lng === 'th' ? 'บันทึกท่า' : 'Add exercise'),
        h('button', { class: 'btn ghost', onclick: () => { S.newEx = false; S.nx = null; renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions }); } }, lng === 'th' ? 'ยกเลิก' : 'Cancel')));
  }

  const exerciseChoices = getExercises();
  const exercisePill = (e) => {
    const pill = h('button', { class: 'pill' + (e.id === S.exId ? ' brand' : ''), onclick: () => { S.exId = e.id; S.newEx = false; S.captureDraft = null; S.dataset.recorder = null; S.dataset.active = false; S.landmarkFilter?.reset(); renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions }); } }, exLabel(e, t));
    if (e.source !== 'custom') return pill;
    const del = h('button', { class: 'pill', title: lang === 'th' ? 'ลบท่านี้' : 'Delete', style: { padding: '6px 8px' }, onclick: () => { deleteCustomExercise(e.id); S.captureDraft = null; if (S.exId === e.id) S.exId = EXERCISES[0].id; S.landmarkFilter?.reset(); renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions }); } }, '×');
    return h('span', { class: 'row', style: { alignItems: 'center' } }, pill, del);
  };
  const exercisePills = exerciseChoices.map(exercisePill);
  const selectedRegion = BODY_REGIONS.find((r) => r.id === (ex.bodyRegion || 'full'));
  const selectedRegionLabel = selectedRegion ? (lang === 'th' ? selectedRegion.labelTh : selectedRegion.label) : (ex.bodyRegion || '—');
  const newPill = h('button', { class: 'pill', onclick: () => { S.newEx = !S.newEx; renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions }); }, html: icon('plus', { size: 13 }) + ' ' + (lang === 'th' ? 'เพิ่มท่าใหม่' : 'New exercise') });
  const exSel = h('div', { class: 'card' },
    h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, t('exercise')),
    h('div', { class: 'row gap6 wrap' }, ...exercisePills, newPill),
    h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' } },
      (lang === 'th' ? 'ส่วนร่างกายของท่านี้: ' : 'Body part for this exercise: ') + selectedRegionLabel),
    S.newEx ? newExerciseForm(lang) : null,
  );
  const selectedOverlay = new Set(S.angleOverlayJoints || []);
  const regionChip = (region) => h('button', {
    class: 'pill' + (S.romBodyRegion === region.id ? ' brand' : ''),
    onclick: () => selectRomBodyRegion(region.id),
  }, lang === 'th' ? region.labelTh : region.label);
  const angleChip = (spec) => h('button', {
    class: 'pill' + (selectedOverlay.has(spec.joint) ? ' brand' : ''),
    onclick: () => toggleOverlayJoint(spec.joint),
  }, lang === 'th' ? spec.labelTh : spec.label);
  const autoChip = h('button', {
    class: 'pill' + (!selectedOverlay.size ? ' brand' : ''),
    onclick: resetRomMeasurement,
  }, lang === 'th' ? 'อัตโนมัติตามท่า' : 'Auto');
  const angleCard = h('div', { class: 'card' },
    h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, lang === 'th' ? 'ตั้งค่า Motion บนวิดีโอ' : 'Motion setup'),
    h('div', { class: 'muted', style: { fontSize: '12.5px', marginBottom: '8px' } }, lang === 'th' ? 'เลือกส่วนร่างกาย' : 'Body region'),
    h('div', { class: 'row gap6 wrap' },
      ...ROM_BODY_REGION_IDS
        .map((id) => BODY_REGIONS.find((region) => region.id === id))
        .filter(Boolean)
        .map(regionChip)),
    h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '12px', marginBottom: '8px' } }, lang === 'th' ? 'ปรับรายข้อต่อ' : 'Fine-tune joints'),
    h('div', { class: 'row gap6 wrap' },
      autoChip,
      ...ANGLE_PICKER_JOINTS
        .map((joint) => JOINT_SPECS.find((s) => s.joint === joint))
        .filter(Boolean)
        .map(angleChip)),
    h('div', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' } },
      lang === 'th'
        ? (S.romBodyRegion
          ? 'Boundary จะเขียวเมื่อส่วนร่างกายที่เลือกอยู่ในกรอบ; ส่วนอื่นไม่บังคับ'
          : (selectedOverlay.size ? 'เลือกแสดงมุมได้หลายจุดพร้อมกัน; ตารางด้านล่างยังคำนวณครบทุกข้อ' : 'โหมด Auto จะแสดงมุมหลักของท่าที่เลือก'))
        : (S.romBodyRegion
          ? 'Boundary turns green when the selected body region is framed; other regions are ignored.'
          : (selectedOverlay.size ? 'Show multiple movement angles at once; the table still computes every angle.' : 'Auto shows the selected exercise primary angle'))),
  );

  R.scoreBox = h('div', { html: ringSVG(0, { size: 84, thickness: 8, color: 'var(--brand)', label: '—', fontSize: 24 }) });
  R.scoreText = h('div', { class: 'muted', style: { fontSize: '13px' } }, S.reference ? (S.mode === 'setup' ? t('validate') : t('cueNoPose')) : currentCaptureHint(ex));
  const scoreCard = h('div', { class: 'card row gap16' }, R.scoreBox, h('div', { class: 'grow col gap6' }, h('div', { class: 'eyebrow' }, t('accuracy')), R.scoreText));

  R.tbody = h('tbody');
  for (const spec of JOINT_SPECS) {
    R.tbody.append(h('tr', { class: 'none', dataset: { joint: spec.joint } },
      h('td', {}, lang === 'th' ? spec.labelTh : spec.label),
      h('td', { class: 'num ref' }, '—'), h('td', { class: 'num live' }, '—'),
      h('td', { class: 'num delta' }, '—'), h('td', { class: 'num status' }, '—')));
  }
  const table = h('div', { class: 'card' },
    h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, lang === 'th' ? `มุมข้อต่อ (${JOINT_SPECS.length} จุด)` : `Joint angles (${JOINT_SPECS.length})`),
    h('table', { class: 'data angles' },
      h('thead', {}, h('tr', {}, h('th', {}, lang === 'th' ? 'ข้อต่อ' : 'Joint'),
        h('th', { class: 'num' }, 'Ref'), h('th', { class: 'num' }, 'Live'), h('th', { class: 'num' }, 'Δ'), h('th', { class: 'num' }, 'OK'))),
      R.tbody),
  );

  S.plan = { tol: S.reference?.plan?.tol ?? ex.tol };
  const refMeta = S.reference
    ? `${t('jointsCaptured', { n: Object.values(S.reference.jointAngles).filter((v) => v != null).length })}${S.reference.referenceSequence?.sampleCount ? ' · trajectory ' + S.reference.referenceSequence.sampleCount : ''}${S.reference.source ? ' · ' + S.reference.source : ''}`
    : currentCaptureHint(ex);
  const inPlan = S.patientId ? getPlan(S.patientId).includes(S.exId) : false;
  const numField = (label, key, min, max) => h('label', { class: 'row between', style: { alignItems: 'center' } },
    h('span', { class: 'muted' }, label),
    h('input', {
      type: 'number', value: String(S.plan[key]), min: String(min), max: String(max),
      style: { width: '90px', textAlign: 'right', padding: '5px 9px', border: '1px solid var(--line)', borderRadius: '9px', background: 'var(--surface)', font: 'inherit', color: 'inherit' },
      onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) S.plan[key] = v; },
    }));
  const jointName = (joint) => {
    const spec = JOINT_SPECS.find((s) => s.joint === joint);
    return spec ? (lang === 'th' ? spec.labelTh : spec.label) : joint;
  };
  const refModel = buildReferencePanelModel({
    reference: S.reference,
    exercise: ex,
    romBodyRegion: S.romBodyRegion,
    lang,
    candidateRepJointsForExercise,
    formatMs,
  });
  const jointCycleRows = S.reference && refModel.jointRows.length
    ? h('div', { class: 'col gap6', style: { padding: '8px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' } },
      ...refModel.jointRows.map((row) => {
        return h('div', { class: 'row between', style: { alignItems: 'baseline', gap: '12px' } },
          h('span', { class: 'muted', style: { fontSize: '12.5px' } }, jointName(row.joint)),
          h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, row.valuesText + row.suffix));
      }))
    : null;
  const presCard = h('div', { class: 'card col gap10' },
    h('div', { class: 'eyebrow' }, lang === 'th' ? 'ค่าอ้างอิง (สำหรับให้คะแนน)' : 'Reference target (for scoring)'),
    h('div', { class: 'muted', style: { fontSize: '12.5px' } }, refMeta),
    h('div', { class: 'row between' },
      h('span', { class: 'muted' }, t('targetAngle')), h('b', { class: 'mono' }, refModel.targetShownText)),
    h('div', { class: 'row between' },
      h('span', { class: 'muted' }, lang === 'th' ? 'Rest → Target → Rest' : 'Rest → Target → Rest'),
      h('b', { class: 'mono', style: { fontSize: '12px', textAlign: 'right' } }, refModel.primaryCycleText)),
    h('div', { class: 'row between' },
      h('span', { class: 'muted' }, lang === 'th' ? 'Motion range / Timing' : 'Motion range / Timing'),
      h('b', { class: 'mono', style: { fontSize: '12px', textAlign: 'right' } },
        `${Number.isFinite(refModel.primaryCycle.range) ? Math.round(refModel.primaryCycle.range) + '°' : '—'}${refModel.timingText ? ' · ' + refModel.timingText : ''}`)),
    h('div', { class: 'row between' },
      h('span', { class: 'muted' }, lang === 'th' ? 'Pattern' : 'Pattern'), h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, refModel.patternText)),
    h('div', { class: 'row between' },
      h('span', { class: 'muted' }, lang === 'th' ? 'ข้อต่อที่ติดตาม' : 'Tracked joints'), h('b', { class: 'mono', style: { fontSize: '11px', textAlign: 'right' } }, refModel.trackedLabel)),
    jointCycleRows,
    numField(lang === 'th' ? 'ค่าเผื่อ (±°)' : 'Tolerance (±°)', 'tol', 1, 45),
    h('button', { class: 'btn block', onclick: savePlanSettings,
      html: icon('check', { size: 16 }) + ' ' + (lang === 'th' ? 'บันทึกค่าอ้างอิง' : 'Save target') }),
    h('button', { class: 'btn ' + (inPlan ? 'ghost' : 'primary') + ' block', disabled: S.patientId ? null : '', onclick: togglePlan,
      html: icon(inPlan ? 'check' : 'plus', { size: 16, color: inPlan ? 'var(--brand)' : '#FBFAF5' }) + ' ' + (S.patientId ? (inPlan ? t('removeFromPlan') : t('addToPlan')) : (lang === 'th' ? 'เลือกคนไข้เพื่อเพิ่มในแผน' : 'Select patient to add')) }),
    h('div', { class: 'muted', style: { fontSize: '12px', textAlign: 'center' } },
      lang === 'th' ? 'ตั้งจำนวนครั้ง / เซ็ต / ความถี่ ที่หน้า Plan Builder' : 'Set reps / sets / frequency in Plan Builder'),
  );

  const clipEditor = motionClipEditor({
    S,
    h,
    icon,
    toast,
    lang,
    formatMs,
    getExercise,
    trimPendingSequence,
    saveSequenceReference,
    stopClipPlayback,
    renderPanel: () => renderCapturePanel({ state: S, refs: R, dom, data, helpers, actions }),
    exportSkeletonParameters,
    exportMotionDatasetJsonl,
  });
  const datasetRecorder = renderDatasetRecorderPanel({
    S,
    h,
    icon,
    lang,
    actions: {
      setDatasetLabelTarget,
      setDatasetTargetReps,
      startDatasetRecording,
      stopDatasetRecording,
      exportDatasetBatchJsonl,
    },
  });
  const datasetReview = renderDatasetReviewPanel({
    S,
    h,
    lang,
    actions: {
      reviewDatasetRep,
      skipDatasetRep,
      toggleDatasetReview,
    },
  });
  const workflowPanels = S.captureWorkflow === 'dataset'
    ? [datasetRecorder, datasetReview]
    : S.captureWorkflow === 'validate'
      ? [renderModelValidationPanel({ exercise: ex, reference: S.reference, readiness: S.aiReadiness, h, lang }), scoreCard, table]
      : [renderAiExerciseWizard({ exercise: ex, h, lang }), ...(clipEditor ? [clipEditor] : []), scoreCard, presCard];
  const advancedPanels = S.advancedOpen && S.captureWorkflow !== 'validate' ? [table] : [];
  panel.append(workflowTabs, exSel, angleCard, ...workflowPanels, ...advancedPanels);
  if (S.reference) actions.updateTable(null);
  renderClipPreview();
}

function motionClipEditor({
  S,
  h,
  icon,
  toast,
  lang,
  formatMs,
  getExercise,
  trimPendingSequence,
  saveSequenceReference,
  stopClipPlayback,
  renderPanel,
  exportSkeletonParameters,
  exportMotionDatasetJsonl,
}) {
  const seq = S.pendingSequence;
  if (!seq?.frames?.length || seq.exerciseId !== S.exId) return null;
  const ex = getExercise(S.exId);
  const model = buildMotionClipEditorModel(seq, ex, { lang, formatMs });
  if (!model) return null;
  const rangeStyle = { width: '100%', accentColor: 'var(--brand)' };
  const saveSelected = async () => {
    if (model.frames.length < SEQUENCE_MIN_FRAMES) {
      toast(lang === 'th' ? 'ช่วงที่เลือกสั้นเกินไป' : 'Selected clip is too short.');
      return;
    }
    if (model.targetOffset <= 0 || model.targetOffset >= model.frames.length - 1) {
      toast(lang === 'th' ? 'เลือก target ให้อยู่ระหว่าง rest ทั้งสองฝั่ง' : 'Select a target point between the two rest points.');
      return;
    }
    const ok = await saveSequenceReference(model.frames, model.targetOffset, seq.bodyRegionFlag);
    if (ok) {
      S.pendingSequence = null;
      S.previewFrameIdx = null;
      stopClipPlayback();
      renderPanel();
    }
  };
  const discard = () => {
    S.pendingSequence = null;
    S.previewFrameIdx = null;
    stopClipPlayback();
    renderPanel();
    toast(lang === 'th' ? 'ทิ้งคลิป motion แล้ว' : 'Motion clip discarded.');
  };
  return h('div', { class: 'card col gap10' },
    h('div', { class: 'eyebrow' }, lang === 'th' ? 'ตัดช่วง Motion' : 'Motion clip editor'),
    h('div', { class: 'muted', style: { fontSize: '12.5px' } }, model.description),
    h('div', { style: { position: 'relative', height: '12px', borderRadius: '999px', background: 'var(--surface2)', boxShadow: 'inset 0 0 0 1px var(--line)' } },
      h('div', { style: {
        position: 'absolute',
        left: `${model.startPct}%`,
        right: `${Math.max(0, 100 - model.targetPct)}%`,
        top: '0',
        bottom: '0',
        borderRadius: '999px 0 0 999px',
        background: 'var(--brand)',
      } }),
      h('div', { style: {
        position: 'absolute',
        left: `${model.targetPct}%`,
        right: `${Math.max(0, 100 - model.endPct)}%`,
        top: '0',
        bottom: '0',
        borderRadius: '0 999px 999px 0',
        background: 'var(--good)',
      } }),
      h('span', { style: {
        position: 'absolute',
        left: `calc(${model.targetPct}% - 5px)`,
        top: '-4px',
        width: '20px',
        height: '20px',
        borderRadius: '999px',
        background: 'var(--surface)',
        border: '3px solid var(--brand)',
        boxSizing: 'border-box',
      } })),
    h('label', { class: 'col gap6' },
      h('div', { class: 'row between muted', style: { fontSize: '12px' } },
        h('span', {}, lang === 'th' ? 'Rest เริ่ม' : 'Start rest'),
        h('b', { class: 'mono' }, model.startLabel)),
      h('input', { type: 'range', min: '0', max: String(model.frameCount - 1), value: String(model.startIdx), style: rangeStyle,
        oninput: (e) => trimPendingSequence('start', e.target.value) })),
    h('label', { class: 'col gap6' },
      h('div', { class: 'row between muted', style: { fontSize: '12px' } },
        h('span', {}, lang === 'th' ? 'Target / peak' : 'Target / peak'),
        h('b', { class: 'mono' }, model.targetLabel)),
      h('input', { type: 'range', min: '0', max: String(model.frameCount - 1), value: String(model.targetIdx), style: rangeStyle,
        oninput: (e) => trimPendingSequence('target', e.target.value) })),
    h('label', { class: 'col gap6' },
      h('div', { class: 'row between muted', style: { fontSize: '12px' } },
        h('span', {}, lang === 'th' ? 'Rest จบ' : 'End rest'),
        h('b', { class: 'mono' }, model.endLabel)),
      h('input', { type: 'range', min: '0', max: String(model.frameCount - 1), value: String(model.endIdx), style: rangeStyle,
        oninput: (e) => trimPendingSequence('end', e.target.value) })),
    h('div', { class: 'row between muted', style: { fontSize: '12.5px' } },
      h('span', {}, lang === 'th' ? 'ช่วงที่จะบันทึก' : 'Selected clip'),
      h('b', { class: 'mono' }, model.selectedLabel)),
    h('div', { class: 'row between muted', style: { fontSize: '12.5px' } },
      h('span', {}, lang === 'th' ? 'แบ่งช่วง' : 'Split'),
      h('b', { class: 'mono' }, model.splitLabel)),
    h('div', { class: 'row gap6' },
      h('button', { class: 'btn primary', style: { flex: '1' }, onclick: saveSelected,
        html: icon('check', { size: 16, color: '#FBFAF5' }) + ' ' + (lang === 'th' ? 'บันทึก 1 รอบเต็ม' : 'Save full cycle') }),
      h('button', { class: 'btn', onclick: exportSkeletonParameters,
        html: icon('download', { size: 16 }) + ' Export JSON' }),
      h('button', { class: 'btn', onclick: exportMotionDatasetJsonl,
        html: icon('download', { size: 16 }) + ' Export JSONL' }),
      h('button', { class: 'btn ghost', onclick: discard }, lang === 'th' ? 'ทิ้ง' : 'Discard')),
  );
}
