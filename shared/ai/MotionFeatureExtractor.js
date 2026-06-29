import { landmarkToTuple } from './MotionDataset.js';
import { getBodyRegionLandmarkSchema } from './BodyRegionLandmarkSchema.js';
import { idx } from './Landmarks.js';

export const MOTION_FEATURE_SCHEMA_VERSION = 1;
export const DEFAULT_LANDMARK_COUNT = 33;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanAngles(angles = {}) {
  const out = {};
  for (const [joint, value] of Object.entries(angles || {})) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[joint] = n;
  }
  return out;
}

function sortedJoints(joints = [], angles = {}) {
  const list = joints.length ? joints : Object.keys(angles || {});
  return [...new Set(list.filter(Boolean))].sort();
}

function padLandmarks(landmarks = [], count = DEFAULT_LANDMARK_COUNT) {
  const tuples = Array.isArray(landmarks) ? landmarks.map(landmarkToTuple) : [];
  const out = tuples.slice(0, count);
  while (out.length < count) out.push([0, 0, 0, 0]);
  return out;
}

function landmarkTupleByName(landmarks = [], name) {
  const index = idx(name);
  if (index < 0) return [0, 0, 0, 0];
  return landmarkToTuple(landmarks?.[index]);
}

function landmarksForSchema(landmarks = [], schema = null, landmarkCount = DEFAULT_LANDMARK_COUNT) {
  if (!schema?.modelInputLandmarks?.length) return padLandmarks(landmarks, landmarkCount);
  return schema.modelInputLandmarks.map((name) => landmarkTupleByName(landmarks, name));
}

function meanVisibility(landmarks = []) {
  const values = landmarks.map((p) => finiteNumber(p?.[3], 0));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function angleVelocity(currentAngles, previousAngles, dtMs, joints) {
  const seconds = Math.max(0.001, finiteNumber(dtMs, 0) / 1000);
  const out = {};
  for (const joint of joints) {
    const current = Number(currentAngles?.[joint]);
    const previous = Number(previousAngles?.[joint]);
    out[joint] = Number.isFinite(current) && Number.isFinite(previous)
      ? (current - previous) / seconds
      : 0;
  }
  return out;
}

function timestampOf(frame, index = 0) {
  return finiteNumber(frame?.tMs ?? frame?.t ?? frame?.timestamp, index);
}

function boundaryInsideFlag(boundaryStatus) {
  return boundaryStatus === 'inside' ? 1 : 0;
}

export function extractMotionFeatures(frame = {}, {
  previousFrame = null,
  joints = [],
  landmarkCount = DEFAULT_LANDMARK_COUNT,
  landmarkSchemaId = frame.landmarkSchemaId || frame.metadata?.landmarkSchemaId || null,
  landmarkSchema = null,
  exercise = null,
  progress = null,
} = {}) {
  const schema = landmarkSchema || (landmarkSchemaId || exercise?.landmarkSchemaId || exercise?.bodyRegion
    ? getBodyRegionLandmarkSchema(landmarkSchemaId || exercise)
    : null);
  const landmarks = landmarksForSchema(frame.landmarks, schema, landmarkCount);
  const angles = cleanAngles(frame.angles || frame.jointAngles || {});
  const orderedJoints = sortedJoints(joints.length ? joints : (schema?.jointNames || []), angles);
  const previousAngles = previousFrame ? cleanAngles(previousFrame.angles || previousFrame.jointAngles || {}) : {};
  const dtMs = previousFrame ? timestampOf(frame) - timestampOf(previousFrame) : 0;
  const velocities = angleVelocity(angles, previousAngles, dtMs, orderedJoints);
  const boundaryStatus = frame.boundaryStatus || frame.boundary?.status || 'unknown';
  const visibilityScore = finiteNumber(
    frame.visibilityScore,
    meanVisibility(landmarks) * 100,
  );
  const progressEstimate = finiteNumber(progress ?? frame.progress ?? frame.progressPct, 0);

  const featureVector = [
    ...landmarks.flat(),
    ...orderedJoints.map((joint) => finiteNumber(angles[joint])),
    ...orderedJoints.map((joint) => finiteNumber(velocities[joint])),
    progressEstimate,
    boundaryInsideFlag(boundaryStatus),
    visibilityScore / 100,
  ];

  return {
    version: MOTION_FEATURE_SCHEMA_VERSION,
    t: timestampOf(frame),
    landmarks,
    angles,
    angleVelocity: velocities,
    joints: orderedJoints,
    progress: progressEstimate,
    boundaryStatus,
    insideFrame: boundaryStatus === 'inside',
    visibilityScore,
    featureVector,
    landmarkSchemaId: schema?.id || null,
    modelInputLandmarks: schema?.modelInputLandmarks ? [...schema.modelInputLandmarks] : null,
    featureSize: featureVector.length,
  };
}

export function extractMotionFeatureWindow(frames = [], options = {}) {
  const list = Array.isArray(frames) ? frames : [];
  return list.map((frame, index) => extractMotionFeatures(frame, {
    ...options,
    previousFrame: index > 0 ? list[index - 1] : null,
  }));
}

export function featureVectorsFromWindow(frames = [], options = {}) {
  return extractMotionFeatureWindow(frames, options).map((features) => features.featureVector);
}
