#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelManifestSchemaFields, resolveBodyRegionLandmarkSchema } from '../shared/ai/BodyRegionLandmarkSchema.js';
import { evaluateModelApproval } from '../shared/ai/ModelApprovalCriteria.js';
import { expectedMotionFeatureSizeForSchema } from '../shared/ai/MotionFeatureExtractor.js';
import { TCN_PHASES, TCN_QUALITIES } from '../shared/ai/TcnMotionClassifier.js';

function parseArgs(argv) {
  const args = {
    model: null,
    out: 'shared/models/motion-tcn',
    evaluation: null,
    approve: false,
    version: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--model') args.model = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--evaluation') args.evaluation = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--approve') args.approve = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/publish-motion-model.mjs --model path/to/tfjs-model --out shared/models/motion-tcn',
    '',
    'The source model directory must contain model.json and manifest.json with landmarkSchemaId.',
    'Pass --evaluation training/artifacts/evaluation.json before --approve to enforce approval criteria.',
  ].join('\n');
}

async function readManifest(modelDir) {
  const manifest = JSON.parse(await readFile(path.join(modelDir, 'manifest.json'), 'utf8'));
  if (!manifest.landmarkSchemaId) throw new Error('Model manifest is missing landmarkSchemaId.');
  const schema = resolveBodyRegionLandmarkSchema(manifest.landmarkSchemaId, { fallback: false });
  if (!schema) throw new Error(`Model manifest uses unknown landmarkSchemaId: ${manifest.landmarkSchemaId}.`);
  const schemaFields = modelManifestSchemaFields(schema);
  for (const key of ['modelInputLandmarks', 'primaryRequiredLandmarks', 'stabilizerRequiredLandmarks', 'jointNames']) {
    if (!Array.isArray(manifest[key]) || !manifest[key].length) {
      throw new Error(`Model manifest is missing ${key}.`);
    }
    if (JSON.stringify(manifest[key]) !== JSON.stringify(schemaFields[key])) {
      throw new Error(`Model manifest ${key} does not match ${manifest.landmarkSchemaId}.`);
    }
  }
  if (manifest.bodyRegion && manifest.bodyRegion !== schemaFields.bodyRegion) {
    throw new Error(`Model manifest bodyRegion does not match ${manifest.landmarkSchemaId}.`);
  }
  if (!Array.isArray(manifest.inputShape) || manifest.inputShape.length !== 2) {
    throw new Error('Model manifest is missing inputShape [window, feature].');
  }
  const expectedFeatureSize = expectedMotionFeatureSizeForSchema({ landmarkSchema: schema });
  if (!Number.isInteger(Number(manifest.inputShape[0])) || Number(manifest.inputShape[0]) <= 0) {
    throw new Error('Model manifest inputShape window must be a positive integer.');
  }
  if (Number(manifest.inputShape[1]) !== expectedFeatureSize) {
    throw new Error(`Model manifest inputShape feature size ${manifest.inputShape[1]} does not match ${manifest.landmarkSchemaId} feature size ${expectedFeatureSize}.`);
  }
  return manifest;
}

async function readEvaluation(filePath) {
  if (!filePath) return null;
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
  return payload.evaluation || payload.metrics || payload;
}

function sameStringArray(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

export async function publishMotionModel(args) {
  if (!args.model) throw new Error('Missing --model path/to/tfjs-model');
  const manifest = await readManifest(args.model);
  if (!sameStringArray(manifest.phases, TCN_PHASES)) {
    throw new Error('Model manifest phases do not match the supported TCN phase schema.');
  }
  if (!sameStringArray(manifest.qualities, TCN_QUALITIES)) {
    throw new Error('Model manifest qualities do not match the supported TCN quality schema.');
  }
  const evaluation = await readEvaluation(args.evaluation) || manifest.evaluation || manifest.accuracy || null;
  if (args.approve && evaluation?.evaluatedSplit && evaluation.evaluatedSplit !== 'validation') {
    throw new Error(`Cannot approve model: evaluation must use validation split, got ${evaluation.evaluatedSplit}.`);
  }
  const approval = evaluation
    ? evaluateModelApproval({ evaluation })
    : (manifest.approval || evaluateModelApproval({ evaluation: {} }));
  if (args.approve && approval.ok !== true) {
    throw new Error(`Cannot approve model: ${(approval.issues || ['approval_failed']).join(', ')}`);
  }
  const publishedManifest = {
    ...manifest,
    version: args.version || manifest.version,
    evaluation,
    approved: args.approve ? true : manifest.approved === true,
    approval,
    publishedAt: new Date().toISOString(),
  };
  const summary = {
    ok: true,
    source: args.model,
    out: args.out,
    landmarkSchemaId: publishedManifest.landmarkSchemaId,
    inputShape: publishedManifest.inputShape,
    approved: publishedManifest.approved,
    dryRun: args.dryRun,
  };
  if (!args.dryRun) {
    await mkdir(args.out, { recursive: true });
    await cp(args.model, args.out, { recursive: true });
    await writeFile(path.join(args.out, 'manifest.json'), `${JSON.stringify(publishedManifest, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else {
    publishMotionModel(args).catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
}
