import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLandmarkSchemaIdForBodyRegion,
  getBodyRegionLandmarkSchema,
  landmarkSchemaMetadataForExercise,
} from '../../shared/ai/BodyRegionLandmarkSchema.js';
import { evaluateMotionSafetyGate } from '../../shared/ai/MotionSafetyGate.js';
import { evaluateBoundaryBox } from '../../shared/ai/BoundaryBoxGate.js';
import { makeBasePose, setPoint } from '../helpers/pose-fixtures.mjs';

test('body-region schema resolves primary stabilizer and model input landmarks', () => {
  assert.equal(defaultLandmarkSchemaIdForBodyRegion('right_arm'), 'right_arm.v1');
  const schema = getBodyRegionLandmarkSchema('right_arm.v1');

  assert.deepEqual(schema.primaryRequiredLandmarks, ['right_shoulder', 'right_elbow', 'right_wrist']);
  assert.deepEqual(schema.stabilizerRequiredLandmarks, ['left_shoulder', 'right_hip']);
  assert.deepEqual(schema.modelInputLandmarks, ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip']);

  const metadata = landmarkSchemaMetadataForExercise({ id: 'custom', bodyRegion: 'right_arm' });
  assert.equal(metadata.landmarkSchemaId, 'right_arm.v1');
  assert.deepEqual(metadata.jointNames, ['right_shoulder', 'right_elbow']);
});

test('motion safety gate requires primary and stabilizer landmarks before training', () => {
  const pose = makeBasePose();
  const ready = evaluateMotionSafetyGate(pose, { exercise: { bodyRegion: 'right_arm', landmarkSchemaId: 'right_arm.v1' } });
  assert.equal(ready.ok, true);
  assert.equal(ready.trainable, true);
  assert.equal(ready.dataQuality, 'usable');

  const missingPrimary = makeBasePose();
  setPoint(missingPrimary, 'right_elbow', 0.71, 0.5, 0.1);
  const primary = evaluateMotionSafetyGate(missingPrimary, { exercise: { bodyRegion: 'right_arm', landmarkSchemaId: 'right_arm.v1' } });
  assert.equal(primary.ok, false);
  assert.equal(primary.status, 'low_visibility');
  assert.deepEqual(primary.missingPrimary, ['right_elbow']);

  const missingStabilizer = makeBasePose();
  setPoint(missingStabilizer, 'left_shoulder', 0.38, 0.36, 0.1);
  const stabilizer = evaluateMotionSafetyGate(missingStabilizer, { exercise: { bodyRegion: 'right_arm', landmarkSchemaId: 'right_arm.v1' } });
  assert.equal(stabilizer.ok, false);
  assert.equal(stabilizer.status, 'low_visibility');
  assert.deepEqual(stabilizer.missingStabilizer, ['left_shoulder']);
});

test('boundary gate keeps legacy inside/outside status and exposes AI readiness fields', () => {
  const inside = evaluateBoundaryBox(makeBasePose(), null, {
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
  }, 100);

  assert.equal(inside.status, 'inside');
  assert.equal(inside.readinessStatus, 'ready');
  assert.equal(inside.trainable, true);
  assert.equal(inside.landmarkSchemaId, 'right_arm.v1');

  const outside = evaluateBoundaryBox(makeBasePose({ offsetX: 0.7 }), null, {
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
  }, 200);
  assert.equal(outside.status, 'outside');
  assert.equal(outside.dataQuality, 'out_of_frame');
  assert.equal(outside.scoreable, false);
});
