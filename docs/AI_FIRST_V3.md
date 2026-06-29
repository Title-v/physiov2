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
- Therapist Capture Dataset workflow panels for readiness, recording, review,
  and reviewed JSONL export.
- Patient home is plan-first for real sessions; built-in extras are demo-only.

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

When AI is unavailable or low confidence:

```txt
finalScore = referenceRuleScore
```

## Remaining Work

- Store dataset rows and model versions through real API/Supabase routes.
- Add full therapist AI exercise wizard and model validation panel.
- Add richer dataset review playback controls.
- Add minimum dataset size and model approval criteria checks.
- Convert/publish a real trained TFJS model and validate it in browser.
