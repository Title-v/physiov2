# PhysioAI AI-First v3

This note captures the implementation decisions from `Implementationv3.md` in
repo-native terms.

## Decisions

- Built-in exercises are starter templates and demo fallback metadata.
- Real patient accounts are plan-first; demo extras are only for guest/demo
  sessions.
- AI is the primary motion-quality judge when an approved, schema-compatible
  model produces high-confidence output.
- Rule-based logic is the safety/data-quality gate and fallback path.
- Motion model input is body-region schema based, not full 33 landmarks by
  default.
- Training v1 requires both primary and stabilizer landmarks.
- Optional landmarks are excluded from model input v1.
- `out_of_frame` is data quality, not a motion quality class.
- Unlabeled, draft, skipped, or auto-rejected rows must never train as `good`.
- JS feature extraction is the source of truth for Keras training feature order.

## Implemented Foundation

- `shared/ai/BodyRegionLandmarkSchema.js`
- `shared/ai/MotionSafetyGate.js`
- `shared/ai/RepCounter.js`
- `shared/ai/MotionDatasetRecorder.js`
- `shared/ai/DatasetLabeler.js`
- Schema-aware `shared/ai/BoundaryBoxGate.js`
- Schema-aware `shared/ai/MotionFeatureExtractor.js`
- Reviewed/trainable dataset rows in `shared/ai/MotionDataset.js`
- Strict reviewed-label validation and sliding windows in
  `scripts/train-motion-tcn.mjs`
- Keras feature bridge and publishing scripts:
  - `scripts/build-motion-features.mjs`
  - `scripts/publish-motion-model.mjs`
  - `training/train_motion_tcn_keras.py`
  - `training/evaluate_motion_tcn_keras.py`
- Training feature generation uses deterministic train/validation splits, and
  model training writes evaluation metadata for approval checks.
- Keras evaluation prefers the held-out validation split when present, and
  publishing refuses approval from reports that explicitly evaluate all samples.
- Therapist Capture Dataset workflow panels for readiness, recording, review,
  and reviewed JSONL export.
- Therapist Capture AI exercise setup now derives an actionable step model:
  schema, reference, dataset readiness, model deployment, and validation.
- Therapist Capture validation can run the shared motion processor with the
  deployed model classifier when a compatible model is available.
- Patient home is plan-first for real sessions; built-in extras are demo-only.
- Patient practice can use AI phase transitions as the primary rep/session
  summary path, with rule-based rep counting retained as fallback.
- Practice session payloads are version 3 and include `scoreSource` plus
  AI-quality score breakdown fields.
- `/datasets` and `/ai-models` routes persist reviewed dataset rows and model
  manifest metadata through the shared API/Supabase runtime.

## Runtime Policy

Safety always gates scoring:

```txt
missing primary/stabilizer, low visibility, out of frame, or schema mismatch
→ no AI score
→ show camera/data-quality guidance
```

AI model use requires:

```txt
manifest.approved === true
exercise.landmarkSchemaId === manifest.landmarkSchemaId
confidence >= threshold
```

When AI is usable:

```txt
finalScore = aiQualityScore * 0.85 + referenceRuleScore * 0.15
```

AI phase labels are used for primary rep counting:

```txt
rest → moving_to_target → target → returning → rest = 1 rep
```

The completed session summary uses `scoreSource: "ai_primary"` only after the
AI phase counter completes a rep. If no approved/confident AI phase cycle
completes, the summary falls back to rule-based reps with `scoreSource: "rule"`.

When AI is unavailable or low confidence:

```txt
finalScore = referenceRuleScore
```

## Remaining Work

- Add richer dataset review playback controls.
- Convert/publish a real trained TFJS model and validate it in browser.
- Tune dataset minimums, approval thresholds, and AI confidence using real
  recorded patient/therapist data.
- Move from local JSONL/export-driven training to an operational training job
  when deployment requirements are clear.
