export function buildPracticeSessionPayload({
  exercise = {},
  planItems = [],
  summary = {},
  endedAt = Date.now(),
} = {}) {
  const exerciseId = exercise.id || summary.exerciseId || 'exercise';
  const isPlanExercise = Array.isArray(planItems) && planItems.some((item) => item.exerciseId === exerciseId);
  return {
    id: `patient_${exerciseId}_${endedAt}`,
    exerciseId,
    exerciseTitle: exercise.title || exercise.labelTh || exercise.label || exerciseId,
    kind: isPlanExercise ? 'plan' : 'extra',
    endedAt,
    score: summary.overallScore,
    avgScore: summary.avgScore ?? summary.overallScore,
    reps: summary.reps,
    validReps: summary.validReps,
    invalidRepCount: summary.invalidRepCount,
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
