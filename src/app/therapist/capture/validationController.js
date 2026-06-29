import { createMotionQualityEngine, isUsablePracticeReference } from '../../../../shared/ai/MotionQualityEngine.js';
import { createMotionTcnModelRegistry } from '../../../../shared/ai/MotionTcnRuntime.js';
import { createTcnMotionClassifier } from '../../../../shared/ai/TcnMotionClassifier.js';
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
    exercise?.landmarkSchemaId || '',
    exercise?.activeModelId || '',
    exercise?.modelStatus || '',
  ].join('|');
}

export function validationModelBaseUrlForExercise(exercise = {}) {
  if (exercise.modelBaseUrl) return exercise.modelBaseUrl;
  if (exercise.modelUrl) return exercise.modelUrl;
  if (exercise.activeModelId) return `/shared/models/${exercise.activeModelId}`;
  return undefined;
}

export function validationScoreColors(score) {
  const value = Number(score) || 0;
  if (value >= 75) return ['#2F5D50', '#7BA88F'];
  if (value >= 50) return ['#9C7344', '#C8955A'];
  return ['#8C4F40', '#B86C5A'];
}

export function validationFeedbackText(snapshot = null, fallback = '', { lang = 'en' } = {}) {
  const aiSignal = snapshot?.aiSignal || null;
  if (!aiSignal) return fallback || '';
  const confidence = Math.round(Math.max(0, Math.min(1, Number(aiSignal.confidence) || 0)) * 100);
  const aiRepText = Number.isFinite(Number(snapshot.aiRepCount))
    ? ` · AI reps ${snapshot.aiRepCount}`
    : '';
  const prefix = lang === 'th' ? 'AI' : 'AI';
  return `${prefix} ${aiSignal.phase || 'phase'} · ${aiSignal.quality || 'quality'} · ${confidence}% confidence${aiRepText}`;
}

export function getValidationFrameProcessor(state, exercise, reference, {
  fallbackExerciseId = '',
  lang = 'en',
  motionEngineFactory = createMotionQualityEngine,
  frameProcessorFactory = createPracticeFrameProcessor,
  modelRegistryFactory = createMotionTcnModelRegistry,
  motionClassifierFactory = createTcnMotionClassifier,
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
    state.validationModelRegistry = modelRegistryFactory({
      baseUrl: validationModelBaseUrlForExercise(exercise),
    });
    state.validationMotionClassifier = motionClassifierFactory({
      registry: state.validationModelRegistry,
      modelName: 'motion-tcn',
      extractorOptions: {
        landmarkSchemaId: exercise.landmarkSchemaId,
      },
    });
    state.validationFrameProcessor = frameProcessorFactory({
      exercise,
      reference,
      motionEngine: state.validationEngine,
      motionClassifier: state.validationMotionClassifier,
      classifierOptions: {
        landmarkSchemaId: exercise.landmarkSchemaId,
      },
    });
    state.validationKey = key;
  }
  return state.validationFrameProcessor;
}
