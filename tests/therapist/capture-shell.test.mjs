import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCaptureShell } from '../../src/app/therapist/capture/captureShell.js';

function h(tag, props = {}, ...children) {
  return { tag, props: props || {}, children: children.flat().filter((child) => child != null) };
}

function clear(node) {
  node.children = [];
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return `${node.props?.html || ''}${(node.children || []).map(textOf).join('')}`;
}

function renderShell({ advancedOpen }) {
  const root = {
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
  };
  const oldDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === 'root' ? root : null),
  };
  try {
    renderCaptureShell({
      state: { mode: 'setup', advancedOpen },
      refs: {},
      dom: {
        h,
        clear,
        icon: (name) => `<${name}>`,
        t: (key) => ({
          noPose: 'No pose',
          setup: 'Setup',
          validate: 'Validate',
          fromImage: 'From image',
        }[key] || key),
        getLang: () => 'en',
      },
      actions: {
        captureButtonText: () => 'Capture',
        capture() {},
        setMode() {},
        toggleSequenceRecording() {},
        setClipPreviewIndex() {},
        toggleClipPlayback() {},
        jumpClipPreview() {},
        setSequenceMarkerFromPreview() {},
        exportSkeletonParameters() {},
        exportMotionDatasetJsonl() {},
        exportRefs() {},
        importRefsClick() {},
        imageInputClick() {},
        clearRef() {},
      },
    });
  } finally {
    globalThis.document = oldDocument;
  }
  return textOf(root);
}

test('capture shell keeps import export and clear actions behind Advanced', () => {
  const normal = renderShell({ advancedOpen: false });
  assert.match(normal, /Capture/);
  assert.match(normal, /Record motion/);
  assert.doesNotMatch(normal, /From image/);
  assert.doesNotMatch(normal, /Export refs/);
  assert.doesNotMatch(normal, /Import/);
  assert.doesNotMatch(normal, /Debug JSON/);

  const advanced = renderShell({ advancedOpen: true });
  assert.match(advanced, /From image/);
  assert.match(advanced, /Export refs/);
  assert.match(advanced, /Import/);
  assert.match(advanced, /Debug JSON/);
  assert.match(advanced, /Debug JSONL/);
});
