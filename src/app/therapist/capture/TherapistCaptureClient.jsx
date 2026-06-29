'use client';

import { useEffect } from 'react';
import { mountTherapistCapture } from './captureController.js';

const CAPTURE_CSS = "  .cap-main { display: grid; grid-template-columns: 1fr 380px; gap: 20px; padding: 20px 24px; align-items: start; max-width: 1280px; margin: 0 auto; }\n  .video-card { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }\n  .video-frame { position: relative; aspect-ratio: 16/10; background: var(--surface3); overflow: hidden; }\n  .video-frame video, .video-frame canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }\n  .video-frame canvas { pointer-events: none; }\n  .video-frame.previewing video { opacity: 0; }\n  .video-frame.previewing canvas { transform: none; }\n  .video-frame.previewing .video-hud { display: none; }\n  .video-hud { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; pointer-events: none; }\n  .clip-player { position: absolute; left: 16px; right: 16px; bottom: 16px; z-index: 5; display: grid; gap: 9px; padding: 13px; border: 1px solid rgba(255,255,255,.66); border-radius: 14px; background: rgba(251,250,245,.88); box-shadow: var(--shadow-sm); backdrop-filter: blur(14px); }\n  .clip-player.hidden { display: none; }\n  .clip-player-head, .clip-player-controls, .clip-marker-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n  .clip-player-head { justify-content: space-between; }\n  .clip-player input[type=\"range\"] { width: 100%; accent-color: var(--brand); }\n  .clip-player .mini { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 999px; padding: 7px 10px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }\n  .clip-player .mini.primary { background: var(--brand); border-color: var(--brand); color: #FBFAF5; }\n  .clip-player .mono { font-size: 12px; color: var(--ink2); }\n  .video-actions { display: flex; align-items: center; gap: 10px; padding: 14px; border-top: 1px solid var(--line); flex-wrap: wrap; }\n  .mode-toggle { display: inline-flex; padding: 4px; gap: 4px; background: var(--surface2); border-radius: 999px; }\n  .mode-toggle button { border: 0; background: transparent; padding: 7px 14px; border-radius: 999px; color: var(--ink2); font-weight: 600; font-size: 12.5px; cursor: pointer; }\n  .mode-toggle button.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-sm); }\n  .panel { display: flex; flex-direction: column; gap: 14px; }\n  .refprev { width: 100%; aspect-ratio: 16/10; border-radius: 12px; background: var(--surface2); display: none; }\n  @media (max-width: 900px) { .cap-main { grid-template-columns: 1fr; padding: 16px; } }";

export default function TherapistCaptureClient() {
  useEffect(() => {
    document.body.classList.add('web-shell');
    const cleanup = mountTherapistCapture();
    return () => {
      cleanup?.();
      document.body.classList.remove('web-shell');
    };
  }, []);

  return (
    <>
      <style>{CAPTURE_CSS}</style>
      <div id="top" />
      <div id="root" />
      <input id="imgInput" type="file" accept="image/*" style={{ display: 'none' }} />
      <input id="refInput" type="file" accept="application/json" style={{ display: 'none' }} />
    </>
  );
}
