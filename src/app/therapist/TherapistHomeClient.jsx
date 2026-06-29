'use client';

import { useEffect, useState } from 'react';
import { ensureTherapist, getTherapist, logout, isGuest } from '../../../shared/core/auth-ui.js';
import { getLang, icon, mountNav, onLangChange, t } from '../../../shared/core/ui.js';

function Markup({ html }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Logo() {
  return (
    <div
      dangerouslySetInnerHTML={{
        __html:
          '<svg width="180" height="132" viewBox="0 0 340 250" role="img" aria-label="PhysioAI">' +
          '<g transform="translate(106 0) scale(2)">' +
          '<path d="M 19 46 L 47 40 L 37 14" stroke="#2F5D50" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>' +
          '<circle cx="19" cy="46" r="8" fill="#7BA88F"></circle></g>' +
          '<text x="170" y="228" text-anchor="middle" font-family="Gabarito, sans-serif" font-weight="700" font-size="54" letter-spacing="0" fill="#25342E">Physio<tspan fill="#2F5D50">AI</tspan></text>' +
          '</svg>',
      }}
    />
  );
}

function ToolCard({ tool, index, lang }) {
  return (
    <a
      className="tool-card"
      href={tool.href}
      style={{ animationDelay: `${0.05 + index * 0.08}s` }}
    >
      <span className="tool-step">{tool.step}</span>
      <div className="tool-icon">
        <Markup html={icon(tool.icon, { size: 24 })} />
      </div>
      <div className="tool-title">{tool.title}</div>
      <div className="tool-sub">{tool.sub}</div>
      <span className="tool-go">
        {lang === 'th' ? 'เปิด' : 'Open'} <Markup html={icon('arrow_r', { size: 14 })} />
      </span>
    </a>
  );
}

export default function TherapistHomeClient() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState('en');

  useEffect(() => {
    let mounted = true;
    setLang(getLang());
    const unsubscribe = onLangChange(() => {
      if (mounted) setLang(getLang());
    });

    ensureTherapist().then(() => {
      if (mounted) setReady(true);
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
      document.querySelectorAll('.nav, .nav-back').forEach((node) => node.remove());
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    mountNav('');
  }, [ready, lang]);

  if (!ready) return null;

  const tools = [
    {
      href: '/therapist',
      icon: 'cam',
      step: '01',
      title: t('modeCapture'),
      sub: lang === 'th' ? 'บันทึกท่าอ้างอิงสำหรับการให้คะแนน' : 'Capture a reference pose for scoring',
    },
    {
      href: '/therapist/plan',
      icon: 'cal',
      step: '02',
      title: t('modePlan'),
      sub: lang === 'th'
        ? 'สั่งโปรแกรมออกกำลังที่บ้าน - ครั้ง, เซ็ต, ตารางเวลา'
        : 'Prescribe a home program - reps, sets, schedule',
    },
    {
      href: '/therapist/dashboard',
      icon: 'chart',
      step: '03',
      title: t('modeDash'),
      sub: lang === 'th' ? 'ติดตามความสม่ำเสมอและแนวโน้มฟอร์มของผู้ป่วย' : 'Track patient adherence & form trends',
    },
  ];
  const therapistLabel = isGuest()
    ? 'Guest'
    : (getTherapist()?.name || (lang === 'th' ? 'นักกายภาพ' : 'Therapist'));
  const signOutLabel = isGuest()
    ? (lang === 'th' ? 'ออกจากเดโม' : 'Exit demo')
    : (lang === 'th' ? 'ออกจากระบบ' : 'Sign out');

  return (
    <div className="landing">
      <style>{`
        .tool-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
          width: 100%; max-width: 760px; margin-top: 2px;
        }
        .tool-card {
          position: relative; display: flex; flex-direction: column; align-items: flex-start;
          gap: 12px; text-align: left; text-decoration: none; overflow: hidden;
          background: var(--surface); color: var(--ink);
          border: 1px solid var(--line); border-radius: var(--r-lg);
          padding: 22px 20px 18px;
          animation: px-fade-in .5s cubic-bezier(.2,.7,.3,1) both;
          transition: transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s, border-color .18s;
        }
        .tool-card::before {
          content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
          background: linear-gradient(90deg, var(--brand), var(--brand-deep));
          transform: scaleX(0); transform-origin: left; transition: transform .3s ease;
        }
        .tool-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); border-color: var(--line-strong); }
        .tool-card:hover::before { transform: scaleX(1); }
        .tool-icon {
          width: 52px; height: 52px; border-radius: 15px; flex-shrink: 0;
          background: var(--brand-soft); color: var(--brand-deep);
          display: flex; align-items: center; justify-content: center;
          transition: background .18s, color .18s, transform .18s;
        }
        .tool-card:hover .tool-icon { background: var(--brand-deep); color: #F5F1EA; transform: scale(1.04); }
        .tool-step {
          position: absolute; top: 16px; right: 18px;
          font-family: var(--mono); font-size: 12px; font-weight: 600; letter-spacing: .5px; color: var(--ink3);
        }
        .tool-title { font-size: 16px; font-weight: 600; letter-spacing: 0; color: var(--ink); }
        .tool-sub { font-size: 13px; line-height: 1.5; color: var(--ink3); }
        .tool-go {
          margin-top: 2px; display: inline-flex; align-items: center; gap: 6px;
          font-size: 12.5px; font-weight: 600; color: var(--brand-deep);
          opacity: 0; transform: translateX(-4px); transition: opacity .2s, transform .2s;
        }
        .tool-card:hover .tool-go { opacity: 1; transform: none; }
        .home-signout {
          color: var(--brand-deep); font-weight: 600; text-decoration: none; background: none;
          border: 0; padding: 0; font: inherit; cursor: pointer;
        }
        @media (max-width: 720px) {
          .tool-grid { grid-template-columns: 1fr; max-width: 380px; }
        }
      `}</style>
      <Logo />
      <div>
        <h1>{t('landingTitle')}</h1>
        <p>{t('landingSub')}</p>
      </div>
      <div className="tool-grid">
        {tools.map((tool, index) => (
          <ToolCard key={tool.step} tool={tool} index={index} lang={lang} />
        ))}
      </div>
      <div className="hint">{t('navHint')}</div>
      <div className="hint" style={{ marginTop: '6px' }}>
        {therapistLabel} ·{' '}
        <button
          type="button"
          className="home-signout"
          onClick={() => {
            logout();
            location.reload();
          }}
        >
          {signOutLabel}
        </button>
      </div>
    </div>
  );
}
