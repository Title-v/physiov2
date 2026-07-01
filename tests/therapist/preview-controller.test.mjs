import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDatasetJsonlExportForCapture,
  buildDatasetPreviewSequence,
  buildMotionDatasetJsonlFromSkeletonPayload,
  buildMotionDatasetRowFromSkeletonExport,
  buildMotionClipEditorModel,
  buildSkeletonExportPayloadForCapture,
  buildSkeletonParameterPayload,
  clipPreviewIndex,
  createClipPreviewRuntime,
  downloadJsonFile,
  downloadTextFile,
  exportTimestamp,
  datasetFrameLandmarks,
  jumpClipPreviewIndex,
  phaseForClipFrame,
  safeExportId,
  sequenceMarkerLabel,
  setClipPreviewIndexState,
  setSequenceMarkerFromPreviewIndex,
  startClipPlaybackState,
  stepClipPlaybackState,
  stopClipPlaybackState,
} from '../../src/app/therapist/capture/previewController.js';

function sequence() {
  return {
    frames: Array.from({ length: 6 }, (_, index) => ({ t: index * 100 })),
    startIdx: 1,
    targetIdx: 3,
    endIdx: 5,
  };
}

test('clipPreviewIndex uses target fallback and clamps explicit preview frame', () => {
  const seq = sequence();
  const state = { previewFrameIdx: null };

  assert.equal(clipPreviewIndex(state, seq), 3);
  state.previewFrameIdx = 99;
  assert.equal(clipPreviewIndex(state, seq), 5);
  state.previewFrameIdx = -2;
  assert.equal(clipPreviewIndex(state, seq), 1);
});

test('preview marker labels and jumps follow normalized sequence markers', () => {
  const seq = sequence();

  assert.equal(sequenceMarkerLabel(seq, 1, 'en'), 'Start rest');
  assert.equal(sequenceMarkerLabel(seq, 1, 'th'), 'Rest เริ่ม');
  assert.equal(sequenceMarkerLabel(seq, 3, 'en'), 'Target / peak');
  assert.equal(sequenceMarkerLabel(seq, 5, 'th'), 'Rest จบ');
  assert.equal(jumpClipPreviewIndex(seq, 'start'), 1);
  assert.equal(jumpClipPreviewIndex(seq, 'target'), 3);
  assert.equal(jumpClipPreviewIndex(seq, 'end'), 5);
});

test('setClipPreviewIndexState and marker edits keep preview inside selected clip', () => {
  const seq = sequence();
  const state = { previewFrameIdx: null };

  assert.equal(setClipPreviewIndexState(state, seq, 4), 4);
  assert.equal(state.previewFrameIdx, 4);
  const markers = setSequenceMarkerFromPreviewIndex(seq, 'target', 5);
  assert.deepEqual(markers, { startIdx: 1, targetIdx: 4, endIdx: 5 });
});

test('clip playback state starts, advances by frame timestamps, and stops at end', () => {
  const seq = sequence();
  const state = { previewFrameIdx: 5, previewPlaying: false, previewLastAt: 0, previewRaf: 0 };

  assert.equal(startClipPlaybackState(state, seq), true);
  assert.equal(state.previewPlaying, true);
  assert.equal(state.previewFrameIdx, 1);

  const first = stepClipPlaybackState(state, seq, 1000);
  assert.equal(first.active, true);
  assert.equal(first.done, false);
  assert.equal(first.index, 1);

  const next = stepClipPlaybackState(state, seq, 1250);
  assert.equal(next.index, 4);
  assert.equal(next.done, false);

  const done = stepClipPlaybackState(state, seq, 1500);
  assert.equal(done.index, 5);
  assert.equal(done.done, true);
});

test('stopClipPlaybackState clears playback fields and cancels RAF', () => {
  const cancelled = [];
  const state = { previewPlaying: true, previewLastAt: 123, previewRaf: 42 };

  stopClipPlaybackState(state, (id) => cancelled.push(id));

  assert.equal(state.previewPlaying, false);
  assert.equal(state.previewLastAt, 0);
  assert.equal(state.previewRaf, 0);
  assert.deepEqual(cancelled, [42]);
});

test('buildDatasetPreviewSequence converts reviewed rows into playable frame sequences', () => {
  const row = {
    id: 'rep_1',
    exerciseId: 'shoulder',
    motionLabel: 'good',
    labelStatus: 'draft',
    dataQuality: 'usable',
    landmarkSchemaId: 'right_arm.v1',
    frames: [
      { t: 0, phase: 'rest', landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20 }, boundaryStatus: 'inside' },
      { t: 120, phase: 'moving_to_target', landmarks: [{ x: 0.2, y: 0.3, z: 0, visibility: 0.8 }], angles: { right_shoulder: 70 }, boundaryStatus: 'inside' },
      { t: 240, phase: 'target', landmarks: [[0.3, 0.4, 0, 0.9]], angles: { right_shoulder: 120 }, boundaryStatus: 'inside' },
      { t: 360, phase: 'returning', landmarks: [[0.2, 0.3, 0, 0.9]], angles: { right_shoulder: 65 }, boundaryStatus: 'inside' },
    ],
  };
  const sequence = buildDatasetPreviewSequence(row);

  assert.equal(sequence.kind, 'dataset_row');
  assert.equal(sequence.rowId, 'rep_1');
  assert.equal(sequence.startIdx, 0);
  assert.equal(sequence.targetIdx, 2);
  assert.equal(sequence.endIdx, 3);
  assert.deepEqual(sequence.frames[0].landmarks, [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }]);
  assert.deepEqual(sequence.frames[1].jointAngles, { right_shoulder: 70 });
  assert.deepEqual(datasetFrameLandmarks({ landmarks: [[0.4, 0.5, 0, 0.7]] }), [{ x: 0.4, y: 0.5, z: 0, visibility: 0.7 }]);
});

test('buildDatasetPreviewSequence prefers exported clip target marker when present', () => {
  const sequence = buildDatasetPreviewSequence({
    metadata: { clip: { markers: { target: { clipFrameIndex: 1 } } } },
    frames: [
      { t: 0, phase: 'rest', landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20 } },
      { t: 100, phase: 'outbound', landmarks: [[0.2, 0.3, 0, 0.9]], angles: { right_shoulder: 60 } },
      { t: 200, phase: 'target', landmarks: [[0.3, 0.4, 0, 0.9]], angles: { right_shoulder: 120 } },
    ],
  });

  assert.equal(sequence.targetIdx, 1);
});

test('buildMotionClipEditorModel summarizes selected clip timing and labels', () => {
  const seq = sequence();
  const model = buildMotionClipEditorModel(seq, { movementPattern: 'unilateral' }, {
    lang: 'en',
    formatMs: (ms) => `${ms}ms`,
  });

  assert.equal(model.frameCount, 6);
  assert.equal(model.selected, 5);
  assert.equal(model.startIdx, 1);
  assert.equal(model.targetIdx, 3);
  assert.equal(model.endIdx, 5);
  assert.equal(model.targetOffset, 2);
  assert.equal(model.startPct, 20);
  assert.equal(model.targetPct, 60);
  assert.equal(model.endPct, 100);
  assert.equal(model.startLabel, '100ms · #2');
  assert.equal(model.targetLabel, '300ms · #4');
  assert.equal(model.endLabel, '500ms · #6');
  assert.equal(model.selectedLabel, '5 frames · 400ms');
  assert.equal(model.splitLabel, '200ms out · 200ms back');
  assert.match(model.description, /start rest/);
});

test('buildMotionClipEditorModel uses alternating full-cycle copy', () => {
  const model = buildMotionClipEditorModel(sequence(), { movementPattern: 'alternating' }, {
    lang: 'th',
    formatMs: (ms) => `${ms}ms`,
  });

  assert.equal(model.isAlternating, true);
  assert.match(model.description, /rest → ซ้าย → rest → ขวา → rest/);
});

test('buildSkeletonParameterPayload exports selected clip markers phases landmarks and angles', () => {
  assert.equal(phaseForClipFrame(0, 2, 5), 'rest_start');
  assert.equal(phaseForClipFrame(1, 2, 5), 'outbound');
  assert.equal(phaseForClipFrame(2, 2, 5), 'target');
  assert.equal(phaseForClipFrame(3, 2, 5), 'return');
  assert.equal(phaseForClipFrame(4, 2, 5), 'rest_end');

  const seq = {
    frames: Array.from({ length: 6 }, (_, index) => ({
      t: index * 100,
      landmarks: [
        { x: 0.1 + index / 100, y: 0.2, z: 0, visibility: 0.9 },
        { x: 0.3, y: 0.4 + index / 100, z: 0.1, visibility: 0.8 },
      ],
      jointAngles: { right_shoulder: 20 + index * 10 },
    })),
    startIdx: 1,
    targetIdx: 3,
    endIdx: 5,
    angleOverlayJoints: ['right_shoulder'],
  };

  const payload = buildSkeletonParameterPayload({
    sequence: seq,
    exercise: { id: 'shoulder', movementPattern: 'unilateral' },
    selectedRegion: { id: 'right_arm', label: 'Right arm' },
    overlayJoints: seq.angleOverlayJoints,
    selectedJoints: ['right_shoulder', 'right_elbow'],
    fallbackOverlayJoints: ['right_elbow'],
    exerciseLabel: 'Shoulder raise',
    landmarkNames: ['nose', 'neck'],
    poseConnections: [{ start: 0, end: 1 }],
  });

  assert.equal(payload.schema, 'physioai.skeleton_clip.v1');
  assert.equal(payload.exercise.label, 'Shoulder raise');
  assert.deepEqual(payload.exercise.selectedOverlayJoints, ['right_shoulder']);
  assert.deepEqual(payload.exercise.selectedRepJoints, ['right_shoulder', 'right_elbow']);
  assert.equal(payload.clip.originalFrameCount, 6);
  assert.equal(payload.clip.selectedFrameCount, 5);
  assert.equal(payload.clip.durationMs, 400);
  assert.equal(payload.clip.fpsEstimate, 10);
  assert.deepEqual(payload.clip.markers.target, {
    name: 'target',
    absoluteFrameIndex: 3,
    clipFrameIndex: 2,
    tMs: 200,
  });
  assert.deepEqual(payload.skeletonConnections, [{ start: 0, end: 1, startName: 'nose', endName: 'neck' }]);
  assert.equal(payload.frames[0].phase, 'rest_start');
  assert.equal(payload.frames[2].phase, 'target');
  assert.equal(payload.frames[4].phase, 'rest_end');
  assert.equal(payload.frames[0].landmarks[0].name, 'nose');
  assert.equal(payload.frames[0].jointAngles.right_shoulder, 30);
});

test('preview controller converts skeleton payload to Phase 7 dataset JSONL', () => {
  const payload = buildSkeletonParameterPayload({
    sequence: {
      frames: [
        { t: 0, landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }], jointAngles: { right_shoulder: 20 } },
        { t: 100, landmarks: [{ x: 0.2, y: 0.3, z: 0, visibility: 0.8 }], jointAngles: { right_shoulder: 55 } },
        { t: 200, landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }], jointAngles: { right_shoulder: 25 } },
      ],
      startIdx: 0,
      targetIdx: 1,
      endIdx: 2,
    },
    exercise: { id: 'shoulder', movementPattern: 'unilateral' },
    selectedRegion: { id: 'right_arm' },
    selectedJoints: ['right_shoulder'],
    exerciseLabel: 'Shoulder raise',
  });

  const row = buildMotionDatasetRowFromSkeletonExport(payload, {
    label: 'good_rep',
    subjectId: 'anon_test',
  });
  const jsonl = buildMotionDatasetJsonlFromSkeletonPayload(payload, {
    label: 'good_rep',
    subjectId: 'anon_test',
  });
  const parsed = JSON.parse(jsonl.trim());

  assert.equal(row.version, 1);
  assert.equal(row.exerciseId, 'shoulder');
  assert.equal(row.subjectId, 'anon_test');
  assert.equal(row.trainable, false);
  assert.equal(row.repComplete, false);
  assert.equal(row.completionSource, 'debug_skeleton_export');
  assert.deepEqual(row.phaseLabels, ['rest_start', 'target', 'rest_end']);
  assert.equal(parsed.frames.length, 3);
  assert.deepEqual(parsed.frames[1].angles, { right_shoulder: 55 });
});

test('capture export helpers return explicit errors and stable filenames', () => {
  assert.deepEqual(buildSkeletonExportPayloadForCapture({ sequence: null }), {
    error: 'no_motion_clip',
    payload: null,
  });
  assert.deepEqual(buildSkeletonExportPayloadForCapture({ sequence: { frames: [{ t: 0 }] } }), {
    error: 'missing_body_region',
    payload: null,
  });

  const { error, payload } = buildSkeletonExportPayloadForCapture({
    sequence: {
      frames: [
        { t: 0, landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }], jointAngles: { left_elbow: 30 } },
        { t: 100, landmarks: [{ x: 0.2, y: 0.3, z: 0, visibility: 0.8 }], jointAngles: { left_elbow: 90 } },
      ],
      startIdx: 0,
      targetIdx: 1,
      endIdx: 1,
    },
    exercise: { id: 'left elbow raise', label: 'Left elbow' },
    selectedRegion: { id: 'left_arm' },
    selectedJoints: ['left_elbow'],
  });
  const dataset = buildDatasetJsonlExportForCapture(payload, { subjectId: 'anon_export' });

  assert.equal(error, null);
  assert.equal(payload.exercise.id, 'left elbow raise');
  assert.equal(dataset.error, null);
  assert.equal(JSON.parse(dataset.jsonl).subjectId, 'anon_export');
  assert.equal(safeExportId('left elbow raise'), 'left_elbow_raise');
  assert.equal(exportTimestamp(new Date('2026-01-02T03:04:05.678Z')), '2026-01-02T03-04-05-678Z');
});

test('download helpers create anchors with text and JSON payloads', () => {
  const clicked = [];
  const revoked = [];
  const appended = [];
  const anchors = [];
  const documentRef = {
    body: {
      append(node) {
        appended.push(node);
      },
    },
    createElement(tag) {
      assert.equal(tag, 'a');
      const anchor = {
        href: '',
        download: '',
        click() { clicked.push(this.download); },
        remove() {},
      };
      anchors.push(anchor);
      return anchor;
    },
  };
  const urlApi = {
    createObjectURL(blob) {
      assert.equal(blob instanceof Blob, true);
      return `blob:${anchors.length}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };

  const scheduleRevoke = (fn) => fn();

  assert.equal(downloadTextFile('row\n', 'dataset.jsonl', { documentRef, urlApi, scheduleRevoke }), true);
  assert.equal(downloadJsonFile({ ok: true }, 'payload.json', { documentRef, urlApi, scheduleRevoke }), true);
  assert.deepEqual(clicked, ['dataset.jsonl', 'payload.json']);
  assert.deepEqual(appended.map((node) => node.download), ['dataset.jsonl', 'payload.json']);
  assert.equal(anchors[0].href, 'blob:0');
  assert.equal(anchors[1].href, 'blob:1');
  assert.deepEqual(revoked, ['blob:0', 'blob:1']);
});

test('createClipPreviewRuntime renders preview frame and controls playback state', () => {
  const classes = () => {
    const set = new Set();
    return {
      add: (name) => set.add(name),
      remove: (name) => set.delete(name),
      contains: (name) => set.has(name),
    };
  };
  const calls = [];
  const ctx = {
    canvas: { width: 0, height: 0 },
    setTransform() {},
    fillRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText(text) { calls.push(['text', text]); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 320, height: 200 }),
    getContext: () => ctx,
  };
  ctx.canvas = canvas;
  const refs = {
    canvas,
    previewWrap: { classList: classes() },
    videoFrame: { classList: classes() },
    previewRange: {},
    previewPhase: {},
    previewMeta: {},
    previewPlayBtn: {},
    previewAngle: {},
    previewStartBtn: {},
    previewTargetBtn: {},
    previewEndBtn: {},
  };
  const state = { previewFrameIdx: null, previewPlaying: false, previewLastAt: 0, previewRaf: 0, cameraOn: false };
  const seq = {
    frames: [
      { t: 0, landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }], jointAngles: { right_shoulder: 20 } },
      { t: 100, landmarks: [{ x: 0.2, y: 0.3, z: 0, visibility: 0.9 }], jointAngles: { right_shoulder: 90 } },
      { t: 200, landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }], jointAngles: { right_shoulder: 25 } },
    ],
    startIdx: 0,
    targetIdx: 1,
    endIdx: 2,
  };
  let drawerCount = 0;
  let rafFn = null;
  const runtime = createClipPreviewRuntime({
    state,
    refs,
    activeSequence: () => seq,
    overlayJoints: () => ['right_shoulder'],
    lang: () => 'en',
    icon: (name) => `[${name}]`,
    formatMs: (ms) => `${ms}ms`,
    makeDrawer: () => () => { drawerCount += 1; },
    getDrawer: () => () => { drawerCount += 1; },
    setDrawer: () => {},
    drawPrimaryAngleOverlay: () => calls.push(['overlay']),
    requestFrame: (fn) => { rafFn = fn; return 42; },
    cancelFrame: (id) => calls.push(['cancel', id]),
    devicePixelRatio: () => 1,
    getComputedStyleImpl: () => ({ getPropertyValue: () => '#fff' }),
  });

  runtime.render();
  assert.equal(state.previewFrameIdx, 1);
  assert.equal(refs.previewRange.min, '0');
  assert.equal(refs.previewRange.max, '2');
  assert.equal(refs.previewPhase.textContent, 'Target / peak');
  assert.equal(refs.previewAngle.textContent, 'right shoulder 90°');
  assert.equal(drawerCount, 1);
  assert.equal(calls.some((call) => call[0] === 'overlay'), true);

  runtime.togglePlayback();
  assert.equal(state.previewPlaying, true);
  assert.equal(state.previewRaf, 42);
  assert.equal(typeof rafFn, 'function');
  runtime.stop();
  assert.equal(state.previewPlaying, false);
  assert.deepEqual(calls.filter((call) => call[0] === 'cancel'), [['cancel', 42]]);
});
