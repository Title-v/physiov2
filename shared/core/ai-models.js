import { apiGet } from './api.js';

export function modelManifestId(model = {}) {
  return model?.id || model?.modelId || model?.name || null;
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function fetchAiModels({
  exerciseId = null,
  landmarkSchemaId = null,
  get = apiGet,
} = {}) {
  return get(`/ai-models${queryString({ exerciseId, landmarkSchemaId })}`);
}

function modelForExercise(model = {}, exercise = {}) {
  return !model.exerciseId || !exercise.id || model.exerciseId === exercise.id;
}

function sameSchema(model = {}, exercise = {}) {
  return !!exercise.landmarkSchemaId && model.landmarkSchemaId === exercise.landmarkSchemaId;
}

export function selectModelManifestForExercise(exercise = {}, models = []) {
  const list = Array.isArray(models) ? models : [];
  const activeId = exercise.activeModelId || null;
  if (activeId) {
    return list.find((model) => modelManifestId(model) === activeId) || null;
  }
  return list.find((model) => model.approved === true && sameSchema(model, exercise) && modelForExercise(model, exercise)) ||
    list.find((model) => sameSchema(model, exercise) && modelForExercise(model, exercise)) ||
    null;
}

export function exerciseWithModelManifest(exercise = {}, modelManifest = null) {
  if (!modelManifest) return exercise;
  const modelId = modelManifestId(modelManifest);
  if (!modelId) return exercise;
  return {
    ...exercise,
    activeModelId: exercise.activeModelId || modelId,
    modelStatus: modelManifest.approved === true ? 'deployed' : (exercise.modelStatus || 'training'),
    modelBaseUrl: modelManifest.modelBaseUrl || exercise.modelBaseUrl,
    modelUrl: modelManifest.modelUrl || exercise.modelUrl,
  };
}
