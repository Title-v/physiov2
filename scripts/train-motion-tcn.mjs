#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMotionDatasetJsonl } from '../shared/ai/MotionDataset.js';
import { extractMotionFeatureWindow } from '../shared/ai/MotionFeatureExtractor.js';
import { TCN_PHASES, TCN_QUALITIES } from '../shared/ai/TcnMotionClassifier.js';

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
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--epochs') args.epochs = Number(argv[++i]);
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]);
    else if (arg === '--window-size') args.windowSize = Number(argv[++i]);
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
    '  --dry-run         Validate dataset/features without loading TensorFlow',
  ].join('\n');
}

function normalizePhase(value) {
  const phase = PHASE_ALIASES[value] || value;
  return TCN_PHASES.includes(phase) ? phase : 'rest';
}

function normalizeQuality(value) {
  const quality = QUALITY_ALIASES[value] || value;
  return TCN_QUALITIES.includes(quality) ? quality : 'good';
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

export async function loadTrainingDataset(filePath, { windowSize = 30 } = {}) {
  const text = await readFile(filePath, 'utf8');
  const rows = parseMotionDatasetJsonl(text);
  const samples = rows.map((row) => {
    const features = extractMotionFeatureWindow(row.frames || {});
    const vectors = features.map((frame) => frame.featureVector);
    const quality = normalizeQuality(row.label);
    const phase = normalizePhase(row.phaseLabels?.at(-1) || row.frames?.at(-1)?.phase || 'rest');
    return { row, vectors, phase, quality };
  }).filter((sample) => sample.vectors.length);
  const featureSize = Math.max(1, ...samples.flatMap((sample) => sample.vectors.map((vector) => vector.length)));
  return {
    rows,
    samples: samples.map((sample) => ({
      ...sample,
      window: padWindow(sample.vectors, windowSize, featureSize),
      phaseOneHot: oneHot(sample.phase, TCN_PHASES),
      qualityOneHot: oneHot(sample.quality, TCN_QUALITIES),
    })),
    featureSize,
    windowSize,
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
  const dataset = await loadTrainingDataset(args.input, { windowSize: args.windowSize });
  if (!dataset.samples.length) throw new Error('Dataset has no usable motion samples.');

  const summary = {
    ok: true,
    rows: dataset.rows.length,
    samples: dataset.samples.length,
    windowSize: dataset.windowSize,
    featureSize: dataset.featureSize,
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
    inputShape: [dataset.windowSize, dataset.featureSize],
    phases: TCN_PHASES,
    qualities: TCN_QUALITIES,
    datasetRows: dataset.rows.length,
    trainedAt: new Date().toISOString(),
    exerciseScope: [...new Set(dataset.rows.map((row) => row.exerciseId).filter(Boolean))],
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
