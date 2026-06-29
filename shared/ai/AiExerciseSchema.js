import {
  inferLandmarkSchemaId,
  landmarkSchemaMetadataForExercise,
} from './BodyRegionLandmarkSchema.js';

export const AI_EXERCISE_STATUSES = Object.freeze([
  'collecting_data',
  'training',
  'validated',
  'deployed',
]);

export function createAiExerciseDefinition({
  id,
  label,
  bodyRegion,
  source = 'ai_custom',
  landmarkSchemaId = null,
  activeModelId = null,
  fallbackReferenceId = null,
  status = 'collecting_data',
  metadata = {},
} = {}) {
  const exercise = {
    id,
    source,
    label,
    bodyRegion,
    landmarkSchemaId: landmarkSchemaId || inferLandmarkSchemaId({ bodyRegion }),
  };
  return {
    ...exercise,
    ...landmarkSchemaMetadataForExercise(exercise),
    activeModelId,
    fallbackReferenceId,
    status: AI_EXERCISE_STATUSES.includes(status) ? status : 'collecting_data',
    metadata: { ...metadata },
  };
}

export function aiExerciseReadiness({
  exercise = {},
  reference = null,
  modelManifest = null,
} = {}) {
  const schemaId = exercise.landmarkSchemaId || inferLandmarkSchemaId(exercise);
  const referenceReady = !!reference;
  const modelReady = !!modelManifest &&
    modelManifest.approved === true &&
    modelManifest.landmarkSchemaId === schemaId;
  return {
    ok: referenceReady || modelReady,
    schemaId,
    referenceReady,
    modelReady,
    reason: modelReady
      ? 'model_ready'
      : referenceReady
        ? 'reference_fallback_ready'
        : 'missing_reference_or_model',
  };
}
