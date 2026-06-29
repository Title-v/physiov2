import test from 'node:test';
import assert from 'node:assert/strict';
import { jointAngleCalculator } from '../../shared/ai/JointAngleCalculator.js';
import { drawAngleOverlayForJoints } from '../../shared/ai/AngleOverlay.js';
import { drawBoundaryBox, evaluateBoundaryBox } from '../../shared/ai/BoundaryBoxGate.js';
import { poseComparator } from '../../shared/ai/PoseComparator.js';
import { makeBasePose, makeElbowPose, makeMockCanvasContext, setPoint } from '../helpers/pose-fixtures.mjs';

test('jointAngleCalculator computes angles from real landmark geometry', () => {
  const angles = jointAngleCalculator(makeElbowPose(90));
  assert.ok(Math.abs(angles.left_elbow - 90) < 0.1, `left elbow angle was ${angles.left_elbow}`);
});

test('evaluateBoundaryBox detects inside, outside, no-pose, and missing visibility', () => {
  const exercise = { bodyRegion: 'full', primaryJoint: 'left_elbow' };
  const inside = evaluateBoundaryBox(makeBasePose(), null, exercise, 100);
  assert.equal(inside.status, 'inside');
  assert.equal(inside.ok, true);

  const outside = evaluateBoundaryBox(makeBasePose({ offsetX: 0.7 }), null, exercise, 200);
  assert.equal(outside.status, 'outside');
  assert.equal(outside.ok, false);

  const noPose = evaluateBoundaryBox(null, null, exercise, 300);
  assert.equal(noPose.status, 'outside');
  assert.equal(noPose.missing.length > 0, true);

  const lowVisibility = makeBasePose();
  setPoint(lowVisibility, 'left_elbow', 0.29, 0.5, 0.1);
  const missing = evaluateBoundaryBox(lowVisibility, null, exercise, 400);
  assert.equal(missing.status, 'outside');
  assert.equal(missing.missingNames?.includes?.('left_elbow') ?? missing.missing.length > 0, true);
});

test('poseComparator scores near pose higher than bad pose', () => {
  const good = poseComparator(
    { left_elbow: 90, right_knee: 120 },
    { left_elbow: 94, right_knee: 124 },
    { left_elbow: 12, right_knee: 15 },
  );
  const bad = poseComparator(
    { left_elbow: 90, right_knee: 120 },
    { left_elbow: 150, right_knee: 60 },
    { left_elbow: 12, right_knee: 15 },
  );
  assert.ok(good.score > 80, `expected high score, got ${good.score}`);
  assert.ok(bad.score < good.score, `expected bad score below good score: ${bad.score} >= ${good.score}`);
});

test('drawAngleOverlayForJoints draws labels and paths on a canvas context', () => {
  const ctx = makeMockCanvasContext();
  const landmarks = makeElbowPose(90);
  const count = drawAngleOverlayForJoints(ctx, landmarks, { left_elbow: 90 }, ['left_elbow'], { lang: 'en' });
  assert.equal(count, 1);
  assert.equal(ctx.calls.some((call) => call[0] === 'arc'), true);
  assert.equal(ctx.calls.some((call) => call[0] === 'fillText'), true);
});

test('drawBoundaryBox draws boundary path on a canvas context', () => {
  const ctx = makeMockCanvasContext();
  drawBoundaryBox(ctx, { status: 'inside' });
  assert.equal(ctx.calls.some((call) => call[0] === 'stroke'), true);
  assert.equal(ctx.calls.some((call) => call[0] === 'quadraticCurveTo'), true);
});
