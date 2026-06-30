#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTrainingDataset } from './train-motion-tcn.mjs';
import { TCN_PHASES, TCN_QUALITIES } from '../shared/ai/TcnMotionClassifier.js';
import { modelManifestSchemaFields } from '../shared/ai/BodyRegionLandmarkSchema.js';

function parseArgs(argv) {
  const args = {
    input: null,
    out: 'training/features/motion-features.json',
    windowSize: 30,
    stride: 5,
    validationRatio: 0.2,
    skipUnlabeled: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--window-size') args.windowSize = Number(argv[++i]);
    else if (arg === '--stride') args.stride = Number(argv[++i]);
    else if (arg === '--validation-ratio') args.validationRatio = Number(argv[++i]);
    else if (arg === '--skip-unlabeled') args.skipUnlabeled = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/build-motion-features.mjs --input dataset.jsonl --out training/features/motion-features.json',
    '',
    'Builds schema-based sliding-window features using shared JS feature order.',
  ].join('\n');
}

export async function buildMotionFeatures(args) {
  if (!args.input) throw new Error('Missing --input dataset.jsonl');
  const dataset = await loadTrainingDataset(args.input, {
    windowSize: args.windowSize,
    stride: args.stride,
    validationRatio: args.validationRatio,
    skipUnlabeled: args.skipUnlabeled,
  });
  const payload = {
    schema: 'physioai.motion_features.v1',
    builtAt: new Date().toISOString(),
    sourceDataset: args.input,
    inputShape: [dataset.windowSize, dataset.featureSize],
    phases: TCN_PHASES,
    qualities: TCN_QUALITIES,
    ...modelManifestSchemaFields(dataset.schema),
    rows: dataset.rows.length,
    validRows: dataset.validRows.length,
    invalidRows: dataset.invalidRows.length,
    split: dataset.split,
    validationRatio: dataset.validationRatio,
    samples: dataset.samples.map((sample) => ({
      exerciseId: sample.row.exerciseId,
      phase: sample.phase,
      quality: sample.quality,
      split: sample.split,
      window: sample.window,
      phaseOneHot: sample.phaseOneHot,
      qualityOneHot: sample.qualityOneHot,
    })),
  };
  const summary = {
    ok: true,
    out: args.out,
    rows: payload.rows,
    validRows: payload.validRows,
    invalidRows: payload.invalidRows,
    samples: payload.samples.length,
    trainSamples: dataset.trainSamples.length,
    validationSamples: dataset.validationSamples.length,
    split: dataset.split,
    inputShape: payload.inputShape,
    landmarkSchemaId: payload.landmarkSchemaId,
    dryRun: args.dryRun,
  };
  if (!args.dryRun) {
    await mkdir(path.dirname(args.out), { recursive: true });
    await writeFile(args.out, `${JSON.stringify(payload)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
  return { payload, summary };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else {
    buildMotionFeatures(args).catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
}
