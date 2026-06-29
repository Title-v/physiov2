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
  assert.equal(summary.windowSize, 4);
  assert.equal(summary.landmarkSchemaId, 'right_arm.v1');
  assert.equal(summary.featureSize > 0, true);
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
    '--input-shape', '4,9',
    '--landmark-schema-id', 'right_arm.v1',
    '--dry-run',
  ], cwd);
  const summary = JSON.parse(stdout);

  assert.equal(summary.ok, true);
  assert.equal(summary.sourceType, 'tfjs');
  assert.equal(summary.model.format, 'layers-model');
  assert.equal(summary.manifest.version, 'test-v1');
  assert.deepEqual(summary.manifest.inputShape, [4, 9]);
  assert.equal(summary.manifest.landmarkSchemaId, 'right_arm.v1');
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
  assert.equal(features.schema, 'physioai.motion_features.v1');
  assert.equal(features.samples.length, 1);

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
        unstable: 0.74,
      },
    },
  }));
  await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({
    name: 'motion-tcn',
    version: 'local-test',
    modelPath: './model.json',
    landmarkSchemaId: 'right_arm.v1',
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
