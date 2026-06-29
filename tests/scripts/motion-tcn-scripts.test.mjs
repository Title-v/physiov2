import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
    label: 'good_rep',
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
  assert.equal(summary.samples, 1);
  assert.equal(summary.windowSize, 4);
  assert.equal(summary.featureSize > 0, true);
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
    '--dry-run',
  ], cwd);
  const summary = JSON.parse(stdout);

  assert.equal(summary.ok, true);
  assert.equal(summary.sourceType, 'tfjs');
  assert.equal(summary.model.format, 'layers-model');
  assert.equal(summary.manifest.version, 'test-v1');
  assert.deepEqual(summary.manifest.inputShape, [4, 9]);
});
