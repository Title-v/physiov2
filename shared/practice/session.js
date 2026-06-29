export const PRACTICE_SESSION_VERSION = 2;

export function sessionScoreBreakdown(summary = {}) {
  return {
    overall: summary.overallScore ?? summary.avgScore ?? null,
    pose: summary.avgPoseScore ?? summary.poseScore ?? null,
    path: summary.avgPathScore ?? summary.pathScore ?? null,
    targetReach: summary.avgTargetReachScore ?? summary.targetReachScore ?? null,
    boundary: summary.avgBoundaryScore ?? summary.boundaryScore ?? null,
    visibility: summary.avgVisibilityScore ?? summary.visibilityScore ?? null,
    tempo: summary.avgTempoScore ?? summary.tempoScore ?? null,
    stability: summary.avgStabilityScore ?? summary.stabilityScore ?? null,
    duration: summary.durationScore ?? null,
  };
}

export function buildPracticeSessionPayload({
  exercise = {},
  planItems = [],
  summary = {},
  reference = null,
  endedAt = Date.now(),
} = {}) {
  const exerciseId = exercise.id || summary.exerciseId || 'exercise';
  const isPlanExercise = Array.isArray(planItems) && planItems.some((item) => item.exerciseId === exerciseId);
  return {
    id: `patient_${exerciseId}_${endedAt}`,
    exerciseId,
    exerciseTitle: exercise.title || exercise.labelTh || exercise.label || exerciseId,
    kind: isPlanExercise ? 'plan' : 'extra',
    sessionVersion: PRACTICE_SESSION_VERSION,
    referenceVersion: reference?.referenceVersion ?? summary.referenceVersion ?? null,
    scoringVersion: reference?.scoringVersion ?? summary.scoringVersion ?? null,
    endedAt,
    score: summary.overallScore,
    avgScore: summary.avgScore ?? summary.overallScore,
    reps: summary.reps,
    validReps: summary.validReps,
    invalidRepCount: summary.invalidRepCount,
    scoreBreakdown: sessionScoreBreakdown(summary),
    invalidReasons: summary.invalidReasons || {},
    summary,
  };
}

export function summaryMetrics({ summary, session } = {}) {
  const data = summary || session?.summary || {};
  const score = Number(data.overallScore ?? session?.score ?? 0);
  const poseScore = Number(data.avgPoseScore ?? data.avgRepQualityScore ?? 0);
  const motionScore = Number(data.avgTargetReachScore ?? data.durationScore ?? 0);
  const validReps = Number(data.validReps ?? 0);
  const reps = Number(data.reps ?? 0);
  return {
    score,
    poseScore,
    motionScore,
    validReps,
    reps,
    validLabel: `${validReps}/${reps}`,
  };
}
