import { idx } from '../../shared/ai/Landmarks.js';

export const LANDMARK_NAMES = [
  'nose',
  'left_eye_inner',
  'left_eye',
  'left_eye_outer',
  'right_eye_inner',
  'right_eye',
  'right_eye_outer',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
];

export function point(x, y, visibility = 0.99) {
  return { x, y, z: 0, visibility };
}

export function setPoint(points, name, x, y, visibility = 0.99) {
  const index = idx(name);
  if (index < 0) throw new Error(`unknown landmark: ${name}`);
  points[index] = point(x, y, visibility);
}

export function makeBasePose({ offsetX = 0, visibility = 0.99 } = {}) {
  const points = Array.from({ length: 33 }, () => point(0.5 + offsetX, 0.5, visibility));
  setPoint(points, 'nose', 0.5 + offsetX, 0.18, visibility);
  setPoint(points, 'left_ear', 0.45 + offsetX, 0.2, visibility);
  setPoint(points, 'right_ear', 0.55 + offsetX, 0.2, visibility);
  setPoint(points, 'left_shoulder', 0.38 + offsetX, 0.36, visibility);
  setPoint(points, 'right_shoulder', 0.62 + offsetX, 0.36, visibility);
  setPoint(points, 'left_elbow', 0.29 + offsetX, 0.5, visibility);
  setPoint(points, 'right_elbow', 0.71 + offsetX, 0.5, visibility);
  setPoint(points, 'left_wrist', 0.25 + offsetX, 0.64, visibility);
  setPoint(points, 'right_wrist', 0.75 + offsetX, 0.64, visibility);
  setPoint(points, 'left_hip', 0.43 + offsetX, 0.62, visibility);
  setPoint(points, 'right_hip', 0.57 + offsetX, 0.62, visibility);
  setPoint(points, 'left_knee', 0.42 + offsetX, 0.78, visibility);
  setPoint(points, 'right_knee', 0.58 + offsetX, 0.78, visibility);
  setPoint(points, 'left_ankle', 0.4 + offsetX, 0.93, visibility);
  setPoint(points, 'right_ankle', 0.6 + offsetX, 0.93, visibility);
  setPoint(points, 'left_foot_index', 0.36 + offsetX, 0.95, visibility);
  setPoint(points, 'right_foot_index', 0.64 + offsetX, 0.95, visibility);
  return points;
}

export function makeElbowPose(deg, { side = 'left', offsetX = 0 } = {}) {
  const points = makeBasePose({ offsetX });
  const shoulder = side === 'left' ? 'left_shoulder' : 'right_shoulder';
  const elbow = side === 'left' ? 'left_elbow' : 'right_elbow';
  const wrist = side === 'left' ? 'left_wrist' : 'right_wrist';
  const elbowX = side === 'left' ? 0.5 + offsetX : 0.62 + offsetX;
  const elbowY = 0.5;
  setPoint(points, shoulder, elbowX - 0.1, elbowY);
  setPoint(points, elbow, elbowX, elbowY);
  const rad = (180 - deg) * Math.PI / 180;
  setPoint(points, wrist, elbowX + Math.cos(rad) * 0.1, elbowY + Math.sin(rad) * 0.1);
  return points;
}

export function makeKneePose(deg, { side = 'right', offsetX = 0 } = {}) {
  const points = makeBasePose({ offsetX });
  const hip = side === 'left' ? 'left_hip' : 'right_hip';
  const knee = side === 'left' ? 'left_knee' : 'right_knee';
  const ankle = side === 'left' ? 'left_ankle' : 'right_ankle';
  const kneeX = side === 'left' ? 0.42 + offsetX : 0.58 + offsetX;
  const kneeY = 0.78;
  setPoint(points, hip, kneeX, kneeY - 0.12);
  setPoint(points, knee, kneeX, kneeY);
  const rad = (90 + deg) * Math.PI / 180;
  setPoint(points, ankle, kneeX + Math.cos(rad) * 0.12, kneeY + Math.sin(rad) * 0.12);
  return points;
}

export function makeMockCanvasContext({ width = 640, height = 480 } = {}) {
  const calls = [];
  const ctx = {
    canvas: { width, height },
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    closePath: () => calls.push(['closePath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    arcTo: (...args) => calls.push(['arcTo', ...args]),
    roundRect: (...args) => calls.push(['roundRect', ...args]),
    stroke: () => calls.push(['stroke']),
    fill: () => calls.push(['fill']),
    fillText: (...args) => calls.push(['fillText', ...args]),
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    measureText: (text) => ({ width: String(text).length * 10 }),
  };
  return ctx;
}
