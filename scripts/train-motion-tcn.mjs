#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMotionDatasetJsonl } from '../shared/ai/MotionDataset.js';
import { extractMotionFeatureWindow } from '../shared/ai/MotionFeatureExtractor.js';
import { TCN_PHASES, TCN_QUALITIES } from '../shared/ai/TcnMotionClassifier.js';
import { getBodyRegionLandmarkSchema, modelManifestSchemaFields } from '../shared/ai/BodyRegionLandmarkSchema.js';
import { normalizeMotionLabel } from '../shared/ai/DatasetLabeler.js';

const PHASE_ALIASES = {
  rest_start: 'rest',
  rest_end: 'rest',
  outbound: 'moving_to_target',
  moving: 'moving_to_target',
  return: 'returning',
};
const QUALITY_ALIASES = {
  good_rep: 'good',
  bad_rep: 'incomplete',
  incomplete_target: 'incomplete',
  wrong_trajectory: 'wrong_path',
};

function parseArgs(argv) {
  const args = {
    input: null,
    out: 'shared/models/motion-tcn',
    epochs: 20,
    batchSize: 8,
    windowSize: 30,
    stride: 5,
    skipUnlabeled: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--epochs') args.epochs = Number(argv[++i]);
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]);
    else if (arg === '--window-size') args.windowSize = Number(argv[++i]);
    else if (arg === '--stride') args.stride = Number(argv[++i]);
    else if (arg === '--skip-unlabeled') args.skipUnlabeled = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/train-motion-tcn.mjs --input dataset.jsonl [--out shared/models/motion-tcn]',
    '',
    'Options:',
    '  --epochs N        Training epochs, default 20',
    '  --batch-size N    Batch size, default 8',
    '  --window-size N   Temporal window frames, default 30',
    '  --stride N        Sliding-window stride, default 5',
    '  --skip-unlabeled  Skip invalid/unreviewed rows instead of throwing',
    '  --dry-run         Validate dataset/features without loading TensorFlow',
  ].join('\n');
}

function normalizePhase(value) {
  const phase = PHASE_ALIASES[value] || value;
  return TCN_PHASES.includes(phase) ? phase : null;
}

function normalizeQuality(value) {
  const quality = normalizeMotionLabel(QUALITY_ALIASES[value] || value);
  return TCN_QUALITIES.includes(quality) ? quality : null;
}

function oneHot(label, labels) {
  return labels.map((item) => item === label ? 1 : 0);
}

function padWindow(vectors, windowSize, featureSize) {
  const out = vectors.slice(-windowSize).map((vector) => {
    const row = vector.slice(0, featureSize);
    while (row.length < featureSize) row.push(0);
    return row;
  });
  while (out.length < windowSize) out.unshift(Array.from({ length: featureSize }, () => 0));
  return out;
}

function validateTrainingRow(row, index) {
  const issues = [];
  const quality = normalizeQuality(row.motionLabel || row.label);
  if (!quality) issues.push('invalid_or_unlabeled_motion_label');
  if (row.labelStatus !== 'reviewed') issues.push('labelStatus_not_reviewed');
  if (row.trainable !== true) issues.push('trainable_not_true');
  if (row.dataQuality !== 'usable') issues.push(`dataQuality_${row.dataQuality || 'missing'}`);
  if (!row.landmarkSchemaId) issues.push('missing_landmarkSchemaId');
  if (row.missingPrimary?.length) issues.push('missing_primary_required');
  if (row.missingStabilizer?.length) issues.push('missing_stabilizer_required');
  if (!Array.isArray(row.frames) || !row.frames.length) issues.push('no_frames');
  return {
    ok: !issues.length,
    index,
    exerciseId: row.exerciseId || 'unknown',
    quality,
    issues,
  };
}

function phaseForFrame(row, frame, fallback = 'rest') {
  return normalizePhase(frame?.phase) ||
    normalizePhase(row.phaseLabels?.at(-1)) ||
    normalizePhase(fallback) ||
    'rest';
}

function buildSlidingWindowSamples(row, {
  windowSize,
  stride,
  featureSize,
  schema,
  quality,
}) {
  const featureWindow = extractMotionFeatureWindow(row.frames || [], {
    landmarkSchema: schema,
    landmarkSchemaId: row.landmarkSchemaId,
    joints: schema.jointNames,
  });
  const vectors = featureWindow.map((frame) => frame.featureVector);
  if (!vectors.length) return [];
  const samples = [];
  const step = Math.max(1, Number(stride) || 5);
  if (vectors.length < windowSize) {
    const frame = row.frames.at(-1);
    const phase = phaseForFrame(row, frame);
    samples.push({
      row,
      vectors,
      window: padWindow(vectors, windowSize, featureSize),
      phase,
      quality,
    });
    return samples;
  }
  for (let end = windowSize; end <= vectors.length; end += step) {
    const start = end - windowSize;
    const frame = row.frames[end - 1];
    const phase = phaseForFrame(row, frame);
    samples.push({
      row,
      vectors: vectors.slice(start, end),
      window: padWindow(vectors.slice(start, end), windowSize, featureSize),
      phase,
      quality,
    });
  }
  if ((vectors.length - windowSize) % step !== 0) {
    const frame = row.frames.at(-1);
    const phase = phaseForFrame(row, frame);
    samples.push({
      row,
      vectors: vectors.slice(-windowSize),
      window: padWindow(vectors.slice(-windowSize), windowSize, featureSize),
      phase,
      quality,
    });
  }
  return samples;
}

export async function loadTrainingDataset(filePath, { windowSize = 30, stride = 5, skipUnlabeled = false } = {}) {
  const text = await readFile(filePath, 'utf8');
  const rows = parseMotionDatasetJsonl(text);
  const validation = rows.map(validateTrainingRow);
  const invalid = validation.filter((item) => !item.ok);
  if (invalid.length && !skipUnlabeled) {
    const details = invalid.map((item) => `row ${item.index} (${item.exerciseId}): ${item.issues.join(', ')}`).join('\n');
    throw new Error(`Training dataset contains invalid or unreviewed rows:\n${details}`);
  }
  const validRows = rows.filter((_, index) => validation[index]?.ok);
  const schemaIds = [...new Set(validRows.map((row) => row.landmarkSchemaId).filter(Boolean))];
  if (schemaIds.length > 1) {
    throw new Error(`Training dataset mixes landmark schemas: ${schemaIds.join(', ')}`);
  }
  const schema = getBodyRegionLandmarkSchema(schemaIds[0] || 'full.v1');
  const featureWindows = validRows.map((row) => extractMotionFeatureWindow(row.frames || [], {
    landmarkSchema: schema,
    landmarkSchemaId: row.landmarkSchemaId,
    joints: schema.jointNames,
  }));
  const featureSize = Math.max(1, ...featureWindows.flatMap((window) => window.map((frame) => frame.featureVector.length)));
  const samples = validRows.flatMap((row) => buildSlidingWindowSamples(row, {
    windowSize,
    stride,
    featureSize,
    schema,
    quality: normalizeQuality(row.motionLabel || row.label),
  }));
  const shapeMismatch = samples.find((sample) => sample.window.some((vector) => vector.length !== featureSize));
  if (shapeMismatch) throw new Error(`Feature shape mismatch for exercise ${shapeMismatch.row.exerciseId}`);
  return {
    rows,
    validRows,
    invalidRows: invalid,
    samples: samples.map((sample) => ({
      ...sample,
      phaseOneHot: oneHot(sample.phase, TCN_PHASES),
      qualityOneHot: oneHot(sample.quality, TCN_QUALITIES),
    })),
    featureSize,
    windowSize,
    stride,
    schema,
  };
}

async function loadTfjsNode() {
  try {
    return await import('@tensorflow/tfjs-node');
  } catch (err) {
    throw new Error([
      'Training requires @tensorflow/tfjs-node, which is intentionally not part of the frontend runtime.',
      'Install it in a training environment, then rerun this script.',
      `Original error: ${err.message}`,
    ].join('\n'));
  }
}

async function train(args) {
  if (!args.input) throw new Error('Missing --input dataset.jsonl');
  const dataset = await loadTrainingDataset(args.input, {
    windowSize: args.windowSize,
    stride: args.stride,
    skipUnlabeled: args.skipUnlabeled,
  });
  if (!dataset.samples.length) throw new Error('Dataset has no usable motion samples.');

  const summary = {
    ok: true,
    rows: dataset.rows.length,
    validRows: dataset.validRows.length,
    invalidRows: dataset.invalidRows.length,
    samples: dataset.samples.length,
    windowSize: dataset.windowSize,
    stride: dataset.stride,
    featureSize: dataset.featureSize,
    landmarkSchemaId: dataset.schema.id,
    phases: TCN_PHASES,
    qualities: TCN_QUALITIES,
    out: args.out,
    dryRun: args.dryRun,
  };
  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const tf = await loadTfjsNode();
  const xs = tf.tensor3d(dataset.samples.map((sample) => sample.window));
  const yPhase = tf.tensor2d(dataset.samples.map((sample) => sample.phaseOneHot));
  const yQuality = tf.tensor2d(dataset.samples.map((sample) => sample.qualityOneHot));

  const input = tf.input({ shape: [dataset.windowSize, dataset.featureSize], name: 'motion_window' });
  let x = tf.layers.conv1d({ filters: 32, kernelSize: 3, dilationRate: 1, padding: 'causal', activation: 'relu' }).apply(input);
  x = tf.layers.conv1d({ filters: 32, kernelSize: 3, dilationRate: 2, padding: 'causal', activation: 'relu' }).apply(x);
  x = tf.layers.globalAveragePooling1d().apply(x);
  const phase = tf.layers.dense({ units: TCN_PHASES.length, activation: 'softmax', name: 'phase' }).apply(x);
  const quality = tf.layers.dense({ units: TCN_QUALITIES.length, activation: 'softmax', name: 'quality' }).apply(x);
  const model = tf.model({ inputs: input, outputs: [phase, quality], name: 'physioai_motion_tcn' });
  model.compile({
    optimizer: tf.train.adam(),
    loss: { phase: 'categoricalCrossentropy', quality: 'categoricalCrossentropy' },
    metrics: ['accuracy'],
  });
  await model.fit(xs, { phase: yPhase, quality: yQuality }, {
    epochs: Math.max(1, Number(args.epochs) || 20),
    batchSize: Math.max(1, Number(args.batchSize) || 8),
    shuffle: true,
  });

  await mkdir(args.out, { recursive: true });
  await model.save(`file://${path.resolve(args.out)}`);
  const manifest = {
    name: 'motion-tcn',
    version: new Date().toISOString().replace(/[:.]/g, '-'),
    modelPath: './model.json',
    ...modelManifestSchemaFields(dataset.schema),
    inputShape: [dataset.windowSize, dataset.featureSize],
    phases: TCN_PHASES,
    qualities: TCN_QUALITIES,
    datasetRows: dataset.rows.length,
    validDatasetRows: dataset.validRows.length,
    sampleCount: dataset.samples.length,
    trainedAt: new Date().toISOString(),
    exerciseScope: [...new Set(dataset.rows.map((row) => row.exerciseId).filter(Boolean))],
    approved: false,
  };
  await writeFile(path.join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, dryRun: false, manifest }, null, 2));
  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else {
    train(args).catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
}
