import test from 'node:test';
import assert from 'node:assert/strict';
import { renderModelValidationPanel } from '../../src/app/therapist/capture/modelValidationPanel.js';

function h(tag, props = {}, ...children) {
  return { tag, props: props || {}, children: children.flat().filter((child) => child != null) };
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return `${node.props?.html || ''}${(node.children || []).map(textOf).join('')}`;
}

const exercise = {
  id: 'shoulder_ai',
  activeModelId: 'right_arm_tcn_v1',
  modelStatus: 'deployed',
  landmarkSchemaId: 'right_arm.v1',
};

test('model validation panel marks deployed model as unverified without manifest', () => {
  const panel = renderModelValidationPanel({
    exercise,
    reference: { kind: 'motion_cycle' },
    readiness: { scoreable: true, dataQuality: 'usable', schemaId: 'right_arm.v1' },
    h,
  });

  assert.match(textOf(panel), /right_arm_tcn_v1 · manifest_not_loaded/);
  assert.match(textOf(panel), /unverified/);
});

test('model validation panel reports compatible and mismatched manifests', () => {
  const compatible = renderModelValidationPanel({
    exercise,
    reference: { kind: 'motion_cycle' },
    readiness: { scoreable: true, dataQuality: 'usable', schemaId: 'right_arm.v1' },
    modelManifest: { id: 'right_arm_tcn_v1', approved: true, landmarkSchemaId: 'right_arm.v1' },
    h,
  });
  const mismatch = renderModelValidationPanel({
    exercise,
    reference: { kind: 'motion_cycle' },
    readiness: { scoreable: true, dataQuality: 'usable', schemaId: 'right_arm.v1' },
    modelManifest: { id: 'right_arm_tcn_v1', approved: true, landmarkSchemaId: 'right_leg.v1' },
    h,
  });

  assert.match(textOf(compatible), /compatible/);
  assert.match(textOf(mismatch), /right_arm_tcn_v1 · schema_mismatch/);
  assert.match(textOf(mismatch), /mismatch/);
});
