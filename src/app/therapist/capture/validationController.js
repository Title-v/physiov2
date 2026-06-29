import { createMotionQualityEngine, isUsablePracticeReference } from '../../../../shared/ai/MotionQualityEngine.js';
import { createPracticeFrameProcessor } from '../../../../shared/practice/frame.js';

export function validationDoseFor(exercise = {}) {
  return {
    reps: Number(exercise?.reps) || 1,
    sets: Number(exercise?.sets) || 1,
    holdSec: Number(exercise?.holdSec) || 10,
  };
}

export function validationReferenceKey(exercise = {}, reference = {}, fallbackExerciseId = '') {
  return [
    exercise?.id || fallbackExerciseId,
    reference?.capturedAt || '',
    reference?.kind || '',
    reference?.referenceVersion || '',
    reference?.referenceSequence?.sampleCount || '',
  ].join('|');
}

export function validationScoreColors(score) {
  const value = Number(score) || 0;
  if (value >= 75) return ['#2F5D50', '#7BA88F'];
  if (value >= 50) return ['#9C7344', '#C8955A'];
  return ['#8C4F40', '#B86C5A'];
}

export function getValidationFrameProcessor(state, exercise, reference, {
  fallbackExerciseId = '',
  lang = 'en',
  motionEngineFactory = createMotionQualityEngine,
  frameProcessorFactory = createPracticeFrameProcessor,
  usableReferenceCheck = isUsablePracticeReference,
} = {}) {
  if (!usableReferenceCheck(reference, exercise)) return null;
  const key = validationReferenceKey(exercise, reference, fallbackExerciseId);
  if (!state.validationEngine || state.validationKey !== key) {
    state.validationEngine = motionEngineFactory({
      exercise,
      reference,
      dose: validationDoseFor(exercise),
      lang: typeof lang === 'function' ? lang() : lang,
    });
    state.validationFrameProcessor = frameProcessorFactory({
      exercise,
      reference,
      motionEngine: state.validationEngine,
    });
    state.validationKey = key;
  }
  return state.validationFrameProcessor;
}
