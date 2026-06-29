#!/usr/bin/env node

import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TCN_PHASES, TCN_QUALITIES } from '../shared/ai/TcnMotionClassifier.js';
import { getBodyRegionLandmarkSchema, modelManifestSchemaFields } from '../shared/ai/BodyRegionLandmarkSchema.js';

function parseArgs(argv) {
  const args = {
    fromTfjs: null,
    fromKeras: null,
    out: 'shared/models/motion-tcn',
    version: null,
    inputShape: null,
    landmarkSchemaId: 'right_arm.v1',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from-tfjs') args.fromTfjs = argv[++i];
    else if (arg === '--from-keras') args.fromKeras = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--input-shape') args.inputShape = argv[++i].split(',').map((value) => Number(value.trim()));
    else if (arg === '--landmark-schema-id') args.landmarkSchemaId = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/convert-motion-tcn-model.mjs --from-tfjs path/to/tfjs-model --out shared/models/motion-tcn',
    '  node scripts/convert-motion-tcn-model.mjs --from-keras path/to/model.keras --out shared/models/motion-tcn',
    '',
    'Options:',
    '  --version NAME          Model version written into manifest',
    '  --input-shape 30,139    Optional [window, feature] shape override',
    '  --landmark-schema-id ID Body-region schema, default right_arm.v1',
    '  --dry-run               Validate inputs and print planned manifest without copying/converting',
  ].join('\n');
}

async function exists(filePath) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readTfjsModelSummary(modelDir) {
  const modelPath = path.join(modelDir, 'model.json');
  const modelJson = JSON.parse(await readFile(modelPath, 'utf8'));
  const weights = Array.isArray(modelJson.weightsManifest)
    ? modelJson.weightsManifest.flatMap((group) => group.paths || [])
    : [];
  return {
    modelPath,
    format: modelJson.format || 'layers-model',
    generatedBy: modelJson.generatedBy || null,
    convertedBy: modelJson.convertedBy || null,
    weightFiles: weights,
  };
}

async function runConverter(fromKeras, outDir) {
  await new Promise((resolve, reject) => {
    const child = spawn('tensorflowjs_converter', ['--input_format', 'keras', fromKeras, outDir], {
      stdio: 'inherit',
    });
    child.on('error', (err) => reject(new Error([
      'tensorflowjs_converter is required for --from-keras conversion.',
      'Install tensorflowjs in a training environment, or provide --from-tfjs with an already converted model.',
      `Original error: ${err.message}`,
    ].join('\n'))));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tensorflowjs_converter exited with code ${code}`));
    });
  });
}

export async function prepareMotionTcnModel(args) {
  if (!args.fromTfjs && !args.fromKeras) throw new Error('Provide --from-tfjs or --from-keras.');
  if (args.fromTfjs && args.fromKeras) throw new Error('Use only one source: --from-tfjs or --from-keras.');

  const source = args.fromTfjs || args.fromKeras;
  if (!await exists(source)) throw new Error(`Model source does not exist: ${source}`);

  const version = args.version || new Date().toISOString().replace(/[:.]/g, '-');
  const planned = {
    ok: true,
    sourceType: args.fromTfjs ? 'tfjs' : 'keras',
    source,
    out: args.out,
    version,
    dryRun: args.dryRun,
  };

  if (args.dryRun) {
    if (args.fromTfjs) planned.model = await readTfjsModelSummary(args.fromTfjs);
    planned.manifest = buildManifest({ version, inputShape: args.inputShape, landmarkSchemaId: args.landmarkSchemaId });
    console.log(JSON.stringify(planned, null, 2));
    return planned;
  }

  await mkdir(args.out, { recursive: true });
  if (args.fromTfjs) {
    await cp(args.fromTfjs, args.out, { recursive: true });
  } else {
    await runConverter(args.fromKeras, args.out);
  }
  const summary = await readTfjsModelSummary(args.out);
  const manifest = buildManifest({ version, inputShape: args.inputShape, summary, landmarkSchemaId: args.landmarkSchemaId });
  await writeFile(path.join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ...planned, dryRun: false, model: summary, manifest }, null, 2));
  return planned;
}

function buildManifest({ version, inputShape = null, summary = null, landmarkSchemaId = 'right_arm.v1' } = {}) {
  const schema = getBodyRegionLandmarkSchema(landmarkSchemaId);
  return {
    name: 'motion-tcn',
    version,
    modelPath: './model.json',
    ...modelManifestSchemaFields(schema),
    inputShape: Array.isArray(inputShape) && inputShape.length ? inputShape : null,
    phases: TCN_PHASES,
    qualities: TCN_QUALITIES,
    exerciseScope: [],
    accuracy: null,
    approved: false,
    exportedAt: new Date().toISOString(),
    modelFormat: summary?.format || 'tfjs-layers-model',
    weightFiles: summary?.weightFiles || [],
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
  } else {
    prepareMotionTcnModel(args).catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
}
