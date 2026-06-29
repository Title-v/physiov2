'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ensureTherapist, getTherapist, logout, isGuest } from '../../../../shared/core/auth-ui.js';
import { fetchPatients, fetchSessions, fetchPlan } from '../../../../shared/core/patients.js';
import { getExercise, exLabel } from '../../../../shared/core/exercises.js';
import { getLang, icon, mountNav, onLangChange, sparkSVG, t } from '../../../../shared/core/ui.js';
import { generateSummary } from '../../../../shared/ai/summary.js';
import { aggregate, sessionTrend, sessionScore } from '../../../../shared/ai/SessionAnalytics.js';
import { clinicalAlerts } from '../../../../shared/ai/ClinicalRuleEngine.js';
import { buildSummaryPrompt, summarize, isConfigured } from '../../../../shared/ai/LlmSummary.js';

const DASHBOARD_CSS = `
  .dash { display: grid; grid-template-columns: 320px 1fr; gap: 20px; padding: 20px 24px; max-width: 1320px; margin: 0 auto; align-items: start; }
  .plist { display: flex; flex-direction: column; gap: 10px; }
  .pcard { text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 13px 14px; cursor: pointer; display: flex; gap: 12px; align-items: center; transition: all .15s; color: inherit; }
  .pcard:hover { box-shadow: var(--shadow-sm); }
  .pcard.active { box-shadow: inset 0 0 0 1.5px var(--brand); }
  .pavatar { width: 40px; height: 40px; border-radius: 12px; background: var(--brand-soft); color: var(--brand-deep); display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .kpi { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 15px 16px; box-shadow: var(--shadow-sm); transition: transform .15s, box-shadow .15s; }
  .kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
  .kpi .eyebrow { padding-right: 38px; }
  .kpi .v { font-size: 24px; font-weight: 700; font-family: var(--mono); margin-top: 4px; color: var(--ink); }
  .kpi .kpi-ico { position: absolute; top: 13px; right: 13px; width: 30px; height: 30px; border-radius: 9px; background: var(--brand-soft); color: var(--brand-deep); display: flex; align-items: center; justify-content: center; }
  .chart { display: flex; align-items: flex-end; gap: 10px; height: 150px; padding-top: 10px; }
  .chart .bar { flex: 1; background: linear-gradient(180deg, var(--brand), var(--brand-deep)); border-radius: 8px 8px 0 0; position: relative; min-height: 6px; transition: height .4s, opacity .2s, filter .15s; }
  .chart .bar:hover { filter: brightness(1.06); }
  .dash .kpi, .dash > div > .card { animation: px-fade-in .4s cubic-bezier(.2,.7,.3,1) both; }
  .kpis .kpi:nth-child(2) { animation-delay: .04s; }
  .kpis .kpi:nth-child(3) { animation-delay: .08s; }
  .kpis .kpi:nth-child(4) { animation-delay: .12s; }
  .chart .bar b { position: absolute; top: -18px; left: 0; right: 0; text-align: center; font-size: 11px; font-family: var(--mono); color: var(--ink2); }
  .chart .bar span { position: absolute; bottom: -20px; left: 0; right: 0; text-align: center; font-size: 11px; color: var(--ink3); }
  .filter-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0 12px; }
  .score-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .score-card { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: var(--surface); min-height: 76px; }
  .score-card .value { font-family: var(--mono); font-size: 22px; font-weight: 700; margin-top: 6px; }
  .metric-row { margin-top: 10px; }
  .metric-row .meta { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--ink2); margin-bottom: 5px; }
  .metric-track { height: 8px; border-radius: 4px; overflow: hidden; background: var(--surface3); }
  .metric-fill { height: 100%; border-radius: 4px; background: var(--brand); }
  .issue-list { display: grid; gap: 7px; margin-top: 10px; }
  .issue-item { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; color: var(--ink); }
  .issue-num { width: 21px; height: 21px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--brand-soft); color: var(--brand-deep); font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .data tr.active td { background: var(--brand-soft); }
  .data tbody tr { cursor: pointer; }
  @media (max-width: 980px) { .dash { grid-template-columns: 1fr; } .plist { flex-direction: row; overflow-x: auto; } .pcard { min-width: 220px; } .kpis { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 680px) { .score-cards { grid-template-columns: 1fr; } .kpis { grid-template-columns: 1fr; } }
`;

function Markup({ html, as: Tag = 'span', className, style }) {
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Icon({ name, options }) {
  return <Markup html={icon(name, options)} />;
}

function buildModel(patient, sessions, plan) {
  const list = (sessions || []).slice().sort((a, b) => b.endedAt - a.endedAt);
  const scores = list.map(sessionScore).filter((n) => Number.isFinite(n));
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : (patient.avgScore ?? 0);
  const lastMs = list.length ? list[0].endedAt : null;
  const lastSeenMin = lastMs != null
    ? Math.max(0, Math.round((Date.now() - lastMs) / 60000))
    : (patient.lastSeenMin ?? null);
  const status = lastSeenMin != null ? (lastSeenMin < 5 ? 'live' : 'offline') : (patient.status || 'offline');
  const trend = list.length ? list.slice(0, 7).reverse().map((s) => sessionScore(s) ?? 0) : (patient.trend || []);
  let adherence = patient.adherence ?? 0;
  if (plan && Array.isArray(plan.items) && plan.items.length) {
    const prescribed = (plan.freqPerDay || 1) * (plan.daysPerWeek || 7) * plan.items.length;
    const done = list.filter((s) => (s.kind || 'plan') !== 'extra' && Date.now() - s.endedAt < 7 * 86400000).length;
    adherence = prescribed ? Math.min(100, Math.round((done / prescribed) * 100)) : 0;
  }
  const condition = patient.condition || patient.email || '';
  return {
    id: patient.id,
    name: patient.name,
    email: patient.email,
    condition,
    condTh: patient.condTh || condition,
    sessions: list,
    avgScore,
    adherence,
    trend,
    status,
    lastSeenMin,
  };
}

function sessionKey(session) {
  return session?.id || `${session?.endedAt || 0}:${session?.exerciseId || ''}:${session?.source || ''}`;
}

function toneFor(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'glass';
  return n >= 75 ? 'good' : n >= 50 ? 'warn' : 'bad';
}

function scoreText(score) {
  return Number.isFinite(Number(score)) ? `${Math.round(Number(score))}%` : '-';
}

function exerciseName(exercise) {
  return exLabel(exercise, t);
}

function lastSeenText(min) {
  if (min === 0) return t('live');
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

function issueLabels(lang) {
  return {
    tempo: lang === 'th' ? 'ทำช้าลงและคุมจังหวะให้สม่ำเสมอ' : 'Slow down and keep tempo steady',
    smoothness: lang === 'th' ? 'ลดการกระตุกระหว่างเคลื่อนไหว' : 'Reduce jerky movement during transitions',
    path: lang === 'th' ? 'รักษาแนวการเคลื่อนไหว' : 'Keep the movement on path',
    sync: lang === 'th' ? 'ขยับสองข้างให้พร้อมกัน' : 'Move both sides evenly',
    sequence: lang === 'th' ? 'ทำตามลำดับซ้าย/ขวาที่กำหนด' : 'Follow the required left/right sequence',
    inactiveSide: lang === 'th' ? 'คุมอีกข้างให้อยู่ใกล้ท่าพัก' : 'Keep the inactive side near rest',
    tracking: lang === 'th' ? 'ให้เห็นข้อต่อสำคัญชัดขึ้น' : 'Keep the key joints clearly visible',
    boundary: lang === 'th' ? 'อยู่ในกรอบตลอดทั้งครั้ง' : 'Stay inside the boundary for the whole rep',
    pose: lang === 'th' ? 'จัดท่าให้ใกล้ reference มากขึ้น' : 'Match the reference pose more closely',
    motion: lang === 'th' ? 'ควบคุม motion ให้ต่อเนื่องขึ้น' : 'Control the motion more smoothly',
  };
}

function topIssuesForSession(session, lang) {
  const labels = issueLabels(lang);
  const sorted = Object.entries(session?.motionIssueCounts || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!sorted.length) {
    return [lang === 'th' ? 'ไม่มีปัญหาหลักในเซสชันนี้' : 'No major issues detected in this session'];
  }
  return sorted.map(([key]) => labels[key] || key);
}

function Kpi({ label, value, sub, ico }) {
  return (
    <div className="kpi">
      {ico ? (
        <div className="kpi-ico">
          <Icon name={ico} options={{ size: 16 }} />
        </div>
      ) : null}
      <div className="eyebrow">{label}</div>
      <div className="v">{value}</div>
      {sub ? <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>{sub}</div> : null}
    </div>
  );
}

function ScoreCard({ label, score }) {
  const tone = toneFor(score);
  const color = tone === 'good'
    ? 'var(--good)'
    : tone === 'warn'
      ? 'var(--warn)'
      : tone === 'bad'
        ? 'var(--bad)'
        : 'var(--ink3)';
  return (
    <div className="score-card">
      <div className="eyebrow">{label}</div>
      <div className="value" style={{ color }}>{scoreText(score)}</div>
    </div>
  );
}

function MetricRow({ label, score }) {
  const n = Number.isFinite(Number(score)) ? Math.round(Number(score)) : null;
  const tone = toneFor(n);
  const color = tone === 'good'
    ? 'var(--good)'
    : tone === 'warn'
      ? 'var(--warn)'
      : tone === 'bad'
        ? 'var(--bad)'
        : 'var(--ink3)';
  return (
    <div className="metric-row">
      <div className="meta">
        <span>{label}</span>
        <span>{scoreText(n)}</span>
      </div>
      <div className="metric-track">
        <div
          className="metric-fill"
          style={{ width: `${Math.max(0, Math.min(100, n || 0))}%`, background: color }}
        />
      </div>
    </div>
  );
}

function Topbar({ lang }) {
  const me = getTherapist();
  const whoName = me?.name || (isGuest() ? 'Guest' : (lang === 'th' ? 'นักกายภาพ' : 'Therapist'));
  const signOutTitle = isGuest()
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
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{t('dashTitle')}</div>
        </div>
      </div>
      <div className="row gap10">
        <a className="btn ghost" href="/therapist">
          <Icon name="cam" options={{ size: 16 }} /> {t('captureTitle')}
        </a>
        <button
          type="button"
          className="btn ghost"
          title={signOutTitle}
          onClick={() => {
            logout();
            location.reload();
          }}
        >
          {whoName}
        </button>
        <div className="pill good">
          <span className="dot" style={{ background: 'var(--good)' }} />
          {t('onDeviceActive')}
        </div>
      </div>
    </div>
  );
}

function PatientList({ patients, selected, onSelect }) {
  const lang = getLang();
  return (
    <div className="plist">
      <div className="eyebrow" style={{ padding: '2px' }}>
        {t('patients')} · {patients.length}
      </div>
      {patients.map((patient) => (
        <button
          type="button"
          key={patient.id}
          className={`pcard${patient.id === selected ? ' active' : ''}`}
          onClick={() => onSelect(patient.id)}
        >
          <div className="pavatar">
            {(patient.name || '?').split(' ').map((word) => word[0]).join('').slice(0, 2)}
          </div>
          <div className="grow">
            <div className="row between">
              <b style={{ fontSize: '14.5px' }}>{patient.name}</b>
              {patient.status === 'live' ? (
                <span className="pill good sm">
                  <span className="live-dot" style={{ '--bad': 'var(--good)' }} />
                  {t('live')}
                </span>
              ) : (
                <span className="muted" style={{ fontSize: '11px' }}>
                  {t('lastSeen')} {patient.lastSeenMin == null ? '-' : lastSeenText(patient.lastSeenMin, lang)}
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>
              {lang === 'th' ? patient.condTh : patient.condition}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ExerciseFilter({ sessions, selectedExercise, onSelect, lang }) {
  const ids = [...new Set((sessions || []).map((session) => session.exerciseId).filter(Boolean))];
  return (
    <div className="filter-row">
      <span className="eyebrow">{lang === 'th' ? 'กรองตามท่า' : 'Exercise filter'}</span>
      <button
        type="button"
        className={`pill sm${selectedExercise === 'all' ? ' brand' : ''}`}
        onClick={() => onSelect('all')}
      >
        {lang === 'th' ? 'ทุกท่า' : 'All'}
      </button>
      {ids.map((id) => {
        const ex = getExercise(id);
        return (
          <button
            type="button"
            key={id}
            className={`pill sm${selectedExercise === id ? ' brand' : ''}`}
            onClick={() => onSelect(id)}
          >
            {exerciseName(ex)}
          </button>
        );
      })}
    </div>
  );
}

function SessionDetailCard({ session, lang }) {
  if (!session) {
    return (
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: '8px' }}>
          {lang === 'th' ? 'รายละเอียดเซสชัน' : 'Session detail'}
        </div>
        <div className="muted">{t('noSessions')}</div>
      </div>
    );
  }
  const ex = getExercise(session.exerciseId);
  const overall = session.overallScore ?? session.avgScore;
  const pose = session.avgPoseScore ?? session.avgScore;
  const motion = session.avgMotionScore;
  const date = new Date(session.endedAt);
  const issues = topIssuesForSession(session, lang);
  return (
    <div className="card">
      <div className="row between wrap gap8" style={{ marginBottom: '10px' }}>
        <div>
          <div className="eyebrow">{lang === 'th' ? 'รายละเอียดเซสชัน' : 'Session detail'}</div>
          <div className="h2" style={{ marginTop: '2px' }}>{exerciseName(ex)}</div>
        </div>
        <span className="pill sm glass">
          {date.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <div className="score-cards">
        <ScoreCard label={lang === 'th' ? 'รวม' : 'Overall'} score={overall} />
        <ScoreCard label={lang === 'th' ? 'ท่าทาง' : 'Pose'} score={pose} />
        <ScoreCard label="Motion" score={motion} />
      </div>
      <div style={{ marginTop: '12px' }}>
        <MetricRow label={lang === 'th' ? 'จังหวะ' : 'Tempo'} score={session.avgTempoScore} />
        <MetricRow label={lang === 'th' ? 'ความลื่นไหล' : 'Smoothness'} score={session.avgSmoothnessScore} />
        <MetricRow label={lang === 'th' ? 'แนวการเคลื่อนไหว' : 'Path'} score={session.avgPathScore} />
        <MetricRow label={lang === 'th' ? 'ความพร้อมกัน' : 'Sync'} score={session.avgSyncScore} />
      </div>
      <div className="row gap8 wrap" style={{ marginTop: '12px' }}>
        <span className="pill sm good">{session.validReps ?? session.reps ?? 0} {t('reps')}</span>
        <span className={`pill sm ${(session.invalidRepCount || 0) ? 'bad' : 'glass'}`}>
          {session.invalidRepCount || 0} {lang === 'th' ? 'ไม่ผ่าน' : 'invalid'}
        </span>
        <span className="pill sm glass">{session.durationSec || 0}s</span>
      </div>
      <div className="issue-list">
        {issues.map((text, index) => (
          <div className="issue-item" key={`${text}-${index}`}>
            <span className="issue-num">{index + 1}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendCard({ selectedExercise, trend, patient, viewSessions, lang }) {
  const useReal = trend.scores.length > 0;
  const series = useReal ? trend.scores : patient.trend;
  const movingAverage = useReal ? trend.movavg : patient.trend;
  const trendMax = Math.max(...series, 100);
  const weekdays = ['weekday_mon', 'weekday_tue', 'weekday_wed', 'weekday_thu', 'weekday_fri', 'weekday_sat', 'weekday_sun'];
  const recentAsc = viewSessions.slice(0, 7).reverse();
  const barLabel = (index) => {
    if (useReal && recentAsc[index]) {
      const date = new Date(recentAsc[index].endedAt);
      return date.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US', { month: 'numeric', day: 'numeric' });
    }
    return t(weekdays[index] || 'today');
  };
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: '6px' }}>
        <div className="eyebrow">
          {t('formTrend')}
          {selectedExercise === 'all' ? '' : ` · ${exerciseName(getExercise(selectedExercise))}`}
          {useReal ? '' : ' · seed'}
        </div>
        <div className="row gap8" style={{ alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: '11px' }}>{t('movingAvg')}</span>
          <Markup html={sparkSVG(movingAverage, { width: 80, height: 22 })} />
        </div>
      </div>
      <div className="chart">
        {series.map((value, index) => (
          <div
            className="bar"
            key={`${value}-${index}`}
            style={{
              height: `${(value / trendMax) * 100}%`,
              opacity: index === series.length - 1 ? 1 : 0.4,
            }}
          >
            <b>{Math.round(value)}</b>
            <span>{barLabel(index)}</span>
          </div>
        ))}
      </div>
      <div style={{ height: '14px' }} />
    </div>
  );
}

function AlertsCard({ patient, sessions, lang }) {
  const alerts = clinicalAlerts(patient, sessions, lang);
  const alertTone = (severity) => (severity === 'high' ? 'bad' : severity === 'med' ? 'warn' : 'good');
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: '8px' }}>{t('alerts')}</div>
      {alerts.length ? (
        <div className="col gap8">
          {alerts.map((alert) => (
            <div className="row gap8" style={{ alignItems: 'center' }} key={`${alert.code}-${alert.text}`}>
              <span className={`pill sm ${alertTone(alert.severity)}`}>{alert.severity.toUpperCase()}</span>
              <div style={{ fontSize: '13.5px' }}>{alert.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted" style={{ padding: '4px 0' }}>{t('noAlerts')}</div>
      )}
    </div>
  );
}

function SummaryCard({ patient, sessions, lang }) {
  const [version, setVersion] = useState(0);
  const [summary, setSummary] = useState(() => generateSummary(patient, sessions, lang));
  const [source, setSource] = useState(isConfigured() ? 'srcCloud' : 'srcOnDevice');

  useEffect(() => {
    const template = generateSummary(patient, sessions, lang);
    setSummary(template);
    setSource(isConfigured() ? 'srcCloud' : 'srcOnDevice');
    if (!isConfigured()) return undefined;
    const controller = new AbortController();
    summarize(buildSummaryPrompt(patient, sessions, lang), { signal: controller.signal }).then((text) => {
      if (text) {
        setSummary(text);
        setSource('srcCloud');
      } else {
        setSource('srcOnDevice');
      }
    });
    return () => controller.abort();
  }, [patient, sessions, lang, version]);

  return (
    <div className="card" style={{ background: 'linear-gradient(180deg, var(--surface), var(--surface2))' }}>
      <div className="row between" style={{ marginBottom: '10px' }}>
        <div className="row gap8">
          <span className="logo-mark" style={{ width: '28px', height: '28px' }}>
            <Icon name="spark" options={{ size: 15, color: '#F5F1EA' }} />
          </span>
          <b>{t('aiSummary')}</b>
        </div>
        <div className="row gap8" style={{ alignItems: 'center' }}>
          <span className="pill sm glass">{t('summarySrc')}: {t(source)}</span>
          <button
            type="button"
            className="btn ghost"
            style={{ height: '34px' }}
            onClick={() => setVersion((n) => n + 1)}
          >
            <Icon name="refresh" options={{ size: 14 }} /> {t('regenerate')}
          </button>
        </div>
      </div>
      <div style={{ fontSize: '14.5px', lineHeight: 1.55 }}>{summary}</div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '10px', fontStyle: 'italic' }}>
        {t('summaryNote')}
      </div>
    </div>
  );
}

function SessionsCard({
  sessions,
  filterSessions,
  selectedExercise,
  selectedSessionKey,
  onSelectExercise,
  onSelectSession,
  lang,
}) {
  const rows = sessions.slice(0, 8).map((session) => {
    const ex = getExercise(session.exerciseId);
    const score = session.overallScore ?? session.avgScore;
    const tone = toneFor(score);
    const motion = session.avgMotionScore;
    const date = new Date(session.endedAt);
    return (
      <tr
        key={sessionKey(session)}
        className={sessionKey(session) === selectedSessionKey ? 'active' : ''}
        onClick={() => onSelectSession(sessionKey(session))}
      >
        <td>{exerciseName(ex)}</td>
        <td>{session.reps} {t('reps')} · {session.sets} {t('sets')}</td>
        <td>{session.durationSec}s</td>
        <td><span className={`pill ${tone} sm`}>{scoreText(score)}</span></td>
        <td><span className={`pill ${toneFor(motion)} sm`}>{scoreText(motion)}</span></td>
        <td><span className={`pill ${(session.invalidRepCount || 0) ? 'bad' : 'glass'} sm`}>{session.invalidRepCount || 0}</span></td>
        <td className="muted">
          <span>
            {date.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US', { month: 'short', day: 'numeric' })}
          </span>
          {session.source !== 'seed' ? (
            <span className="dot" style={{ background: 'var(--brand)', marginLeft: '7px' }} title="new" />
          ) : null}
        </td>
      </tr>
    );
  });
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: '8px' }}>{t('recentSessions')}</div>
      <ExerciseFilter
        sessions={filterSessions}
        selectedExercise={selectedExercise}
        onSelect={onSelectExercise}
        lang={lang}
      />
      {sessions.length ? (
        <table className="data">
          <thead>
            <tr>
              <th>{t('exercise')}</th>
              <th>{t('reps')}</th>
              <th>{t('hold')}</th>
              <th>{t('score')}</th>
              <th>Motion</th>
              <th>{lang === 'th' ? 'ไม่ผ่าน' : 'Invalid'}</th>
              <th>{t('today')}</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      ) : (
        <div className="muted" style={{ padding: '12px 0' }}>{t('noSessions')}</div>
      )}
    </div>
  );
}

function DashboardMain({
  patients,
  selected,
  selectedExercise,
  selectedSessionKey,
  onSelectExercise,
  onSelectSession,
  lang,
}) {
  const patient = patients.find((item) => item.id === selected) || patients[0];
  const sessions = patient.sessions || [];
  const exerciseIds = new Set(sessions.map((session) => session.exerciseId).filter(Boolean));
  const activeExercise = selectedExercise !== 'all' && exerciseIds.has(selectedExercise) ? selectedExercise : 'all';
  const viewSessions = activeExercise === 'all'
    ? sessions
    : sessions.filter((session) => session.exerciseId === activeExercise);
  const selectedSession = viewSessions.find((session) => sessionKey(session) === selectedSessionKey) || viewSessions[0] || null;
  const activeSessionKey = selectedSession ? sessionKey(selectedSession) : selectedSessionKey;
  const allSessions = patients.flatMap((item) => item.sessions);
  const agg = aggregate(viewSessions);
  const trend = sessionTrend(viewSessions, 7);
  const activeLive = patients.filter((item) => item.status === 'live').length;
  const weekCount = allSessions.filter((session) => Date.now() - session.endedAt < 7 * 86400000).length;
  const avgAdh = patients.length
    ? Math.round(patients.reduce((sum, item) => sum + (item.adherence || 0), 0) / patients.length)
    : 0;
  const avgScore = agg.sessionCount ? agg.avgScore : patient.avgScore;

  return (
    <div className="col gap16">
      <div className="row between wrap gap10">
        <div>
          <div className="h2">{patient.name}</div>
          <div className="muted">{lang === 'th' ? patient.condTh : patient.condition}</div>
        </div>
        <div className="row gap8">
          <button type="button" className="btn ghost">
            <Icon name="message" options={{ size: 16 }} /> {t('message')}
          </button>
          <a className="btn primary" href="/therapist">
            <Icon name="cam" options={{ size: 16, color: '#FBFAF5' }} /> {t('review')}
          </a>
        </div>
      </div>
      <div className="kpis">
        <Kpi label={t('activePatients')} value={patients.length} sub={`${activeLive} ${t('live')}`} ico="users" />
        <Kpi label={t('avgScore')} value={avgScore} sub={`${t('adherence')} ${patient.adherence}%`} ico="spark" />
        <Kpi
          label={t('sessionsWeek')}
          value={weekCount}
          sub={activeExercise === 'all' ? '' : exerciseName(getExercise(activeExercise))}
          ico="cal"
        />
        <Kpi label={t('adherence')} value={`${avgAdh}%`} sub={lang === 'th' ? 'เฉลี่ยทุกคน' : 'all patients'} ico="flame" />
      </div>
      <TrendCard
        selectedExercise={activeExercise}
        trend={trend}
        patient={patient}
        viewSessions={viewSessions}
        lang={lang}
      />
      <SessionDetailCard session={selectedSession} lang={lang} />
      <AlertsCard patient={patient} sessions={sessions} lang={lang} />
      <SummaryCard patient={patient} sessions={sessions} lang={lang} />
      <SessionsCard
        sessions={viewSessions}
        filterSessions={sessions}
        selectedExercise={activeExercise}
        selectedSessionKey={activeSessionKey}
        onSelectExercise={onSelectExercise}
        onSelectSession={onSelectSession}
        lang={lang}
      />
    </div>
  );
}

function EmptyState({ loading, loadError, lang }) {
  return (
    <div className="dash">
      <div />
      <div className="card" style={{ padding: '28px', textAlign: 'center' }}>
        <div className="muted">
          {loading
            ? (lang === 'th' ? 'กำลังโหลดข้อมูลผู้ป่วย...' : 'Loading patients...')
            : loadError
              ? (lang === 'th' ? 'โหลดข้อมูลผู้ป่วยไม่สำเร็จ' : 'Could not load patient data')
              : (lang === 'th' ? 'ยังไม่มีผู้ป่วยลงทะเบียน' : 'No patients registered yet')}
        </div>
      </div>
    </div>
  );
}

export default function TherapistDashboardClient() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState('en');
  const [patientsModel, setPatientsModel] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedExercise, setSelectedExercise] = useState('all');
  const [selectedSessionKey, setSelectedSessionKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const roster = await fetchPatients();
      const models = await Promise.all(roster.map(async (patient) => {
        const [sessions, plan] = await Promise.all([fetchSessions(patient.id), fetchPlan(patient.id)]);
        return buildModel(patient, sessions, plan);
      }));
      setPatientsModel(models);
      setLoadError(null);
      setSelected((current) => (current && models.some((model) => model.id === current)
        ? current
        : (models[0]?.id || null)));
    } catch (error) {
      setLoadError(error);
      setPatientsModel([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    document.body.classList.add('web-shell');
    setLang(getLang());
    const unsubscribe = onLangChange((nextLang) => {
      if (mounted) setLang(nextLang);
    });

    ensureTherapist().then(() => {
      if (!mounted) return;
      setReady(true);
      loadData();
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
      document.body.classList.remove('web-shell');
      document.querySelectorAll('.nav, .nav-back').forEach((node) => node.remove());
    };
  }, [loadData]);

  useEffect(() => {
    if (!ready) return;
    mountNav('therapist/dashboard');
  }, [ready, lang]);

  const selectedPatient = useMemo(
    () => patientsModel.find((patient) => patient.id === selected) || patientsModel[0] || null,
    [patientsModel, selected],
  );

  useEffect(() => {
    if (!selectedPatient) return;
    const ids = new Set((selectedPatient.sessions || []).map((session) => session.exerciseId).filter(Boolean));
    if (selectedExercise !== 'all' && !ids.has(selectedExercise)) {
      setSelectedExercise('all');
      setSelectedSessionKey(null);
    }
  }, [selectedExercise, selectedPatient]);

  if (!ready) return null;

  const handleSelectPatient = (id) => {
    setSelected(id);
    setSelectedExercise('all');
    setSelectedSessionKey(null);
  };
  const handleSelectExercise = (id) => {
    setSelectedExercise(id);
    setSelectedSessionKey(null);
  };

  return (
    <>
      <style>{DASHBOARD_CSS}</style>
      <Topbar lang={lang} />
      {!patientsModel.length ? (
        <EmptyState loading={loading} loadError={loadError} lang={lang} />
      ) : (
        <div className="dash">
          <PatientList patients={patientsModel} selected={selected} onSelect={handleSelectPatient} />
          <DashboardMain
            patients={patientsModel}
            selected={selected}
            selectedExercise={selectedExercise}
            selectedSessionKey={selectedSessionKey}
            onSelectExercise={handleSelectExercise}
            onSelectSession={setSelectedSessionKey}
            lang={lang}
          />
        </div>
      )}
    </>
  );
}
