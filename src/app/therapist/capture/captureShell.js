export function renderCaptureTopbar({
  state: S,
  refs: R,
  dom,
  data,
  actions,
}) {
  const { h, clear, icon, t, getLang } = dom;
  const { getTherapist, isGuest } = data;
  const { addPatient, toggleCamera, onPatientChange, onModelChange, logoutAndReload } = actions;
  const lang = getLang();
  const patients = S.patients;
  const top = document.getElementById('top');
  clear(top);
  const libraryLabel = lang === 'th' ? 'คลังท่าของฉัน' : 'My exercise library';
  const patientSel = h('select', { onchange: onPatientChange },
    h('option', { value: '', selected: S.patientId ? null : '' }, libraryLabel),
    ...patients.map((p) => h('option', { value: p.id, selected: p.id === S.patientId ? '' : null }, p.name)));
  const me = getTherapist();
  const whoName = me?.name || (isGuest() ? 'Guest' : (lang === 'th' ? 'นักกายภาพ' : 'Therapist'));
  const whoBtn = h('button', {
    class: 'btn ghost',
    title: isGuest() ? (lang === 'th' ? 'ออกจากเดโม' : 'Exit demo') : (lang === 'th' ? 'ออกจากระบบ' : 'Log out'),
    onclick: logoutAndReload,
  }, whoName);
  const addPatientBtn = h('button', {
    class: 'btn ghost',
    title: lang === 'th' ? 'ผูกผู้ป่วย' : 'Link patient',
    onclick: addPatient,
    html: icon('plus', { size: 16 }),
  });
  const modelSel = h('select', { onchange: onModelChange },
    h('option', { value: 'lite', selected: S.variant === 'lite' ? '' : null }, t('modelLite')),
    h('option', { value: 'full', selected: S.variant === 'full' ? '' : null }, t('modelFull')),
    h('option', { value: 'heavy', selected: S.variant === 'heavy' ? '' : null }, t('modelHeavy')));
  R.statusPill = h('span', { class: 'pill' }, t('loadingModel'));
  R.camBtn = h('button', { class: 'btn primary', html: icon('cam', { size: 16, color: '#FBFAF5' }) + ' ' + t('startCamera'), onclick: toggleCamera });
  top.append(h('div', { class: 'topbar' },
    h('div', { class: 'brand-row' },
      h('div', { class: 'logo-mark', html: '<img src="/shared/assets/logo-reversed.svg" width="20" height="20" alt="PhysioAI"/>' }),
      h('div', {}, h('div', { class: 'wordmark', html: 'Physio<b>AI</b>' }), h('div', { style: { fontSize: '15px', fontWeight: '600' } }, t('captureTitle'))),
    ),
    h('div', { class: 'row gap10 wrap', style: { justifyContent: 'flex-end' } }, R.statusPill, addPatientBtn, patientSel, modelSel, whoBtn, R.camBtn),
  ));
}

export function renderCaptureShell({
  state: S,
  refs: R,
  dom,
  actions,
}) {
  const { h, clear, icon, t, getLang } = dom;
  const {
    captureButtonText,
    capture,
    setMode,
    toggleSequenceRecording,
    setClipPreviewIndex,
    toggleClipPlayback,
    jumpClipPreview,
    setSequenceMarkerFromPreview,
    exportSkeletonParameters,
    exportMotionDatasetJsonl,
    exportRefs,
    importRefsClick,
    imageInputClick,
    clearRef,
  } = actions;
  const root = document.getElementById('root');
  clear(root);
  const video = h('video', { autoplay: '', muted: '', playsinline: '' });
  const canvas = h('canvas');
  R.video = video;
  R.canvas = canvas;
  R.modeBadge = h('span', { class: 'pill brand' }, S.mode.toUpperCase());
  R.poseStatus = h('span', { class: 'pill glass' }, t('noPose'));
  R.captureBtn = h('button', { class: 'btn primary', disabled: '', html: icon('cam', { size: 16, color: '#FBFAF5' }) + ' ' + captureButtonText(), onclick: capture });
  R.previewPhase = h('b', {}, 'Preview');
  R.previewMeta = h('span', { class: 'mono' }, '0.0s');
  R.previewAngle = h('span', { class: 'mono' }, '');
  R.previewRange = h('input', { type: 'range', min: '0', max: '1', value: '0', oninput: (e) => setClipPreviewIndex(Number(e.target.value), { stop: true }) });
  R.previewPlayBtn = h('button', { class: 'mini', onclick: toggleClipPlayback, html: icon('play', { size: 15 }) + ' Play' });
  const th = getLang() === 'th';
  R.previewStartBtn = h('button', { class: 'mini', onclick: () => jumpClipPreview('start') }, th ? 'Rest เริ่ม' : 'Start');
  R.previewTargetBtn = h('button', { class: 'mini', onclick: () => jumpClipPreview('target') }, 'Target');
  R.previewEndBtn = h('button', { class: 'mini', onclick: () => jumpClipPreview('end') }, th ? 'Rest จบ' : 'End');
  const setStartBtn = h('button', { class: 'mini', onclick: () => setSequenceMarkerFromPreview('start') }, th ? 'ตั้ง start' : 'Set start');
  const setTargetBtn = h('button', { class: 'mini', onclick: () => setSequenceMarkerFromPreview('target') }, th ? 'ตั้ง target' : 'Set target');
  const setEndBtn = h('button', { class: 'mini', onclick: () => setSequenceMarkerFromPreview('end') }, th ? 'ตั้ง end' : 'Set end');
  const exportParamsBtn = h('button', { class: 'mini', onclick: exportSkeletonParameters }, 'Export JSON');
  const exportDatasetBtn = h('button', { class: 'mini', onclick: exportMotionDatasetJsonl }, 'Export JSONL');
  R.previewWrap = h('div', { class: 'clip-player hidden' },
    h('div', { class: 'clip-player-head' },
      h('span', { class: 'eyebrow' }, th ? 'ดู Motion' : 'Motion preview'),
      h('span', { class: 'row gap6', style: { alignItems: 'baseline' } }, R.previewPhase, R.previewMeta)),
    R.previewRange,
    h('div', { class: 'clip-player-controls' }, R.previewPlayBtn, R.previewStartBtn, R.previewTargetBtn, R.previewEndBtn, h('span', { class: 'grow' }), R.previewAngle),
    h('div', { class: 'clip-marker-row' }, setStartBtn, setTargetBtn, setEndBtn, exportParamsBtn, exportDatasetBtn),
  );
  const advancedActionButtons = S.advancedOpen ? [
    h('button', { class: 'btn', html: icon('cam', { size: 16 }) + ' ' + t('fromImage'), onclick: imageInputClick }),
    h('button', { class: 'btn', html: icon('check', { size: 16 }) + ' ' + (th ? 'ส่งออก Refs' : 'Export refs'), onclick: exportRefs }),
    h('button', { class: 'btn', html: icon('plus', { size: 16 }) + ' ' + (th ? 'นำเข้า' : 'Import'), onclick: importRefsClick }),
    h('button', { class: 'btn ghost', html: icon('trash', { size: 16 }), onclick: clearRef }),
  ] : [];

  const main = h('div', { class: 'cap-main' },
    h('div', { class: 'video-card' },
      R.videoFrame = h('div', { class: 'video-frame' }, video, canvas, h('div', { class: 'video-hud' }, R.modeBadge, R.poseStatus), R.previewWrap),
      h('div', { class: 'video-actions' },
        h('div', { class: 'mode-toggle' },
          R.setupBtn = h('button', { class: S.mode === 'setup' ? 'active' : '', onclick: () => setMode('setup') }, t('setup')),
          R.valBtn = h('button', { class: S.mode === 'validate' ? 'active' : '', onclick: () => setMode('validate') }, t('validate')),
        ),
        h('div', { class: 'grow' }),
        R.captureBtn,
        R.recordBtn = h('button', { class: 'btn ghost', html: icon('play', { size: 16 }) + ' ' + (th ? 'Record motion' : 'Record motion'), onclick: toggleSequenceRecording }),
        ...advancedActionButtons,
      ),
    ),
    h('div', { id: 'panel', class: 'panel' }),
  );
  root.append(main);
  return { canvas };
}
