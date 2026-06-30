import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiPhaseRepCounter } from '../../shared/ai/RepCounter.js';

test('AI phase rep counter counts rest target return rest transitions', () => {
  const counter = createAiPhaseRepCounter({
    minConfidence: 0.75,
    minTargetFrames: 2,
    minRestFrames: 2,
  });
  let result = null;
  [
    ['rest', 'good', 0],
    ['moving_to_target', 'good', 100],
    ['target', 'good', 200],
    ['target', 'good', 260],
    ['returning', 'unstable', 360],
    ['rest', 'unstable', 460],
    ['rest', 'unstable', 520],
  ].forEach(([phase, quality, timestamp]) => {
    result = counter.push({ phase, quality, confidence: 0.9, safetyOk: true, timestamp });
  });

  assert.equal(result.reps, 1);
  assert.equal(result.completedRep.index, 1);
  assert.equal(result.completedRep.quality, 'unstable');
  assert.equal(result.completedRep.startedAt, 100);
  assert.equal(result.completedRep.endedAt, 520);
});

test('AI phase rep counter pauses and rejects in-progress reps when safety fails', () => {
  const counter = createAiPhaseRepCounter({ minTargetFrames: 1, minRestFrames: 1 });
  counter.push({ phase: 'moving_to_target', quality: 'good', confidence: 0.9, safetyOk: true, timestamp: 100 });
  const paused = counter.push({ phase: 'target', quality: 'good', confidence: 0.9, safetyOk: false, timestamp: 200 });
  counter.push({ phase: 'returning', quality: 'good', confidence: 0.9, safetyOk: true, timestamp: 300 });
  const result = counter.push({ phase: 'rest', quality: 'good', confidence: 0.9, safetyOk: true, timestamp: 400 });

  assert.equal(paused.reps, 0);
  assert.equal(paused.currentPhase, 'rest');
  assert.equal(result.reps, 0);
});
