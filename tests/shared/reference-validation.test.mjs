import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_REFERENCE_VERSION, normalizeReferenceSchema, upgradeReferenceSchema } from '../../shared/ai/ReferenceSchema.js';
import { validateReferenceQuality } from '../../shared/validation/referenceValidation.js';
import { REFERENCE_KINDS } from '../../shared/ai/MotionQualityEngine.js';

function validMotionReference() {
  return {
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    exerciseId: 'shoulder',
    repJoints: ['right_shoulder'],
    scoringJoints: ['right_shoulder'],
    jointMotion: {
      right_shoulder: { rest: 20, target: 120, range: 100, tol: 15 },
    },
    restJointAngles: { right_shoulder: 20 },
    targetJointAngles: { right_shoulder: 120 },
    referenceSequence: {
      durationMs: 1400,
      frames: Array.from({ length: 8 }, (_, index) => ({
        t: index * 200,
        p: index <= 4 ? index / 4 : (8 - index) / 4,
        angles: { right_shoulder: index <= 4 ? 20 + index * 25 : 20 + (8 - index) * 25 },
      })),
    },
  };
}

test('normalizeReferenceSchema preserves old references while exposing canonical fields', () => {
  const normalized = normalizeReferenceSchema({
    kind: REFERENCE_KINDS.HOLD_POSE,
    exerciseId: 'balance',
    scoringJoints: ['right_knee'],
    jointAngles: { right_knee: 70 },
  });

  assert.equal(normalized.referenceVersion, 1);
  assert.deepEqual(normalized.repJoints, ['right_knee']);
  assert.deepEqual(normalized.targetJointAngles, { right_knee: 70 });
});

test('validateReferenceQuality accepts a full motion reference and scores quality', () => {
  const result = validateReferenceQuality(validMotionReference(), {
    id: 'shoulder',
    type: 'rep',
    minROMDeg: 15,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.quality.frameCount, 8);
  assert.ok(result.quality.score >= 90, `quality was ${result.quality.score}`);
});

test('validateReferenceQuality rejects missing or short motion references', () => {
  const missing = validateReferenceQuality({
    kind: REFERENCE_KINDS.MOTION_CYCLE,
    repJoints: ['right_shoulder'],
    jointMotion: { right_shoulder: { rest: 20, target: 25, range: 5 } },
  }, { type: 'rep', minROMDeg: 15 });
  assert.equal(missing.ok, false);
  assert.equal(missing.issues.includes('missing_reference_sequence'), true);
  assert.equal(missing.issues.includes('insufficient_rom'), true);

  const short = validateReferenceQuality({
    ...validMotionReference(),
    referenceSequence: { frames: [{ p: 0, angles: { right_shoulder: 20 } }] },
  }, { type: 'rep', minROMDeg: 15 });
  assert.equal(short.ok, false);
  assert.equal(short.issues.includes('too_few_frames'), true);
});

test('upgradeReferenceSchema stamps current versions and quality', () => {
  const upgraded = upgradeReferenceSchema(validMotionReference(), { score: 98 });
  assert.equal(upgraded.referenceVersion, CURRENT_REFERENCE_VERSION);
  assert.equal(upgraded.scoringVersion, 3);
  assert.deepEqual(upgraded.quality, { score: 98 });
});
