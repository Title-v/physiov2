#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateModelApproval } from '../shared/ai/ModelApprovalCriteria.js';

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
  if (!Array.isArray(manifest.inputShape) || manifest.inputShape.length !== 2) {
    throw new Error('Model manifest is missing inputShape [window, feature].');
  }
  return manifest;
}

async function readEvaluation(filePath) {
  if (!filePath) return null;
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
  return payload.evaluation || payload.metrics || payload;
}

export async function publishMotionModel(args) {
  if (!args.model) throw new Error('Missing --model path/to/tfjs-model');
  const manifest = await readManifest(args.model);
  const evaluation = await readEvaluation(args.evaluation) || manifest.evaluation || manifest.accuracy || null;
  const approval = manifest.approval || evaluateModelApproval({ evaluation: evaluation || {} });
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
