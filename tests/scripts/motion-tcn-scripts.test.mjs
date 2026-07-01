import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function runPython(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('python3', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

test('train-motion-tcn dry-run validates JSONL dataset and feature shape without TensorFlow', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-tcn-'));
  const datasetPath = path.join(dir, 'dataset.jsonl');
  const row = {
    version: 1,
    exerciseId: 'shoulder',
    label: 'good',
    motionLabel: 'good',
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    scoreable: true,
    repComplete: true,
    completionSource: 'rule_completed_rep',
    landmarkSchemaId: 'right_arm.v1',
    bodyRegion: 'right_arm',
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    missingPrimary: [],
    missingStabilizer: [],
    phaseLabels: ['rest_start', 'target', 'rest_end'],
    frames: [
      { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20 }, boundaryStatus: 'inside' },
      { t: 100, landmarks: [[0.2, 0.2, 0, 0.9]], angles: { right_shoulder: 80 }, boundaryStatus: 'inside' },
      { t: 200, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20 }, boundaryStatus: 'inside' },
    ],
    source: 'test',
    subjectId: 'anon_test',
  };
  await writeFile(datasetPath, `${JSON.stringify(row)}\n`);

  const { stdout } = await runNode([
    'scripts/train-motion-tcn.mjs',
    '--input', datasetPath,
    '--out', path.join(dir, 'model'),
    '--window-size', '4',
    '--dry-run',
  ], cwd);
  const summary = JSON.parse(stdout);

  assert.equal(summary.ok, true);
  assert.equal(summary.rows, 1);
  assert.equal(summary.validRows, 1);
  assert.equal(summary.invalidRows, 0);
  assert.equal(summary.samples, 1);
  assert.equal(summary.trainSamples, 1);
  assert.equal(summary.validationSamples, 0);
  assert.equal(summary.windowSize, 4);
  assert.equal(summary.landmarkSchemaId, 'right_arm.v1');
  assert.equal(summary.featureSize > 0, true);
});

test('train-motion-tcn dry-run creates deterministic train validation splits', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-tcn-split-'));
  const datasetPath = path.join(dir, 'dataset.jsonl');
  const baseRow = {
    version: 1,
    exerciseId: 'shoulder',
    label: 'good',
    motionLabel: 'good',
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    scoreable: true,
    repComplete: true,
    completionSource: 'rule_completed_rep',
    landmarkSchemaId: 'right_arm.v1',
    bodyRegion: 'right_arm',
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    missingPrimary: [],
    missingStabilizer: [],
    phaseLabels: ['target'],
    frames: [
      { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20 }, phase: 'target', boundaryStatus: 'inside' },
      { t: 100, landmarks: [[0.2, 0.2, 0, 0.9]], angles: { right_shoulder: 80 }, phase: 'target', boundaryStatus: 'inside' },
    ],
    source: 'test',
  };
  const rows = Array.from({ length: 4 }, (_, index) => ({
    ...baseRow,
    subjectId: `anon_${index + 1}`,
  }));
  await writeFile(datasetPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

  const { stdout } = await runNode([
    'scripts/train-motion-tcn.mjs',
    '--input', datasetPath,
    '--out', path.join(dir, 'model'),
    '--window-size', '2',
    '--validation-ratio', '0.25',
    '--dry-run',
  ], cwd);
  const summary = JSON.parse(stdout);

  assert.equal(summary.samples, 4);
  assert.equal(summary.trainSamples, 3);
  assert.equal(summary.validationSamples, 1);
  assert.equal(summary.split.trainByQuality.good, 3);
  assert.equal(summary.split.validationByQuality.good, 1);
  assert.equal(summary.split.validationByPhase.target, 1);
});

test('train-motion-tcn rejects unlabeled or non-reviewed rows by default', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-tcn-reject-'));
  const datasetPath = path.join(dir, 'dataset.jsonl');
  const row = {
    version: 1,
    exerciseId: 'shoulder',
    label: 'unlabeled',
    motionLabel: null,
    labelStatus: 'draft',
    dataQuality: 'usable',
    trainable: false,
    landmarkSchemaId: 'right_arm.v1',
    missingPrimary: [],
    missingStabilizer: [],
    frames: [
      { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20 }, boundaryStatus: 'inside' },
    ],
  };
  await writeFile(datasetPath, `${JSON.stringify(row)}\n`);

  await assert.rejects(
    () => runNode([
      'scripts/train-motion-tcn.mjs',
      '--input', datasetPath,
      '--out', path.join(dir, 'model'),
      '--dry-run',
    ], cwd),
    /invalid_or_unlabeled_motion_label/,
  );
});

test('train-motion-tcn rejects reviewed rows with unknown landmark schema', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-tcn-unknown-schema-'));
  const datasetPath = path.join(dir, 'dataset.jsonl');
  const row = {
    version: 1,
    exerciseId: 'shoulder',
    label: 'good',
    motionLabel: 'good',
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    scoreable: true,
    repComplete: true,
    completionSource: 'rule_completed_rep',
    landmarkSchemaId: 'made_up.v1',
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    missingPrimary: [],
    missingStabilizer: [],
    frames: [
      { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20 }, boundaryStatus: 'inside' },
    ],
  };
  await writeFile(datasetPath, `${JSON.stringify(row)}\n`);

  await assert.rejects(
    () => runNode([
      'scripts/train-motion-tcn.mjs',
      '--input', datasetPath,
      '--out', path.join(dir, 'model'),
      '--dry-run',
    ], cwd),
    /unknown_landmarkSchemaId/,
  );
});

test('convert-motion-tcn dry-run validates existing TFJS model directory and planned manifest', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-convert-'));
  const modelDir = path.join(dir, 'tfjs-model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    generatedBy: 'unit-test',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));

  const { stdout } = await runNode([
    'scripts/convert-motion-tcn-model.mjs',
    '--from-tfjs', modelDir,
    '--out', path.join(dir, 'out'),
    '--version', 'test-v1',
    '--input-shape', '4,27',
    '--landmark-schema-id', 'right_arm.v1',
    '--dry-run',
  ], cwd);
  const summary = JSON.parse(stdout);

  assert.equal(summary.ok, true);
  assert.equal(summary.sourceType, 'tfjs');
  assert.equal(summary.model.format, 'layers-model');
  assert.equal(summary.manifest.version, 'test-v1');
  assert.deepEqual(summary.manifest.inputShape, [4, 27]);
  assert.equal(summary.manifest.landmarkSchemaId, 'right_arm.v1');
});

test('convert-motion-tcn rejects input shape that does not match schema feature size', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-convert-shape-reject-'));
  const modelDir = path.join(dir, 'tfjs-model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));

  await assert.rejects(
    () => runNode([
      'scripts/convert-motion-tcn-model.mjs',
      '--from-tfjs', modelDir,
      '--out', path.join(dir, 'out'),
      '--input-shape', '4,28',
      '--landmark-schema-id', 'right_arm.v1',
      '--dry-run',
    ], cwd),
    /does not match right_arm\.v1 feature size 27/,
  );
});

test('build-motion-features and publish-motion-model preserve schema metadata', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-features-'));
  const datasetPath = path.join(dir, 'dataset.jsonl');
  const featuresPath = path.join(dir, 'features.json');
  const row = {
    version: 1,
    exerciseId: 'shoulder',
    label: 'good',
    motionLabel: 'good',
    labelStatus: 'reviewed',
    dataQuality: 'usable',
    trainable: true,
    scoreable: true,
    repComplete: true,
    completionSource: 'rule_completed_rep',
    landmarkSchemaId: 'right_arm.v1',
    bodyRegion: 'right_arm',
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    missingPrimary: [],
    missingStabilizer: [],
    phaseLabels: ['rest', 'moving_to_target', 'target', 'returning'],
    frames: [
      { t: 0, landmarks: [[0.1, 0.2, 0, 0.9]], angles: { right_shoulder: 20, right_elbow: 150 }, phase: 'rest', boundaryStatus: 'inside' },
      { t: 100, landmarks: [[0.2, 0.2, 0, 0.9]], angles: { right_shoulder: 80, right_elbow: 130 }, phase: 'target', boundaryStatus: 'inside' },
    ],
  };
  await writeFile(datasetPath, `${JSON.stringify(row)}\n`);

  const built = await runNode([
    'scripts/build-motion-features.mjs',
    '--input', datasetPath,
    '--out', featuresPath,
    '--window-size', '4',
  ], cwd);
  const buildSummary = JSON.parse(built.stdout);
  const features = JSON.parse(await readFile(featuresPath, 'utf8'));
  assert.equal(buildSummary.landmarkSchemaId, 'right_arm.v1');
  assert.equal(buildSummary.trainSamples, 1);
  assert.equal(buildSummary.validationSamples, 0);
  assert.equal(features.schema, 'physioai.motion_features.v1');
  assert.equal(features.samples.length, 1);
  assert.equal(features.samples[0].split, 'train');

  const modelDir = path.join(dir, 'model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));
  const evaluationPath = path.join(dir, 'evaluation.json');
  await writeFile(evaluationPath, JSON.stringify({
    evaluation: {
      phaseAccuracy: 0.91,
      qualityAccuracy: 0.86,
      perLabelRecall: {
        good: 0.91,
        incomplete: 0.82,
        wrong_path: 0.78,
        unstable: 0.75,
      },
      falseGoodRate: 0.04,
    },
  }));
  await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({
    name: 'motion-tcn',
    version: 'local-test',
    modelPath: './model.json',
    bodyRegion: features.bodyRegion,
    landmarkSchemaId: 'right_arm.v1',
    modelInputLandmarks: features.modelInputLandmarks,
    primaryRequiredLandmarks: features.primaryRequiredLandmarks,
    stabilizerRequiredLandmarks: features.stabilizerRequiredLandmarks,
    jointNames: features.jointNames,
    inputShape: [4, features.inputShape[1]],
    phases: features.phases,
    qualities: features.qualities,
  }));

  const published = await runNode([
    'scripts/publish-motion-model.mjs',
    '--model', modelDir,
    '--evaluation', evaluationPath,
    '--out', path.join(dir, 'published'),
    '--approve',
    '--dry-run',
  ], cwd);
  const publishSummary = JSON.parse(published.stdout);
  assert.equal(publishSummary.landmarkSchemaId, 'right_arm.v1');
  assert.equal(publishSummary.approved, true);
});

test('evaluate-motion-tcn-keras dry-run prefers held-out validation split', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-keras-eval-split-'));
  const featuresPath = path.join(dir, 'features.json');
  const payload = {
    schema: 'physioai.motion_features.v1',
    landmarkSchemaId: 'right_arm.v1',
    inputShape: [2, 2],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable'],
    samples: [
      { split: 'train', window: [[0, 0], [1, 1]], phaseOneHot: [1, 0, 0, 0], qualityOneHot: [1, 0, 0, 0] },
      { split: 'train', window: [[1, 0], [1, 1]], phaseOneHot: [0, 1, 0, 0], qualityOneHot: [0, 1, 0, 0] },
      { split: 'validation', window: [[0, 1], [1, 1]], phaseOneHot: [0, 0, 1, 0], qualityOneHot: [0, 0, 1, 0] },
    ],
  };
  await writeFile(featuresPath, JSON.stringify(payload));

  const validation = await runPython([
    'training/evaluate_motion_tcn_keras.py',
    '--model', path.join(dir, 'model.keras'),
    '--features', featuresPath,
    '--dry-run',
  ], cwd);
  const all = await runPython([
    'training/evaluate_motion_tcn_keras.py',
    '--model', path.join(dir, 'model.keras'),
    '--features', featuresPath,
    '--use-all-samples',
    '--dry-run',
  ], cwd);

  const validationSummary = JSON.parse(validation.stdout);
  const allSummary = JSON.parse(all.stdout);
  assert.equal(validationSummary.evaluatedSplit, 'validation');
  assert.equal(validationSummary.trainSamples, 2);
  assert.equal(validationSummary.validationSamples, 1);
  assert.equal(validationSummary.evaluatedSamples, 1);
  assert.equal(allSummary.evaluatedSplit, 'all');
  assert.equal(allSummary.evaluatedSamples, 3);
});

test('export-keras-to-tfjs dry-run builds manifest from feature and evaluation metadata', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-keras-export-'));
  const featuresPath = path.join(dir, 'features.json');
  const evaluationPath = path.join(dir, 'evaluation.json');
  await writeFile(featuresPath, JSON.stringify({
    schema: 'physioai.motion_features.v1',
    landmarkSchemaId: 'right_arm.v1',
    bodyRegion: 'right_arm',
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    inputShape: [4, 27],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable'],
    samples: [],
  }));
  await writeFile(evaluationPath, JSON.stringify({
    evaluation: {
      evaluatedSplit: 'validation',
      phaseAccuracy: 0.92,
      qualityAccuracy: 0.86,
      perLabelRecall: { good: 0.9, incomplete: 0.9, wrong_path: 0.9, unstable: 0.9 },
      falseGoodRate: 0.04,
    },
    approval: { ok: true, issues: [] },
  }));

  const exported = await runPython([
    'training/export_keras_to_tfjs.py',
    '--model', path.join(dir, 'model.keras'),
    '--features', featuresPath,
    '--evaluation', evaluationPath,
    '--out', path.join(dir, 'out'),
    '--version', 'keras-test-v1',
    '--dry-run',
  ], cwd);
  const summary = JSON.parse(exported.stdout);

  assert.equal(summary.ok, true);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.manifest.version, 'keras-test-v1');
  assert.equal(summary.manifest.landmarkSchemaId, 'right_arm.v1');
  assert.deepEqual(summary.manifest.inputShape, [4, 27]);
  assert.equal(summary.manifest.approved, false);
  assert.equal(summary.manifest.approval.ok, true);
  assert.equal(summary.manifest.evaluation.falseGoodRate, 0.04);
});

test('publish-motion-model rejects incomplete schema manifest metadata', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-publish-reject-'));
  const modelDir = path.join(dir, 'model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));
  await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({
    name: 'motion-tcn',
    version: 'local-test',
    modelPath: './model.json',
    landmarkSchemaId: 'right_arm.v1',
    inputShape: [4, 25],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable'],
  }));

  await assert.rejects(
    () => runNode([
      'scripts/publish-motion-model.mjs',
      '--model', modelDir,
      '--out', path.join(dir, 'published'),
      '--dry-run',
    ], cwd),
    /missing modelInputLandmarks/,
  );
});

test('publish-motion-model rejects manifest input shape that does not match schema feature size', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-publish-shape-reject-'));
  const modelDir = path.join(dir, 'model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));
  await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({
    name: 'motion-tcn',
    version: 'local-test',
    modelPath: './model.json',
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    inputShape: [4, 28],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable'],
  }));

  await assert.rejects(
    () => runNode([
      'scripts/publish-motion-model.mjs',
      '--model', modelDir,
      '--out', path.join(dir, 'published'),
      '--dry-run',
    ], cwd),
    /feature size 28 does not match right_arm\.v1 feature size 27/,
  );
});

test('publish-motion-model rejects out-of-frame as a motion quality class', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-publish-quality-reject-'));
  const modelDir = path.join(dir, 'model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));
  await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({
    name: 'motion-tcn',
    version: 'local-test',
    modelPath: './model.json',
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    inputShape: [4, 27],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable', 'out_of_frame'],
  }));

  await assert.rejects(
    () => runNode([
      'scripts/publish-motion-model.mjs',
      '--model', modelDir,
      '--out', path.join(dir, 'published'),
      '--dry-run',
    ], cwd),
    /qualities do not match/,
  );
});

test('publish-motion-model evaluates current metrics instead of trusting stale manifest approval', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-publish-stale-approval-'));
  const modelDir = path.join(dir, 'model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));
  await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({
    name: 'motion-tcn',
    version: 'local-test',
    modelPath: './model.json',
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    inputShape: [4, 27],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable'],
    approval: { ok: true },
  }));
  const evaluationPath = path.join(dir, 'bad-evaluation.json');
  await writeFile(evaluationPath, JSON.stringify({
    evaluation: {
      phaseAccuracy: 0.92,
      qualityAccuracy: 0.76,
      perLabelRecall: { good: 0.9, incomplete: 0.9, wrong_path: 0.9, unstable: 0.9 },
      falseGoodRate: 0.04,
    },
  }));

  await assert.rejects(
    () => runNode([
      'scripts/publish-motion-model.mjs',
      '--model', modelDir,
      '--evaluation', evaluationPath,
      '--out', path.join(dir, 'published'),
      '--approve',
      '--dry-run',
    ], cwd),
    /quality_accuracy_below_threshold/,
  );
});

test('publish-motion-model refuses approval from non-validation evaluation split', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'physioai-publish-all-split-reject-'));
  const modelDir = path.join(dir, 'model');
  await mkdir(modelDir);
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    weightsManifest: [{ paths: ['weights.bin'], weights: [] }],
  }));
  await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({
    name: 'motion-tcn',
    version: 'local-test',
    modelPath: './model.json',
    bodyRegion: 'right_arm',
    landmarkSchemaId: 'right_arm.v1',
    modelInputLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder', 'right_hip'],
    primaryRequiredLandmarks: ['right_shoulder', 'right_elbow', 'right_wrist'],
    stabilizerRequiredLandmarks: ['left_shoulder', 'right_hip'],
    jointNames: ['right_shoulder', 'right_elbow'],
    inputShape: [4, 27],
    phases: ['rest', 'moving_to_target', 'target', 'returning'],
    qualities: ['good', 'incomplete', 'wrong_path', 'unstable'],
  }));
  const evaluationPath = path.join(dir, 'all-evaluation.json');
  await writeFile(evaluationPath, JSON.stringify({
    evaluation: {
      evaluatedSplit: 'all',
      phaseAccuracy: 0.92,
      qualityAccuracy: 0.86,
      perLabelRecall: { good: 0.9, incomplete: 0.9, wrong_path: 0.9, unstable: 0.9 },
      falseGoodRate: 0.04,
    },
  }));

  await assert.rejects(
    () => runNode([
      'scripts/publish-motion-model.mjs',
      '--model', modelDir,
      '--evaluation', evaluationPath,
      '--out', path.join(dir, 'published'),
      '--approve',
      '--dry-run',
    ], cwd),
    /validation split/,
  );
});
