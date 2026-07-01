const DATASET_PHASE_ALIASES = Object.freeze({
  waiting_rest: 'rest',
  rest_start: 'rest',
  rest_end: 'rest',
  holding: 'target',
});

const DATASET_PHASES = Object.freeze(['rest', 'moving_to_target', 'target', 'returning']);

export function datasetPhaseFromSnapshot(snapshot = null) {
  const candidates = [
    snapshot?.aiSignal?.phase,
    snapshot?.aiRepCounter?.currentPhase,
    snapshot?.phase,
  ];
  for (const phase of candidates) {
    const normalized = DATASET_PHASE_ALIASES[phase] || phase;
    if (DATASET_PHASES.includes(normalized)) return normalized;
  }
  return null;
}

export function completedDatasetRepFromSnapshot(snapshot = null) {
  return snapshot?.completedRep || snapshot?.aiCompletedRep || null;
}

export function completionSourceFromSnapshot(snapshot = null) {
  const rep = completedDatasetRepFromSnapshot(snapshot);
  if (!rep) return null;
  if (rep.repSource === 'ai_primary' || rep.aiPhaseRep || snapshot?.aiCompletedRep) return 'ai_phase';
  return 'rule_completed_rep';
}
