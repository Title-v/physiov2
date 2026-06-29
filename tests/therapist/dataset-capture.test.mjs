import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completedDatasetRepFromSnapshot,
  datasetPhaseFromSnapshot,
} from '../../src/app/therapist/capture/datasetCapture.js';

test('datasetPhaseFromSnapshot prefers AI phase labels and normalizes rule phases', () => {
  assert.equal(datasetPhaseFromSnapshot(null), null);
  assert.equal(datasetPhaseFromSnapshot({ phase: 'waiting_rest' }), 'rest');
  assert.equal(datasetPhaseFromSnapshot({ phase: 'holding' }), 'target');
  assert.equal(datasetPhaseFromSnapshot({ phase: 'moving_to_target' }), 'moving_to_target');
  assert.equal(datasetPhaseFromSnapshot({ aiRepCounter: { currentPhase: 'returning' }, phase: 'waiting_rest' }), 'returning');
  assert.equal(datasetPhaseFromSnapshot({ aiSignal: { phase: 'target' }, aiRepCounter: { currentPhase: 'returning' } }), 'target');
  assert.equal(datasetPhaseFromSnapshot({ aiSignal: { phase: 'unknown' }, phase: 'waiting_rest' }), 'rest');
});

test('completedDatasetRepFromSnapshot supports rule and AI phase rep completion', () => {
  assert.equal(completedDatasetRepFromSnapshot(null), null);
  assert.deepEqual(
    completedDatasetRepFromSnapshot({ completedRep: { index: 1, source: 'rule' } }),
    { index: 1, source: 'rule' },
  );
  assert.deepEqual(
    completedDatasetRepFromSnapshot({ aiCompletedRep: { index: 2, source: 'ai_phase' } }),
    { index: 2, source: 'ai_phase' },
  );
  assert.deepEqual(
    completedDatasetRepFromSnapshot({
      completedRep: { index: 3, source: 'rule' },
      aiCompletedRep: { index: 4, source: 'ai_phase' },
    }),
    { index: 3, source: 'rule' },
  );
});
