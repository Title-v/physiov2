import { idx } from './Landmarks.js';

export const BODY_REGION_SCHEMA_VERSION = 1;

const STRICT_BOUNDARY_POLICY = Object.freeze({
  requirePrimaryInside: true,
  requireStabilizerInside: true,
  minPrimaryVisibleRatio: 0.9,
  minStabilizerVisibleRatio: 0.9,
  minBoundaryInsideRatio: 0.9,
});

function schema({
  id,
  bodyRegion,
  primaryRequiredLandmarks,
  stabilizerRequiredLandmarks,
  jointNames,
  minVisibility = 0.6,
  boundaryPolicy = STRICT_BOUNDARY_POLICY,
}) {
  const modelInputLandmarks = [
    ...primaryRequiredLandmarks,
    ...stabilizerRequiredLandmarks,
  ].filter((name, index, list) => name && list.indexOf(name) === index);
  return Object.freeze({
    id,
    version: BODY_REGION_SCHEMA_VERSION,
    bodyRegion,
    primaryRequiredLandmarks: Object.freeze([...primaryRequiredLandmarks]),
    stabilizerRequiredLandmarks: Object.freeze([...stabilizerRequiredLandmarks]),
    modelInputLandmarks: Object.freeze(modelInputLandmarks),
    jointNames: Object.freeze([...jointNames]),
    minVisibility,
    boundaryPolicy: Object.freeze({ ...boundaryPolicy }),
  });
}

export const BODY_REGION_LANDMARK_SCHEMAS = Object.freeze({
  'right_arm.v1': schema({
    id: 'right_arm.v1',
    bodyRegion: 'right_arm',
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
  }),
  'left_arm.v1': schema({
    id: 'left_arm.v1',
    bodyRegion: 'left_arm',
    primaryRequiredLandmarks: ['left_shoulder', 'left_elbow', 'left_wrist'],
    stabilizerRequiredLandmarks: ['right_shoulder', 'left_hip'],
    jointNames: ['left_shoulder', 'left_elbow'],
  }),
  'right_leg.v1': schema({
    id: 'right_leg.v1',
    bodyRegion: 'right_leg',
    primaryRequiredLandmarks: ['right_hip', 'right_knee', 'right_ankle'],
    stabilizerRequiredLandmarks: ['left_hip', 'right_shoulder'],
    jointNames: ['right_hip', 'right_knee'],
  }),
  'left_leg.v1': schema({
    id: 'left_leg.v1',
    bodyRegion: 'left_leg',
    primaryRequiredLandmarks: ['left_hip', 'left_knee', 'left_ankle'],
    stabilizerRequiredLandmarks: ['right_hip', 'left_shoulder'],
    jointNames: ['left_hip', 'left_knee'],
  }),
  'shoulder.v1': schema({
    id: 'shoulder.v1',
    bodyRegion: 'shoulder',
    primaryRequiredLandmarks: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow'],
    stabilizerRequiredLandmarks: ['left_hip', 'right_hip'],
    jointNames: ['left_shoulder', 'right_shoulder'],
  }),
  'upper.v1': schema({
    id: 'upper.v1',
    bodyRegion: 'upper',
    primaryRequiredLandmarks: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_hip', 'right_hip'],
    jointNames: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow'],
  }),
  'lower.v1': schema({
    id: 'lower.v1',
    bodyRegion: 'lower',
    primaryRequiredLandmarks: ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_shoulder'],
    jointNames: ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  }),
  'full.v1': schema({
    id: 'full.v1',
    bodyRegion: 'full',
    primaryRequiredLandmarks: [
      'left_shoulder', 'right_shoulder',
      'left_hip', 'right_hip',
      'left_knee', 'right_knee',
      'left_ankle', 'right_ankle',
    ],
    stabilizerRequiredLandmarks: ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
    jointNames: ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_knee', 'right_knee'],
  }),
});

export const BODY_REGION_TO_LANDMARK_SCHEMA_ID = Object.freeze({
  whole: 'full.v1',
  whole_body: 'full.v1',
  full_body: 'full.v1',
  full: 'full.v1',
  upper: 'upper.v1',
  lower: 'lower.v1',
  shoulder: 'shoulder.v1',
  left_arm: 'left_arm.v1',
  right_arm: 'right_arm.v1',
  left_leg: 'left_leg.v1',
  right_leg: 'right_leg.v1',
});

export function defaultLandmarkSchemaIdForBodyRegion(bodyRegion = 'full') {
  return BODY_REGION_TO_LANDMARK_SCHEMA_ID[bodyRegion] || 'full.v1';
}

export function inferLandmarkSchemaId(exercise = {}) {
  return exercise?.landmarkSchemaId ||
    defaultLandmarkSchemaIdForBodyRegion(exercise?.bodyRegion || 'full');
}

export function getBodyRegionLandmarkSchema(schemaIdOrExercise = 'full.v1') {
  const schemaId = typeof schemaIdOrExercise === 'string'
    ? schemaIdOrExercise
    : inferLandmarkSchemaId(schemaIdOrExercise);
  return BODY_REGION_LANDMARK_SCHEMAS[schemaId] || BODY_REGION_LANDMARK_SCHEMAS['full.v1'];
}

export function schemaLandmarkIndices(schemaOrId) {
  const resolved = typeof schemaOrId === 'string'
    ? getBodyRegionLandmarkSchema(schemaOrId)
    : schemaOrId;
  return (resolved?.modelInputLandmarks || [])
    .map((name) => ({ name, index: idx(name) }))
    .filter((item) => item.index >= 0);
}

export function landmarkSchemaMetadataForExercise(exercise = {}) {
  const schema = getBodyRegionLandmarkSchema(exercise);
  return {
    landmarkSchemaId: schema.id,
    bodyRegion: schema.bodyRegion,
    primaryRequiredLandmarks: [...schema.primaryRequiredLandmarks],
    stabilizerRequiredLandmarks: [...schema.stabilizerRequiredLandmarks],
    modelInputLandmarks: [...schema.modelInputLandmarks],
    jointNames: [...schema.jointNames],
    featureSchemaVersion: BODY_REGION_SCHEMA_VERSION,
    minVisibility: Number(exercise.minVisibility ?? schema.minVisibility),
  };
}

export function modelManifestSchemaFields(schemaOrId) {
  const schema = typeof schemaOrId === 'string'
    ? getBodyRegionLandmarkSchema(schemaOrId)
    : schemaOrId;
  return {
    bodyRegion: schema.bodyRegion,
    landmarkSchemaId: schema.id,
    modelInputLandmarks: [...schema.modelInputLandmarks],
    primaryRequiredLandmarks: [...schema.primaryRequiredLandmarks],
    stabilizerRequiredLandmarks: [...schema.stabilizerRequiredLandmarks],
    jointNames: [...schema.jointNames],
    featureSchemaVersion: schema.version,
  };
}
