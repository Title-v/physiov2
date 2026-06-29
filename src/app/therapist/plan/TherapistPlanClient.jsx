'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureTherapist, getTherapist, logout, isGuest } from '../../../../shared/core/auth-ui.js';
import { COUNT_MODES, getExercises, getExercise, exLabel, exerciseSnapshot } from '../../../../shared/core/exercises.js';
import { getPlanFull, savePlanFull, getAllReferences, syncPatientCloudData } from '../../../../shared/core/store.js';
import { fetchPatients, linkPatient, createPatient } from '../../../../shared/core/patients.js';
import { getLang, icon, mountNav, onLangChange, t, toast } from '../../../../shared/core/ui.js';

const PLAN_CSS = `
  .plan-main { display: grid; grid-template-columns: 1fr 360px; gap: 20px; padding: 20px 24px; align-items: start; max-width: 1200px; margin: 0 auto; }
  .dose-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 10px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); }
  .dose-row:first-of-type { border-top: 0; }
  .dose-field { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .dose-field input, .dose-field select { width: 76px; text-align: center; padding: 6px 8px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); font: inherit; color: inherit; }
  .dose-field select { width: 112px; }
  .dose-field .cap { font-size: 10.5px; letter-spacing: .5px; text-transform: uppercase; color: var(--ink3); font-weight: 600; }
  .x-btn { border: 0; background: transparent; color: var(--ink3); cursor: pointer; padding: 6px; border-radius: 8px; }
  .x-btn:hover { background: var(--surface2); color: var(--bad); }
  @media (max-width: 880px) { .plan-main { grid-template-columns: 1fr; padding: 16px; } }
  .sub-label { font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--ink3); font-weight: 600; margin: 14px 0 8px; }
  .sub-label:first-of-type { margin-top: 4px; }
  .f-cap { display: block; font-size: 11.5px; color: var(--ink2); font-weight: 600; margin-bottom: 5px; }
  .stepper { display: flex; align-items: center; justify-content: space-between; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; }
  .stepper button { width: 34px; height: 38px; border: 0; background: transparent; color: var(--ink2); font-size: 18px; cursor: pointer; line-height: 1; }
  .stepper button:hover { background: var(--surface2); color: var(--brand-deep); }
  .stepper input { width: 100%; min-width: 0; border: 0; background: transparent; text-align: center; font-family: var(--mono); font-weight: 600; font-size: 16px; color: var(--ink); padding: 0; outline: none; }
  .stepper input:focus { box-shadow: none; }
  .tf-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .tf-row input[type="date"] { width: 150px; text-align: right; font-family: var(--mono); font-size: 13px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); }
  .len { display: flex; align-items: center; gap: 8px; }
  .len .stepper { width: 120px; }
  .len .unit { font-size: 12px; color: var(--ink3); font-weight: 600; }
  .tl { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
  .tl-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 9px; }
  .tl-weeks { font-family: var(--mono); font-weight: 600; font-size: 13px; color: var(--brand-deep); }
  .tl-bar { position: relative; height: 10px; border-radius: var(--r-pill); background: var(--surface2); box-shadow: inset 0 0 0 1px var(--line); }
  .tl-fill { position: absolute; inset: 0; border-radius: var(--r-pill); background: linear-gradient(90deg, var(--brand), var(--brand-deep)); }
  .tl-tick { position: absolute; top: 50%; width: 2px; height: 10px; transform: translate(-1px, -50%); background: rgba(255,255,255,.55); border-radius: 2px; }
  .tl-cap { position: absolute; top: 50%; width: 14px; height: 14px; border-radius: var(--r-pill); background: var(--surface); transform: translate(-50%, -50%); }
  .tl-cap.start { left: 1px; transform: translate(0, -50%); box-shadow: 0 0 0 3px var(--brand-deep); }
  .tl-cap.end { right: 1px; transform: translate(0, -50%); box-shadow: 0 0 0 3px var(--brand); }
  .tl-dates { display: flex; justify-content: space-between; margin-top: 9px; font-family: var(--mono); font-size: 12px; color: var(--ink2); }
  .tl-dates small { display: block; font-family: var(--sans); font-size: 10px; letter-spacing: .5px; text-transform: uppercase; color: var(--ink3); font-weight: 600; }
  .tl-dates .end { text-align: right; }
  .prog { position: relative; overflow: hidden; }
  .prog::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, var(--brand), var(--brand-deep)); }
  .prog .eyebrow { color: var(--brand-deep); }
  .prog.empty::before { background: var(--surface3); }
  .prog.empty .eyebrow { color: var(--ink3); }
  .hero { display: flex; align-items: baseline; gap: 10px; margin: 10px 0 2px; }
  .hero .num { font-family: var(--mono); font-weight: 700; font-size: 46px; line-height: .9; color: var(--brand-deep); letter-spacing: 0; }
  .hero.empty .num { color: var(--ink3); font-size: 34px; }
  .hero .u { display: flex; flex-direction: column; gap: 1px; }
  .hero .u b { font-size: 14px; font-weight: 600; color: var(--ink); }
  .hero .u span { font-size: 12px; color: var(--ink3); }
  .breakdown { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 14px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: var(--r-pill); background: var(--brand-soft); color: var(--brand-deep); font-size: 12px; font-weight: 600; }
  .chip .d { font-family: var(--mono); }
  .prog .hint { font-size: 12.5px; color: var(--ink3); margin: 8px 0 14px; line-height: 1.5; }
  .plan-note { width: 100%; resize: vertical; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font: inherit; color: inherit; }
`;

function Markup({ html, as: Tag = 'span', className, style }) {
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Icon({ name, options }) {
  return <Markup html={icon(name, options)} />;
}

function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date((dateStr || todayStr()) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

function ensureStartDate(plan) {
  return plan?.startDate ? plan : { ...plan, startDate: todayStr() };
}

function planItemDefault(id) {
  const ex = getExercise(id);
  const item = { exerciseId: id, reps: ex.reps, sets: ex.sets, holdSec: ex.holdSec, tol: ex.tol };
  if (ex.movementPattern === 'alternating') item.countMode = ex.countMode || 'per_side';
  const snap = exerciseSnapshot(ex);
  if (snap) item.exercise = snap;
  return item;
}

function daysWord(days, lang) {
  return lang === 'th' ? 'วัน' : (days === 1 ? 'day' : 'days');
}

function fmtDate(dateStr, lang) {
  const d = new Date((dateStr || todayStr()) + 'T00:00:00');
  return d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short' });
}

function inPlan(plan, id) {
  return plan.items.some((item) => item.exerciseId === id);
}

function Topbar({ lang, patients, patientId, onPatientChange, onAddPatient, onSave }) {
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
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{t('modePlan')}</div>
        </div>
      </div>
      <div className="row gap10 wrap" style={{ justifyContent: 'flex-end' }}>
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
          className="btn ghost"
          title={lang === 'th' ? 'ผูกผู้ป่วย' : 'Link patient'}
          onClick={onAddPatient}
        >
          <Icon name="plus" options={{ size: 16 }} />
        </button>
        {patients.length ? (
          <select value={patientId || ''} onChange={(event) => onPatientChange(event.target.value)}>
            {patients.map((patient) => (
              <option value={patient.id} key={patient.id}>{patient.name}</option>
            ))}
          </select>
        ) : (
          <select disabled>
            <option>{lang === 'th' ? 'ยังไม่มีผู้ป่วย' : 'No patients yet'}</option>
          </select>
        )}
        <button type="button" className="btn primary" onClick={onSave}>
          <Icon name="check" options={{ size: 16, color: '#FBFAF5' }} /> {t('savePlan')}
        </button>
      </div>
    </div>
  );
}

function PickerCard({ plan, onToggle }) {
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: '4px' }}>{t('exercise')}</div>
      <div className="muted" style={{ fontSize: '12.5px', marginBottom: '10px' }}>{t('tapToAdd')}</div>
      <div className="row gap6 wrap">
        {getExercises().map((exercise) => {
          const selected = inPlan(plan, exercise.id);
          return (
            <button
              type="button"
              key={exercise.id}
              className={`pill${selected ? ' brand' : ''}`}
              onClick={() => onToggle(exercise.id)}
            >
              <Icon name={selected ? 'check' : 'plus'} options={{ size: 13, color: selected ? '#FBFAF5' : 'var(--ink2)' }} />{' '}
              {exLabel(exercise, t)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DoseField({ cap, item, fieldKey, min, max, onUpdate }) {
  return (
    <div className="dose-field">
      <span className="cap">{cap}</span>
      <input
        type="number"
        value={String(item[fieldKey])}
        min={min}
        max={max}
        onChange={(event) => {
          const value = Math.min(max, Math.max(min, Number(event.target.value)));
          if (Number.isFinite(value)) onUpdate(item.exerciseId, { [fieldKey]: value });
        }}
      />
    </div>
  );
}

function SelectField({ cap, item, fieldKey, options, lang, onUpdate }) {
  return (
    <div className="dose-field">
      <span className="cap">{cap}</span>
      <select
        value={item[fieldKey] || 'per_side'}
        onChange={(event) => onUpdate(item.exerciseId, { [fieldKey]: event.target.value })}
      >
        {options.map((option) => (
          <option value={option.id} key={option.id}>
            {lang === 'th' ? option.labelTh : option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DosageCard({ plan, refs, lang, onToggle, onUpdateItem }) {
  const th = lang === 'th';
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: '6px' }}>
        {t('planExercises')}{plan.items.length ? ` · ${plan.items.length}` : ''}
      </div>
      {!plan.items.length ? (
        <div className="muted" style={{ padding: '8px 0', fontSize: '13px' }}>{t('noExercises')}</div>
      ) : (
        <div>
          {plan.items.map((item) => {
            const ex = item.exercise || getExercise(item.exerciseId);
            const hasLibraryRef = ex.source === 'custom' && !!(ex.jointMotion || ex.targetJointAngles || ex.jointAngles);
            const hasRef = !!refs[item.exerciseId] || hasLibraryRef;
            return (
              <div className="dose-row" key={item.exerciseId}>
                <div className="col gap6">
                  <b>{exLabel(ex, t)}</b>
                  <span style={{ fontSize: '11.5px', fontWeight: 600, color: hasRef ? 'var(--good)' : 'var(--warn)' }}>
                    {hasRef
                      ? (hasLibraryRef && !refs[item.exerciseId]
                        ? (th ? '✓ มี reference ในคลัง' : '✓ library reference')
                        : (th ? '✓ มี reference' : '✓ has reference'))
                      : (th ? '⚠ ยังไม่ได้จับท่า · ใช้ค่า default' : '⚠ no reference · using defaults')}
                  </span>
                </div>
                {ex.type === 'hold' ? (
                  <DoseField cap={t('holdSec')} item={item} fieldKey="holdSec" min={1} max={120} onUpdate={onUpdateItem} />
                ) : (
                  <DoseField cap={t('repsTarget')} item={item} fieldKey="reps" min={1} max={50} onUpdate={onUpdateItem} />
                )}
                <DoseField cap={t('setsTarget')} item={item} fieldKey="sets" min={1} max={10} onUpdate={onUpdateItem} />
                {ex.movementPattern === 'alternating' ? (
                  <SelectField
                    cap={th ? 'การนับ' : 'Count'}
                    item={item}
                    fieldKey="countMode"
                    options={COUNT_MODES}
                    lang={lang}
                    onUpdate={onUpdateItem}
                  />
                ) : null}
                <button
                  type="button"
                  className="x-btn"
                  title={t('removeFromPlan')}
                  onClick={() => onToggle(item.exerciseId)}
                >
                  <Icon name="trash" options={{ size: 16 }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stepper({ value, min, max, onChange }) {
  const set = (nextValue) => {
    const n = Math.min(max, Math.max(min, Math.round(nextValue)));
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <div className="stepper">
      <button type="button" onClick={() => set((Number(value) || min) - 1)}>−</button>
      <input
        type="number"
        value={String(value)}
        min={min}
        max={max}
        onChange={(event) => set(Number(event.target.value))}
      />
      <button type="button" onClick={() => set((Number(value) || min) + 1)}>+</button>
    </div>
  );
}

function ScheduleCard({ plan, lang, onPatch }) {
  const th = lang === 'th';
  const days = plan.durationDays;
  const ticks = [];
  for (let i = 7; i < days; i += 7) {
    ticks.push(<span className="tl-tick" style={{ left: `${(i / days) * 100}%` }} key={i} />);
  }
  return (
    <div className="card">
      <div className="eyebrow">{t('schedule')}</div>
      <div className="sub-label">{th ? 'ความถี่' : 'Cadence'}</div>
      <label className="tf-row">
        <span className="f-cap" style={{ margin: 0 }}>{th ? 'ครั้ง / วัน' : 'Times / day'}</span>
        <span className="len">
          <Stepper value={plan.freqPerDay} min={1} max={6} onChange={(value) => onPatch({ freqPerDay: value })} />
        </span>
      </label>
      <div className="sub-label">{th ? 'ช่วงเวลา' : 'Timeframe'}</div>
      <label className="tf-row">
        <span className="f-cap" style={{ margin: 0 }}>{t('startDate')}</span>
        <input
          type="date"
          value={plan.startDate}
          onChange={(event) => onPatch({ startDate: event.target.value || todayStr() })}
        />
      </label>
      <label className="tf-row">
        <span className="f-cap" style={{ margin: 0 }}>{th ? 'ระยะเวลา' : 'Length'}</span>
        <span className="len">
          <Stepper value={plan.durationDays} min={1} max={365} onChange={(value) => onPatch({ durationDays: value })} />
          <span className="unit">{daysWord(days, lang)}</span>
        </span>
      </label>
      <div className="tl">
        <div className="tl-head">
          <span className="eyebrow">{th ? 'ช่วงโปรแกรม' : 'Program span'}</span>
          <span className="tl-weeks">{days} {daysWord(days, lang)}</span>
        </div>
        <div className="tl-bar">
          <div className="tl-fill" />
          {ticks}
          <span className="tl-cap start" />
          <span className="tl-cap end" />
        </div>
        <div className="tl-dates">
          <span><small>{th ? 'เริ่ม' : 'Start'}</small>{fmtDate(plan.startDate, lang)}</span>
          <span className="end"><small>{th ? 'สิ้นสุด' : 'Ends'}</small>{fmtDate(addDays(plan.startDate, days), lang)}</span>
        </div>
      </div>
    </div>
  );
}

function NotesCard({ plan, lang, onPatch }) {
  return (
    <div className="card col gap6">
      <div className="eyebrow">{t('notesForPatient')}</div>
      <textarea
        rows={3}
        className="plan-note"
        placeholder={lang === 'th'
          ? 'เช่น หยุดถ้าเจ็บแปลบ · พัก 30 วินาทีระหว่างเซ็ต'
          : 'e.g. Stop if you feel sharp pain. Rest 30s between sets.'}
        value={plan.notes || ''}
        onChange={(event) => onPatch({ notes: event.target.value })}
      />
    </div>
  );
}

function Chip({ num, label }) {
  return (
    <span className="chip">
      <span className="d">{num}</span>
      {label}
    </span>
  );
}

function SummaryCard({ plan, lang, onSave }) {
  const n = plan.items.length;
  const total = n * plan.freqPerDay * plan.durationDays;
  const empty = n === 0;
  const th = lang === 'th';
  return (
    <div className={`card prog${empty ? ' empty' : ''}`}>
      <div className="eyebrow">{th ? 'โปรแกรม' : 'Program'}</div>
      <div className={`hero${empty ? ' empty' : ''}`}>
        <span className="num">{empty ? '-' : total}</span>
        <span className="u">
          <b>{th ? 'เซสชัน' : 'sessions'}</b>
          <span>
            {empty
              ? (th ? 'ยังไม่มีโปรแกรม' : 'nothing scheduled yet')
              : `${th ? 'ภายใน' : 'over'} ${plan.durationDays} ${daysWord(plan.durationDays, lang)}`}
          </span>
        </span>
      </div>
      {empty ? (
        <div className="hint">
          {th
            ? 'เพิ่มท่าทางด้านซ้ายเพื่อสร้างโปรแกรม จำนวนรวมจะอัปเดตให้เอง'
            : 'Add exercises on the left to build the program. The total dose updates as you go.'}
        </div>
      ) : (
        <div className="breakdown">
          <Chip num={n} label={th ? 'ท่า' : 'exercises'} />
          <Chip num={plan.freqPerDay} label={th ? 'ครั้ง/วัน' : '× / day'} />
        </div>
      )}
      <button type="button" className="btn primary block" disabled={empty} onClick={onSave}>
        <Icon name="check" options={{ size: 16, color: '#FBFAF5' }} /> {t('savePlan')}
      </button>
    </div>
  );
}

function LoadingPlan({ lang }) {
  return (
    <div className="plan-main">
      <div className="card" style={{ padding: '28px', textAlign: 'center' }}>
        <div className="muted">{lang === 'th' ? 'กำลังโหลดแผน...' : 'Loading plan...'}</div>
      </div>
    </div>
  );
}

export default function TherapistPlanClient() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState('en');
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState(null);
  const [plan, setPlan] = useState(null);
  const patientIdRef = useRef(null);

  const loadPatientData = useCallback(async (nextPatientId) => {
    if (nextPatientId) await syncPatientCloudData(nextPatientId);
    setPlan(ensureStartDate(getPlanFull(nextPatientId)));
  }, []);

  const refreshPatients = useCallback(async (preferredId = null) => {
    const roster = await fetchPatients();
    const nextPatientId = preferredId && roster.some((patient) => patient.id === preferredId)
      ? preferredId
      : (patientIdRef.current && roster.some((patient) => patient.id === patientIdRef.current) ? patientIdRef.current : roster[0]?.id || null);
    setPatients(roster);
    patientIdRef.current = nextPatientId;
    setPatientId(nextPatientId);
    await loadPatientData(nextPatientId);
  }, [loadPatientData]);

  useEffect(() => {
    let mounted = true;
    document.body.classList.add('web-shell');
    setLang(getLang());
    const unsubscribe = onLangChange((nextLang) => {
      if (mounted) setLang(nextLang);
    });

    ensureTherapist().then(async () => {
      if (!mounted) return;
      try {
        await refreshPatients();
      } catch {
        toast(getLang() === 'th' ? 'โหลดรายชื่อผู้ป่วยไม่สำเร็จ' : 'Could not load patients');
        setPatients([]);
        setPatientId(null);
        setPlan(ensureStartDate(getPlanFull(null)));
      }
      if (mounted) setReady(true);
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
      document.body.classList.remove('web-shell');
      document.querySelectorAll('.nav, .nav-back').forEach((node) => node.remove());
    };
  }, [refreshPatients]);

  useEffect(() => {
    if (!ready) return;
    mountNav('therapist/plan');
  }, [ready, lang]);

  const refs = useMemo(() => getAllReferences(patientId), [patientId, plan]);

  const handlePatientChange = async (nextPatientId) => {
    patientIdRef.current = nextPatientId;
    setPatientId(nextPatientId);
    try {
      await loadPatientData(nextPatientId);
    } catch {
      toast(getLang() === 'th' ? 'โหลดข้อมูลผู้ป่วยจากคลาวด์ไม่สำเร็จ' : 'Could not load patient cloud data');
      setPlan(ensureStartDate(getPlanFull(nextPatientId)));
    }
  };

  const handleAddPatient = async () => {
    const creating = confirm(lang === 'th'
      ? 'สร้าง patient account ใหม่?\nกด Cancel ถ้าต้องการผูก patient ที่มีอยู่แล้ว'
      : 'Create a new patient account?\nPress Cancel to link an existing patient.');
    try {
      let patient = null;
      if (creating) {
        const name = prompt(lang === 'th' ? 'ชื่อคนไข้' : 'Patient name');
        if (!name) return;
        const email = prompt(lang === 'th' ? 'อีเมลคนไข้ (ต้องไม่ใช่อีเมล therapist)' : 'Patient email (not the therapist email)');
        if (!email) return;
        const password = prompt(lang === 'th' ? 'รหัสผ่านเริ่มต้นของคนไข้' : 'Initial patient password');
        if (!password) return;
        patient = await createPatient({ name, email, password });
      } else {
        const value = prompt(lang === 'th' ? 'Patient email หรือ patient id' : 'Patient email or patient id');
        if (!value) return;
        patient = await linkPatient(value);
      }
      await refreshPatients(patient.id);
      toast(patient.verificationRequired
        ? (lang === 'th' ? `สร้างแล้ว · ${patient.name} · ให้คนไข้ verify email ก่อนเข้าใช้` : `Created · ${patient.name} · ask the patient to verify email before sign-in`)
        : (lang === 'th' ? `พร้อมใช้งานแล้ว · ${patient.name}` : `Patient ready · ${patient.name}`));
    } catch (error) {
      const exists = error.code === 'email_used_by_non_patient' || error.code === 'exists';
      toast(exists
        ? (lang === 'th' ? 'อีเมลนี้ใช้เป็น therapist อยู่แล้ว' : 'This email is already used by a therapist')
        : (lang === 'th' ? 'สร้าง/ผูกผู้ป่วยไม่สำเร็จ' : 'Could not create/link patient'));
    }
  };

  const handleToggleExercise = (id) => {
    setPlan((current) => {
      if (!current) return current;
      const exists = inPlan(current, id);
      const items = exists
        ? current.items.filter((item) => item.exerciseId !== id)
        : [...current.items, planItemDefault(id)];
      return { ...current, items };
    });
  };

  const handleUpdateItem = (exerciseId, patch) => {
    setPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => (
          item.exerciseId === exerciseId ? { ...item, ...patch } : item
        )),
      };
    });
  };

  const handlePatchPlan = (patch) => {
    setPlan((current) => current ? { ...current, ...patch } : current);
  };

  const handleSave = async () => {
    if (!patientId) {
      toast(lang === 'th' ? 'เลือกผู้ป่วยก่อน' : 'Select a patient first');
      return;
    }
    if (!plan?.items.length) {
      toast(t('planEmpty'));
      return;
    }
    try {
      await savePlanFull(patientId, plan);
      const name = patients.find((patient) => patient.id === patientId)?.name || '';
      toast(t('planSaved', { name }));
    } catch {
      toast(lang === 'th' ? 'บันทึกขึ้นคลาวด์ไม่สำเร็จ' : 'Cloud save failed');
    }
  };

  if (!ready) return null;

  return (
    <>
      <style>{PLAN_CSS}</style>
      <Topbar
        lang={lang}
        patients={patients}
        patientId={patientId}
        onPatientChange={handlePatientChange}
        onAddPatient={handleAddPatient}
        onSave={handleSave}
      />
      {!plan ? (
        <LoadingPlan lang={lang} />
      ) : (
        <div className="plan-main">
          <div className="col gap16">
            <PickerCard plan={plan} onToggle={handleToggleExercise} />
            <DosageCard
              plan={plan}
              refs={refs}
              lang={lang}
              onToggle={handleToggleExercise}
              onUpdateItem={handleUpdateItem}
            />
          </div>
          <div className="col gap16">
            <ScheduleCard plan={plan} lang={lang} onPatch={handlePatchPlan} />
            <NotesCard plan={plan} lang={lang} onPatch={handlePatchPlan} />
            <SummaryCard plan={plan} lang={lang} onSave={handleSave} />
          </div>
        </div>
      )}
    </>
  );
}
