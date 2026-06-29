import { JOINT_SPECS } from './JointAngleCalculator.js';
import { idx } from './Landmarks.js';

const MIN_VIS = 0.35;

export const ANGLE_OVERLAY_COLORS = ['#2F5D50', '#4F8FD9', '#9C7344', '#8C4F40', '#6B5B95', '#3D7C7A'];

function visiblePoint(landmarks, name) {
  const index = idx(name);
  if (index < 0) return null;
  const p = landmarks?.[index];
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.visibility ?? 1) < MIN_VIS) return null;
  return p;
}

function midpointPoint(landmarks, aName, bName) {
  const a = visiblePoint(landmarks, aName);
  const b = visiblePoint(landmarks, bName);
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function jointPoint(landmarks, name) {
  if (name === 'mid_shoulder') return midpointPoint(landmarks, 'left_shoulder', 'right_shoulder');
  if (name === 'mid_hip') return midpointPoint(landmarks, 'left_hip', 'right_hip');
  if (name === 'mid_knee') return midpointPoint(landmarks, 'left_knee', 'right_knee');
  if (name === 'head_center') return midpointPoint(landmarks, 'left_ear', 'right_ear') || visiblePoint(landmarks, 'nose');
  return visiblePoint(landmarks, name);
}

function fallbackAnglePoint(spec, role, vertex) {
  if (!vertex || role !== 'c') return null;
  if (spec.joint === 'left_shoulder' || spec.joint === 'right_shoulder') {
    return { x: vertex.x, y: vertex.y + 0.25, visibility: 1 };
  }
  return null;
}

function canvasPoint(ctx, p) {
  return { x: p.x * ctx.canvas.width, y: p.y * ctx.canvas.height };
}

function roundedLabelBox(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

export function drawReadableAngleLabel(ctx, text, x, y, { color = '#2F5D50', mirrorText = false } = {}) {
  const baseFontSize = Math.max(18, Math.min(34, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) * 0.038)));
  const fontSize = text.length > 8 ? Math.max(13, Math.round(baseFontSize * 0.72)) : baseFontSize;
  ctx.save();
  ctx.font = `700 ${fontSize}px "Inter Tight", "IBM Plex Sans Thai", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = fontSize * 0.48;
  const padY = fontSize * 0.25;
  const w = Math.ceil(ctx.measureText(text).width + padX * 2);
  const h = Math.ceil(fontSize + padY * 2);
  const cx = Math.max(w / 2 + 8, Math.min(ctx.canvas.width - w / 2 - 8, x));
  const cy = Math.max(h / 2 + 8, Math.min(ctx.canvas.height - h / 2 - 8, y));

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = color + '55';
  ctx.lineWidth = Math.max(1, fontSize * 0.07);
  ctx.beginPath();
  roundedLabelBox(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  if (mirrorText) {
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.fillText(text, 0, 0);
  } else {
    ctx.fillText(text, cx, cy);
  }
  ctx.restore();
}

export function drawAngleOverlayForJoint(
  ctx,
  landmarks,
  liveAngles,
  joint,
  { color = '#2F5D50', includeName = false, lang = 'en', mirrorText = false } = {},
) {
  const spec = JOINT_SPECS.find((s) => s.joint === joint);
  const angle = liveAngles?.[joint];
  if (!spec || !Number.isFinite(angle)) return false;

  const a0 = jointPoint(landmarks, spec.a);
  const b0 = jointPoint(landmarks, spec.b);
  const c0 = jointPoint(landmarks, spec.c) || fallbackAnglePoint(spec, 'c', b0);
  if (!a0 || !b0 || !c0) return false;

  const a = canvasPoint(ctx, a0);
  const b = canvasPoint(ctx, b0);
  const c = canvasPoint(ctx, c0);
  const ab = Math.hypot(a.x - b.x, a.y - b.y);
  const cb = Math.hypot(c.x - b.x, c.y - b.y);
  if (ab < 12 || cb < 12) return false;

  const start = Math.atan2(a.y - b.y, a.x - b.x);
  const rawEnd = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = rawEnd - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const end = start + delta;
  const radius = Math.max(24, Math.min(92, Math.min(ab, cb) * 0.35));
  const mid = start + delta / 2;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.82)';
  ctx.lineWidth = Math.max(8, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.01);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(a.x, a.y);
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(4, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.0065);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(a.x, a.y);
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(9, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.011);
  ctx.beginPath();
  ctx.arc(b.x, b.y, radius, start, end, delta < 0);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(4, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.0065);
  ctx.beginPath();
  ctx.arc(b.x, b.y, radius, start, end, delta < 0);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.86)';
  ctx.lineWidth = Math.max(2, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.003);
  ctx.beginPath();
  ctx.arc(b.x, b.y, Math.max(6, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.009), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const labelX = b.x + Math.cos(mid) * (radius + 40);
  const labelY = b.y + Math.sin(mid) * (radius + 40);
  const label = includeName
    ? `${lang === 'th' ? spec.labelTh : spec.label} ${Math.round(angle)}°`
    : `${Math.round(angle)}°`;
  drawReadableAngleLabel(ctx, label, labelX, labelY, { color, mirrorText });
  return true;
}

export function drawAngleOverlayForJoints(ctx, landmarks, liveAngles, joints, options = {}) {
  const selected = [...new Set((joints || []).filter(Boolean))];
  const includeName = options.includeName ?? selected.length > 1;
  let count = 0;
  selected.forEach((joint, index) => {
    const color = options.colors?.[index % options.colors.length] || ANGLE_OVERLAY_COLORS[index % ANGLE_OVERLAY_COLORS.length];
    if (drawAngleOverlayForJoint(ctx, landmarks, liveAngles, joint, { ...options, color, includeName })) count += 1;
  });
  return count;
}
