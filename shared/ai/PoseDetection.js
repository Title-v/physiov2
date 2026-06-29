// PhysioAI · Version-1 — BlazePose · Pose Detection (diagram node P1.2 / P2.2).
//
// Pre-trained AI (Google MediaPipe / BlazePose), on-device. Wraps the vendored
// MediaPipe PoseLandmarker: model + WASM are vendored under ./vendor and ./models
// so detection runs fully offline after first load (CDN URLs are a fallback).
//
// Output: 33 landmarks { x, y, z, visibility }. Also owns the landmark schema
// (LANDMARK_NAMES / idx), the camera helpers, and the skeleton drawer, since all
// are tied to the detector's output format.

import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from '../vendor/vision_bundle.mjs';
import { LANDMARK_NAMES, idx } from './Landmarks.js';

export { DrawingUtils, PoseLandmarker };
export { LANDMARK_NAMES, idx };

const SHARED_PUBLIC_BASE = globalThis.PHYSIOAI_SHARED_BASE || '/shared';
const MODEL_LOCAL = {
  lite: `${SHARED_PUBLIC_BASE}/models/pose_landmarker_lite.task`,
  full: `${SHARED_PUBLIC_BASE}/models/pose_landmarker_full.task`,
  heavy: `${SHARED_PUBLIC_BASE}/models/pose_landmarker_full.task`, // heavy not vendored → full
};
const MODEL_CDN = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};
const WASM_LOCAL = `${SHARED_PUBLIC_BASE}/vendor/wasm`;
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// ─── MediaPipe engine wrapper ───────────────────────────────
export function createPoseEngine() {
  const state = {
    video: null, image: null, ready: false, variant: 'full',
    delegate: 'GPU', usingCdn: false, lastVideoTime: -1, error: null,
  };

  async function makeFileset() {
    try { return await FilesetResolver.forVisionTasks(WASM_LOCAL); }
    catch (e) {
      state.usingCdn = true;
      return await FilesetResolver.forVisionTasks(WASM_CDN);
    }
  }

  async function create(fileset, variant, runningMode, delegate) {
    const modelAssetPath = state.usingCdn ? MODEL_CDN[variant] : MODEL_LOCAL[variant];
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate },
      runningMode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async function init(variant = 'full') {
    state.variant = variant;
    const fileset = await makeFileset();
    try {
      state.video = await create(fileset, variant, 'VIDEO', 'GPU');
      state.delegate = 'GPU';
    } catch (e) {
      // GPU delegate can fail on some browsers → retry on CPU.
      state.video = await create(fileset, variant, 'VIDEO', 'CPU');
      state.delegate = 'CPU';
    }
    state.ready = true;
    return { delegate: state.delegate, usingCdn: state.usingCdn };
  }

  function detectVideo(videoEl, ts) {
    if (!state.video) return null;
    return state.video.detectForVideo(videoEl, ts);
  }

  async function detectImage(imgEl) {
    const fileset = await makeFileset();
    const lm = await create(fileset, state.variant, 'IMAGE', state.delegate);
    const res = lm.detect(imgEl);
    lm.close();
    return res;
  }

  function close() {
    try { state.video?.close(); } catch {}
    state.video = null; state.ready = false;
  }

  return { init, detectVideo, detectImage, close, state };
}

// ─── Camera helper ──────────────────────────────────────────
export async function startCamera(videoEl, { facingMode = 'user' } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode },
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise((res) => videoEl.addEventListener('loadeddata', res, { once: true }));
  await videoEl.play().catch(() => {});
  return stream;
}
export function stopCamera(videoEl) {
  const tracks = videoEl?.srcObject?.getTracks?.() ?? [];
  tracks.forEach((t) => t.stop());
  if (videoEl) videoEl.srcObject = null;
}

// ─── Skeleton overlay (canvas) ──────────────────────────────
export function makeDrawer(ctx) {
  const du = new DrawingUtils(ctx);
  return function draw(landmarks, { color = '#2F5D50', accent = '#7BA88F', ghost = false } = {}) {
    du.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: ghost ? 'rgba(127,168,118,0.30)' : color, lineWidth: ghost ? 4 : 5,
    });
    du.drawLandmarks(landmarks, {
      color: ghost ? 'rgba(127,168,118,0.45)' : accent, radius: ghost ? 3 : 4.5,
    });
  };
}
