'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureTherapist, getTherapist, logout, isGuest } from '../../../../shared/core/auth-ui.js';
import { EXERCISES, getExercise } from '../../../../shared/core/exercises.js';
import { getReference, getSettings } from '../../../../shared/core/store.js';
import { getLang, icon, mountNav, onLangChange, t, toast } from '../../../../shared/core/ui.js';
import { createPoseEngine, makeDrawer, startCamera, stopCamera } from '../../../../shared/ai/PoseDetection.js';
import { jointAngleCalculator, JOINT_SPECS } from '../../../../shared/ai/JointAngleCalculator.js';
import { makeSyntheticFeed } from '../../../../shared/ai/SyntheticPose.js';
import { drawBoundaryBox, evaluateBoundaryBox } from '../../../../shared/ai/BoundaryBoxGate.js';

const RECORD_CSS = `
  .rec-main { display: grid; grid-template-columns: 1fr 400px; gap: 20px; padding: 20px 24px; align-items: start; max-width: 1280px; margin: 0 auto; }
  .video-card { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
  .video-frame { position: relative; aspect-ratio: 16/10; background: var(--surface3); overflow: hidden; }
  .video-frame video, .video-frame canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
  .video-frame canvas { pointer-events: none; }
  .video-hud { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; pointer-events: none; }
  .video-actions { display: flex; align-items: center; gap: 10px; padding: 14px; border-top: 1px solid var(--line); flex-wrap: wrap; }
  .panel { display: flex; flex-direction: column; gap: 14px; }
  .rec-dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:#B8423C; margin-right:6px; animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: .25; } }
  .count-grid { display:grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size: 13px; }
  .count-grid b { font-family: 'JetBrains Mono', monospace; }
  .record-person { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); font: inherit; }
  @media (max-width: 900px) { .rec-main { grid-template-columns: 1fr; padding: 16px; } }
`;

const LABELS = [
  { id: 'correct', en: 'Correct form', th: 'ท่าถูกต้อง' },
  { id: 'wrong-undershoot', en: 'Wrong · not full range', th: 'ผิด · ยกไม่สุด' },
  { id: 'wrong-lean', en: 'Wrong · leaning', th: 'ผิด · เอียงตัว' },
  { id: 'wrong-multi', en: 'Wrong · multi-joint', th: 'ผิด · หลายข้อต่อ' },
];

const PUSH_MS = 33;

function Markup({ html, as: Tag = 'span', className, style }) {
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Icon({ name, options }) {
  return <Markup html={icon(name, options)} />;
}

function boundaryTone(boundary) {
  const status = boundary?.status || 'outside';
  return status === 'inside' ? 'good' : 'bad';
}

function boundaryText(boundary, lang) {
  if (!boundary) return t('noPose');
  return lang === 'th' ? boundary.hintTh : boundary.hint;
}

function csvText(rows) {
  const cols = [
    'person',
    'exercise',
    'label',
    't_ms',
    'boundary_status',
    'boundary_will_exit',
    ...JOINT_SPECS.map((spec) => `a_${spec.joint}`),
    ...JOINT_SPECS.map((spec) => `d_${spec.joint}`),
  ];
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((col) => row[col] ?? '').join(','));
  return lines.join('\n');
}

function rowsByLabelExercise(rows) {
  const by = {};
  for (const row of rows) {
    const key = `${row.label}|${row.exercise}`;
    by[key] = (by[key] || 0) + 1;
  }
  return Object.entries(by).sort();
}

function Topbar({ lang, statusText, statusTone, cameraOn, onToggleCamera }) {
  const me = getTherapist();
  const whoName = me?.name || (isGuest() ? 'Guest' : (lang === 'th' ? 'นักกายภาพ' : 'Therapist'));
  const whoTitle = isGuest()
    ? (lang === 'th' ? 'ออกจากเดโม' : 'Exit demo')
    : (lang === 'th' ? 'ออกจากระบบ' : 'Log out');
  return (
    <div className="topbar">
      <div className="brand-row">
        <div className="logo-mark">
          <img src="/shared/assets/logo-reversed.svg" width="20" height="20" alt="PhysioAI" />
        </div>
        <div>
          <div className="wordmark">Physio<b>AI</b></div>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>
            {lang === 'th' ? 'เก็บข้อมูลสำหรับเทรน AI (ML Form Scorer)' : 'AI Training Data Recorder (ML Form Scorer)'}
          </div>
        </div>
      </div>
      <div className="row gap10 wrap" style={{ justifyContent: 'flex-end' }}>
        <span className={`pill ${statusTone}`}>{statusText}</span>
        <button
          type="button"
          className="btn ghost"
          title={whoTitle}
          onClick={() => {
            logout();
            location.reload();
          }}
        >
          {whoName}
        </button>
        <button
          type="button"
          className={`btn ${cameraOn ? 'danger' : 'primary'}`}
          onClick={onToggleCamera}
        >
          <Icon name={cameraOn ? 'close' : 'cam'} options={{ size: 16, color: '#FBFAF5' }} />{' '}
          {cameraOn ? t('stopCamera') : t('startCamera')}
        </button>
      </div>
    </div>
  );
}

function ExercisePanel({ exId, lang, demoOn, onSelectExercise }) {
  const refExists = !!getReference(exId);
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: '8px' }}>{t('exercise')}</div>
      <div className="row gap6 wrap">
        {EXERCISES.map((exercise) => (
          <button
            type="button"
            key={exercise.id}
            className={`pill${exercise.id === exId ? ' brand' : ''}`}
            onClick={() => onSelectExercise(exercise.id, demoOn)}
          >
            {t(`ex_${exercise.key}`)}
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: '12px', marginTop: '8px' }}>
        {refExists
          ? (lang === 'th' ? '✓ มี reference สำหรับท่านี้ — delta จะถูกคำนวณ' : '✓ Reference exists — delta will be computed')
          : (lang === 'th' ? '⚠ ยังไม่มี reference — ไป Capture ที่หน้า Setup ก่อน' : '⚠ No reference yet — capture one in Setup first')}
      </div>
    </div>
  );
}

function PersonPanel({ person, setPerson, lang }) {
  return (
    <div className="card col gap8">
      <div className="eyebrow">{lang === 'th' ? 'รหัสผู้ทดสอบ (สำหรับ person-wise split)' : 'Person ID (for person-wise split)'}</div>
      <input
        className="record-person"
        value={person}
        placeholder="P01"
        onChange={(event) => setPerson(event.target.value.trim() || 'P01')}
      />
      <div className="muted" style={{ fontSize: '12px' }}>
        {lang === 'th' ? 'เปลี่ยนรหัสทุกครั้งที่เปลี่ยนคน — ห้ามใช้ซ้ำ' : 'Change per participant — never reuse'}
      </div>
    </div>
  );
}

function LabelPanel({ label, setLabel, lang }) {
  return (
    <div className="card col gap8">
      <div className="eyebrow">{lang === 'th' ? 'Label ของช่วงที่จะอัด' : 'Label for this take'}</div>
      <div className="row gap6 wrap">
        {LABELS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`pill${label === item.id ? ' brand' : ''}`}
            onClick={() => setLabel(item.id)}
          >
            {lang === 'th' ? item.th : item.en}
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: '12px' }}>
        {lang === 'th'
          ? 'เกณฑ์ "ถูก": ทำตาม reference ของนักกายภาพ · ตอนอัด "ผิด" ให้ตั้งใจทำผิดตามชนิดที่เลือก'
          : 'Criteria: "correct" follows the therapist reference; act out the chosen wrong type deliberately'}
      </div>
    </div>
  );
}

function StatsPanel({ rows, rowsVersion, lang, onDownload, onClear }) {
  const entries = useMemo(() => rowsByLabelExercise(rows), [rows, rowsVersion]);
  return (
    <div className="card col gap8">
      <div className="eyebrow">{lang === 'th' ? 'ข้อมูลที่เก็บแล้ว' : 'Collected'}</div>
      <div className="count-grid">
        {entries.length ? entries.map(([key, count]) => {
          const [label, exercise] = key.split('|');
          return (
            <span key={`${key}-label`}>
              {exercise} · {label}
              <b style={{ float: 'right', marginLeft: '12px' }}>{count}</b>
            </span>
          );
        }) : <span className="muted">{lang === 'th' ? 'ยังไม่มีข้อมูล' : 'No frames yet'}</span>}
      </div>
      <div className="row gap8" style={{ marginTop: '6px' }}>
        <button type="button" className="btn primary grow" onClick={onDownload}>
          <Icon name="check" options={{ size: 16, color: '#FBFAF5' }} /> {lang === 'th' ? 'ดาวน์โหลด CSV' : 'Download CSV'}
        </button>
        <button type="button" className="btn ghost" onClick={onClear}>
          <Icon name="trash" options={{ size: 16 }} />
        </button>
      </div>
      <div className="muted" style={{ fontSize: '12px' }}>
        {lang === 'th'
          ? 'เป้าหมาย: ≥300 เฟรม/label/ท่า จากผู้ทดสอบ ≥2–3 คน'
          : 'Target: ≥300 frames/label/exercise from ≥2–3 people'}
      </div>
    </div>
  );
}

export default function TherapistRecordClient() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState('en');
  const [statusText, setStatusText] = useState('Loading pose model...');
  const [statusTone, setStatusTone] = useState('glass');
  const [cameraOn, setCameraOn] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [recording, setRecordingState] = useState(false);
  const [exId, setExId] = useState(EXERCISES[0].id);
  const [person, setPersonState] = useState('P01');
  const [label, setLabelState] = useState('correct');
  const [frameCount, setFrameCount] = useState(0);
  const [rowsVersion, setRowsVersion] = useState(0);
  const [poseStatus, setPoseStatus] = useState(t('noPose'));
  const [poseTone, setPoseTone] = useState('glass');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const drawerRef = useRef(null);
  const feedRef = useRef(null);
  const rafRef = useRef(0);
  const boundaryFrameRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const lastPushRef = useRef(0);
  const t0Ref = useRef(0);
  const rowsRef = useRef([]);
  const stateRef = useRef({
    cameraOn: false,
    demoOn: false,
    recording: false,
    exId: EXERCISES[0].id,
    person: 'P01',
    label: 'correct',
    variant: 'full',
  });

  const touchRows = useCallback(() => {
    setFrameCount(rowsRef.current.length);
    setRowsVersion((version) => version + 1);
  }, []);

  const setPerson = useCallback((value) => {
    const next = value.trim() || 'P01';
    stateRef.current.person = next;
    setPersonState(next);
  }, []);

  const setLabel = useCallback((value) => {
    stateRef.current.label = value;
    setLabelState(value);
  }, []);

  const currentBoundary = useCallback((landmarks, { reset = false } = {}) => (
    evaluateBoundaryBox(
      landmarks,
      reset ? null : boundaryFrameRef.current,
      { ...getExercise(stateRef.current.exId), bodyRegion: 'full', primaryJoint: null },
    )
  ), []);

  const paint = useCallback((landmarks) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) {
      const boundary = currentBoundary(null, { reset: true });
      boundaryFrameRef.current = boundary.nextFrame;
      drawBoundaryBox(ctx, boundary);
      setPoseStatus(`${t('noPose')} · ${boundaryText(boundary, getLang())}`);
      setPoseTone(boundaryTone(boundary));
      return boundary;
    }
    const boundary = currentBoundary(landmarks);
    boundaryFrameRef.current = boundary.nextFrame;
    setPoseStatus(`${landmarks.length} pts · ${boundaryText(boundary, getLang())}`);
    setPoseTone(boundaryTone(boundary));
    drawerRef.current?.(landmarks, {
      color: stateRef.current.recording ? '#B8423C' : '#2F5D50',
      accent: stateRef.current.recording ? '#D98C84' : '#7BA88F',
    });
    drawBoundaryBox(ctx, boundary);
    return boundary;
  }, [currentBoundary]);

  const pushFrame = useCallback((landmarks, tMs, boundary) => {
    if (boundary?.status === 'outside') return;
    if (tMs - lastPushRef.current < PUSH_MS) return;
    lastPushRef.current = tMs;
    const current = stateRef.current;
    const angles = jointAngleCalculator(landmarks);
    const ref = getReference(current.exId)?.jointAngles || null;
    const row = {
      person: current.person,
      exercise: current.exId,
      label: current.label,
      t_ms: Math.round(tMs),
      boundary_status: boundary?.status || '',
      boundary_will_exit: boundary?.willExit ? '1' : '0',
    };
    for (const spec of JOINT_SPECS) {
      const angle = angles[spec.joint];
      row[`a_${spec.joint}`] = angle == null ? '' : angle.toFixed(2);
      const refValue = ref?.[spec.joint];
      row[`d_${spec.joint}`] = angle == null || refValue == null ? '' : (angle - refValue).toFixed(2);
    }
    rowsRef.current.push(row);
    setFrameCount(rowsRef.current.length);
    if (rowsRef.current.length % 5 === 0) setRowsVersion((version) => version + 1);
  }, []);

  const liveLoop = useCallback(() => {
    const current = stateRef.current;
    const engine = engineRef.current;
    const video = videoRef.current;
    if (!current.cameraOn || !engine || !video) return;
    if (engine.state.ready && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const result = engine.detectVideo(video, performance.now());
      const landmarks = result?.landmarks?.[0];
      const boundary = paint(landmarks);
      if (landmarks && current.recording) pushFrame(landmarks, performance.now() - t0Ref.current, boundary);
    }
    rafRef.current = requestAnimationFrame(liveLoop);
  }, [paint, pushFrame]);

  const demoLoop = useCallback(() => {
    const current = stateRef.current;
    const feed = feedRef.current;
    if (!current.demoOn || !feed) return;
    const elapsed = (performance.now() - t0Ref.current) / 1000;
    const { landmarks } = feed(elapsed);
    const boundary = paint(landmarks);
    if (current.recording) pushFrame(landmarks, performance.now() - t0Ref.current, boundary);
    rafRef.current = requestAnimationFrame(demoLoop);
  }, [paint, pushFrame]);

  const setRecording = useCallback((next) => {
    const current = stateRef.current;
    if (next && !current.cameraOn && !current.demoOn) {
      toast(getLang() === 'th' ? 'เปิดกล้องหรือ Demo ก่อน' : 'Start camera or demo first');
      return;
    }
    if (next && !getReference(current.exId)) {
      toast(getLang() === 'th'
        ? 'เตือน: ท่านี้ยังไม่มี reference — คอลัมน์ delta จะว่าง'
        : 'Warning: no reference for this exercise — delta columns will be empty', 3200);
    }
    current.recording = next;
    setRecordingState(next);
  }, []);

  const initEngine = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setStatusText(t('loadingModel'));
      setStatusTone('warn');
      const info = await engine.init(stateRef.current.variant);
      setStatusText(`${getLang() === 'th' ? 'พร้อม' : 'Ready'} · ${info.delegate}`);
      setStatusTone('good');
    } catch {
      setStatusText(getLang() === 'th' ? 'โหลดโมเดลไม่สำเร็จ' : 'Model failed');
      setStatusTone('bad');
    }
  }, []);

  const stopLoops = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const stopActiveCamera = useCallback(() => {
    const video = videoRef.current;
    if (video) stopCamera(video);
    stateRef.current.cameraOn = false;
    setCameraOn(false);
  }, []);

  const resetBoundaryAndCanvas = useCallback(() => {
    boundaryFrameRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPoseStatus(t('noPose'));
    setPoseTone('glass');
  }, []);

  const stopDemo = useCallback(() => {
    stateRef.current.demoOn = false;
    feedRef.current = null;
    setDemoOn(false);
    const video = videoRef.current;
    if (video) video.style.display = '';
    setRecording(false);
    resetBoundaryAndCanvas();
  }, [resetBoundaryAndCanvas, setRecording]);

  const toggleCamera = useCallback(async () => {
    const current = stateRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (current.demoOn) stopDemo();
    if (current.cameraOn) {
      stopLoops();
      stopActiveCamera();
      setRecording(false);
      resetBoundaryAndCanvas();
      return;
    }
    try {
      await startCamera(video, { facingMode: 'user' });
      if (!engineRef.current?.state.ready) await initEngine();
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      current.cameraOn = true;
      setCameraOn(true);
      t0Ref.current = performance.now();
      boundaryFrameRef.current = null;
      rafRef.current = requestAnimationFrame(liveLoop);
    } catch {
      toast(t('cameraDenied'));
    }
  }, [initEngine, liveLoop, resetBoundaryAndCanvas, setRecording, stopActiveCamera, stopDemo, stopLoops]);

  const toggleDemo = useCallback((force) => {
    const current = stateRef.current;
    const next = force != null ? force : !current.demoOn;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (next && current.cameraOn) {
      stopLoops();
      stopActiveCamera();
      setRecording(false);
    }
    current.demoOn = next;
    setDemoOn(next);
    if (next) {
      feedRef.current = makeSyntheticFeed(getExercise(current.exId));
      t0Ref.current = performance.now();
      canvas.width = 960;
      canvas.height = 600;
      boundaryFrameRef.current = null;
      if (video) video.style.display = 'none';
      rafRef.current = requestAnimationFrame(demoLoop);
    } else {
      if (video) video.style.display = '';
      setRecording(false);
      resetBoundaryAndCanvas();
    }
  }, [demoLoop, resetBoundaryAndCanvas, setRecording, stopActiveCamera, stopLoops]);

  const handleSelectExercise = useCallback((nextExId) => {
    stateRef.current.exId = nextExId;
    setExId(nextExId);
    if (stateRef.current.demoOn) feedRef.current = makeSyntheticFeed(getExercise(nextExId));
  }, []);

  const download = useCallback(() => {
    const rows = rowsRef.current;
    if (!rows.length) {
      toast(getLang() === 'th' ? 'ยังไม่มีข้อมูล' : 'No data yet');
      return;
    }
    const blob = new Blob([csvText(rows)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `physioai_dataset_${stateRef.current.person}_${Date.now()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    toast(`${getLang() === 'th' ? 'ดาวน์โหลดแล้ว · ' : 'Downloaded · '}${rows.length} rows`);
  }, []);

  const clearRows = useCallback(() => {
    if (!confirm(getLang() === 'th' ? 'ล้างข้อมูลที่อัดไว้?' : 'Clear recorded data?')) return;
    rowsRef.current = [];
    touchRows();
  }, [touchRows]);

  useEffect(() => {
    let mounted = true;
    document.body.classList.add('web-shell');
    setLang(getLang());
    const unsubscribe = onLangChange((nextLang) => {
      if (mounted) setLang(nextLang);
    });
    engineRef.current = createPoseEngine();
    stateRef.current.variant = getSettings().modelVariant;
    Object.defineProperty(window, '__recRows', {
      configurable: true,
      get: () => rowsRef.current,
    });
    ensureTherapist().then(() => {
      if (!mounted) return;
      setReady(true);
      initEngine();
    });
    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
      stopLoops();
      stopActiveCamera();
      engineRef.current?.close();
      try { delete window.__recRows; } catch {}
      document.body.classList.remove('web-shell');
      document.querySelectorAll('.nav, .nav-back').forEach((node) => node.remove());
    };
  }, [initEngine, stopActiveCamera, stopLoops]);

  useEffect(() => {
    if (!ready) return;
    mountNav('therapist/record');
  }, [ready, lang]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawerRef.current) return;
    drawerRef.current = makeDrawer(canvas.getContext('2d'));
  }, [ready]);

  if (!ready) return null;

  const rows = rowsRef.current;

  return (
    <>
      <style>{RECORD_CSS}</style>
      <Topbar
        lang={lang}
        statusText={statusText}
        statusTone={statusTone}
        cameraOn={cameraOn}
        onToggleCamera={toggleCamera}
      />
      <div className="rec-main">
        <div className="video-card">
          <div className="video-frame">
            <video ref={videoRef} autoPlay muted playsInline />
            <canvas ref={canvasRef} />
            <div className="video-hud">
              <div className="row gap6">
                {recording ? <span className="pill bad glass"><span className="rec-dot" />REC</span> : null}
                <span className="pill glass">{frameCount} frames</span>
              </div>
              <span className={`pill ${poseTone} glass`}>{poseStatus}</span>
            </div>
          </div>
          <div className="video-actions">
            <button
              type="button"
              className={`btn ${demoOn ? 'danger' : 'ghost'}`}
              onClick={() => toggleDemo()}
            >
              <Icon name="play" options={{ size: 16 }} /> {demoOn ? (lang === 'th' ? 'หยุด Demo' : 'Stop demo') : t('demoMode')}
            </button>
            <div className="grow" />
            <button
              type="button"
              className={`btn ${recording ? 'danger' : 'primary'}`}
              onClick={() => setRecording(!recording)}
            >
              {recording ? <span className="rec-dot" /> : <Icon name="play" options={{ size: 16, color: '#FBFAF5' }} />}
              {recording ? (lang === 'th' ? 'หยุดอัด' : 'Stop') : (lang === 'th' ? 'เริ่มอัด' : 'Record')}
            </button>
          </div>
        </div>
        <div className="panel">
          <ExercisePanel exId={exId} lang={lang} demoOn={demoOn} onSelectExercise={handleSelectExercise} />
          <PersonPanel person={person} setPerson={setPerson} lang={lang} />
          <LabelPanel label={label} setLabel={setLabel} lang={lang} />
          <StatsPanel
            rows={rows}
            rowsVersion={rowsVersion}
            lang={lang}
            onDownload={download}
            onClear={clearRows}
          />
        </div>
      </div>
    </>
  );
}
