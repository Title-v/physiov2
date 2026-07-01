# PhysioAI AI-First Implementation Plan

This is the committed source of truth for the AI-first motion workflow.

## Locked Decisions

- Built-in exercises are templates/demo fallback, not production truth.
- Therapist-created plan references and reviewed datasets are the real product data.
- Body-region schema is canonical for boundary, safety, features, datasets, manifests, and runtime.
- Primary and stabilizer landmarks are required for v1 training/scoring.
- Motion labels v1 are `good`, `incomplete`, `wrong_path`, and `unstable`.
- Data-quality failures such as `out_of_frame`, `low_visibility`, and missing landmarks are not motion labels.
- Unlabeled, draft, skipped, auto-rejected, partial, or manual-stop rows must never train as `good`.
- AI scoring is primary only when an approved schema-compatible model is confident; safety always wins.

## Training Gates

Rows are trainable only when all are true:

- `labelStatus === "reviewed"`
- `trainable === true`
- `repComplete === true`
- `dataQuality === "usable"`
- `motionLabel` is a v1 motion label
- schema metadata matches `BodyRegionLandmarkSchema`
- `missingPrimary` and `missingStabilizer` are empty

## Approval Gates

Recommended model approval criteria:

- phase accuracy >= 0.90
- quality accuracy >= 0.85
- per-label recall >= 0.75
- false-good rate <= 0.05

False-good rate is the share of bad reps (`incomplete`, `wrong_path`, `unstable`)
that are predicted as `good`.

## Keras Flow

1. Build JS-source-of-truth features with `npm run features:tcn`.
2. Train Keras with `npm run train:tcn:keras`.
3. Evaluate with `npm run evaluate:tcn:keras`.
4. Export Keras to TFJS with `npm run export:tcn:keras`.
5. Publish with `npm run publish:tcn`; use `--approve` only when approval gates pass.
