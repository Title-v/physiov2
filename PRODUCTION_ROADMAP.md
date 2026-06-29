# PhysioAI Production Roadmap

> Master roadmap for turning the current PhysioAI prototype into a production-grade physical-therapy motion assessment platform.

## 0. Audit scope

This roadmap is based on an audit of the reachable core repository files through the GitHub connector:

- `README.md`
- `package.json`
- `shared/ai/PoseDetection.js`
- `shared/ai/JointAngleCalculator.js`
- `shared/ai/MotionQualityEngine.js`
- `shared/ai/MultiJointMotion.js`
- `shared/ai/BoundaryBoxGate.js`
- `shared/core/exercises.js`
- `shared/core/patient-exercises.js`
- `shared/core/store.js`
- `shared/core/api.js`
- `shared/core/auth.js`
- `shared/practice/frame.js`
- `shared/practice/session.js`
- `apps/patient/app.js`
- `src/app/therapist/capture/captureController.js`
- `scripts/verify-motion-quality-engine.mjs`

The current repo already has a useful shared architecture, a patient app, a therapist app, Supabase-backed API integration, local fallback, reference capture, motion scoring, and verification scripts. Production work should improve reliability and clinical trust rather than restart the project.

## 1. Product vision

PhysioAI should become a web-based physical-therapy assistant that allows therapists to create exercise plans and motion references, then allows patients to practice at home with real-time posture, range-of-motion, repetition, and quality feedback.

Production goals:

1. Real-time camera-based exercise guidance.
2. Therapist-created custom references.
3. Reliable scoring for simple rep and hold exercises.
4. Clear invalid-rep reasons.
5. Cloud sync between therapist and patient.
6. Safe, explainable feedback.
7. Future-ready AI pipeline for TCN / TensorFlow.js.

Non-goals for early production:

- Medical diagnosis.
- Fully autonomous treatment decisions.
- Replacing therapist judgement.
- Complex multi-person tracking.
- Full 3D biomechanics without validation.

## 2. Current architecture summary

Current high-level flow:

```txt
Camera
  -> MediaPipe PoseLandmarker
  -> 33 landmarks
  -> JointAngleCalculator
  -> BoundaryBoxGate
  -> MotionQualityEngine
  -> PracticeFrameProcessor
  -> Patient / Therapist UI
  -> Store / API / Supabase
```

Current strengths:

- Shared AI logic exists under `shared/ai`.
- Patient and therapist surfaces import the same shared motion logic.
- Therapist capture supports full motion cycle recording.
- Motion engine supports rep, hold, and alternating-cycle references.
- Supabase/API integration already exists through shared API helpers and backend route contract.
- `npm run verify` already groups API, static route, motion quality, and patient-live checks.

Current risks:

- Pose detection lacks a dedicated smoothing layer.
- Joint angles are currently 2D-only, even though landmarks include `z`.
- Shoulder fallback can create artificial points and false confidence.
- `poseScore` and `pathScore` are currently not conceptually separated enough.
- `captureController.js` is too large and mixes UI, state, recording, validation, preview, and persistence.
- Exercise metadata is too light for production safety.
- Patient app duplicates some auth/API logic instead of using a shared client.
- More tests are needed around angle calculation, visibility, boundary behavior, reference migration, and session payloads.

## 3. Production architecture target

Target architecture:

```txt
Camera Stream
  -> PoseDetection Engine
  -> Landmark Smoothing Filter
  -> Visibility / Boundary Validator
  -> Joint Angle Calculator
  -> Motion Feature Extractor
  -> Reference Matcher
  -> Motion Quality Engine
  -> Optional TCN Classifier
  -> Feedback Engine
  -> Patient / Therapist UI
  -> Session Logger
  -> Supabase Sync
  -> Analytics Dashboard
```

Target folders:

```txt
shared/
  ai/
    PoseDetection.js
    JointAngleCalculator.js
    MotionQualityEngine.js
    MultiJointMotion.js
    BoundaryBoxGate.js
    LandmarkFilters.js              # new
    MotionFeatureExtractor.js        # new
    FeedbackEngine.js                # new
    ReferenceSchema.js               # new
    ModelRegistry.js                 # future
  core/
    exercises.js
    patient-exercises.js
    api.js
    auth.js
    store.js
    config.js                        # new
  practice/
    frame.js
    session.js
    runtime.js                       # future
  validation/
    referenceValidation.js           # new
    clinicalRules.js                 # future
apps/
  patient/
    app.js
src/app/
  therapist/
    capture/
      captureController.js
      captureState.js                # new
      sequenceRecorder.js            # new
      referenceSaver.js              # new
      previewController.js           # new
      captureUI.js                   # new
scripts/
  verify-*.mjs
supabase/
  migrations/
```

## 4. Milestones

### Phase 0 — Repo hardening

Goal: document and stabilize the current system.

Deliverables:

- Add `PRODUCTION_ROADMAP.md`.
- Add `integration.md`.
- Add current architecture notes.
- Add implementation checklist.
- Add Definition of Done.

Exit criteria:

- Developers and Codex can understand the intended architecture without reading every source file.
- All existing checks pass with `npm run verify`.

### Phase 1 — Stable motion foundation

Goal: make the current rule-based system feel stable and trustworthy.

Priority changes:

1. Add landmark / angle smoothing.
2. Remove fake shoulder fallback from joint angles.
3. Add angle metadata: missing joints, visibility, usable ratio.
4. Separate `poseScore` and `pathScore`.
5. Improve invalid reasons.
6. Add more tests.

Main files:

- `shared/ai/PoseDetection.js`
- `shared/ai/JointAngleCalculator.js`
- `shared/ai/MotionQualityEngine.js`
- `shared/practice/frame.js`
- `scripts/verify-motion-quality-engine.mjs`

Exit criteria:

- Live angle values do not visibly jitter under normal lighting.
- Missing landmarks produce `null` / low-visibility reasons, not artificial angles.
- `poseScore` and `pathScore` can differ on a valid-looking but wrong-path movement.
- Verification scripts cover clean, incomplete, out-of-frame, low-visibility, and wrong-path cases.

### Phase 2 — Better therapist capture

Goal: make reference capture reliable and maintainable.

Priority changes:

1. Split `captureController.js` into smaller modules.
2. Add motion trimming and noisy-frame discard.
3. Add auto start / peak / end detection.
4. Add reference quality preview before save.
5. Add reference validation before persistence.
6. Add reference schema versioning and migration.

Main files:

- `src/app/therapist/capture/captureController.js`
- `src/app/therapist/capture/sequenceRecorder.js`
- `src/app/therapist/capture/referenceSaver.js`
- `src/app/therapist/capture/previewController.js`
- `shared/ai/MultiJointMotion.js`
- `shared/ai/ReferenceSchema.js`

Exit criteria:

- `captureController.js` is reduced to orchestration and UI mounting.
- Sequence recording rejects short, noisy, or unclear references.
- Captured references include version, quality score, required joints, and metadata.

### Phase 3 — Exercise metadata and scoring profiles

Goal: move from hard-coded defaults to production exercise definitions.

Add metadata to exercises:

```js
{
  cameraOrientation: 'front',
  cameraSide: 'any',
  recommendedCameraDistanceM: [1.5, 3.0],
  recommendedCameraHeight: 'chest',
  requiredJoints: ['right_shoulder', 'right_elbow', 'right_hip'],
  optionalJoints: ['right_wrist'],
  minVisibility: 0.6,
  minUsableJointRatio: 0.8,
  movementPlane: 'frontal',
  movementPattern: 'unilateral',
  scoringProfile: 'upper_limb_rom',
  feedbackProfile: 'simple_patient',
  minROMDeg: 15,
  minRepMs: 600,
  maxRepMs: 12000,
  allow3D: false,
  allowMirror: true,
  allowSeated: true,
  contraindicationNote: '',
}
```

Main files:

- `shared/core/exercises.js`
- `shared/core/patient-exercises.js`
- `shared/ai/BoundaryBoxGate.js`
- `shared/ai/MotionQualityEngine.js`

Exit criteria:

- Each built-in exercise declares required joints and scoring profile.
- Boundary checks and scoring use exercise metadata instead of duplicated hard-coded maps.
- Patient UI can show setup instructions from metadata.

### Phase 4 — Patient runtime reliability

Goal: make patient practice reliable on real devices.

Priority changes:

1. Extract patient practice runtime from `apps/patient/app.js`.
2. Reuse shared API/auth where possible.
3. Add camera permission/error states.
4. Add degraded-mode behavior when FPS drops.
5. Add session autosave / retry.
6. Add clear UX for missing reference, low light, out-of-frame, and poor visibility.

Main files:

- `apps/patient/app.js`
- `shared/practice/frame.js`
- `shared/practice/session.js`
- `shared/core/api.js`
- `shared/core/auth.js`

Exit criteria:

- Patient runtime has clean start/stop lifecycle.
- Camera and model errors are recoverable.
- Session payloads are consistent and versioned.

### Phase 5 — Cloud data and Supabase production

Goal: make cloud data reliable and secure.

Priority changes:

1. Confirm all API endpoints have role checks.
2. Add RLS policies for therapist-patient relationships.
3. Add schema migrations for references, sessions, plans, model versions, and datasets.
4. Add server-side payload validation.
5. Add audit fields: `created_at`, `updated_at`, `created_by`, `patient_id`, `therapist_id`.
6. Add storage policies for future videos/datasets if used.

Suggested tables:

```txt
profiles
therapist_patients
exercise_library
plans
plan_items
references
practice_sessions
session_frames_summary
ai_models
datasets
model_evaluations
```

Exit criteria:

- No patient can access another patient's plan/reference/session.
- No therapist can modify patients they are not linked to.
- API route tests cover role separation.

### Phase 6 — AI dataset and TCN integration

Goal: add AI-based temporal recognition without replacing rule-based scoring.

Pipeline:

```txt
Video / live camera
  -> MediaPipe landmarks
  -> Normalize landmarks
  -> Smooth landmarks
  -> Joint angles
  -> Feature vector
  -> Temporal window
  -> TCN model
  -> phase / quality / exercise prediction
  -> MotionQualityEngine fusion
```

Initial model use cases:

1. Rep phase detection: rest, moving, target, returning.
2. Motion type recognition.
3. Compensation detection.
4. Quality classification: good, incomplete, unstable, wrong path.

Do not use AI as the only judge in Phase 6. Use AI as an assistant signal combined with deterministic scoring.

Exit criteria:

- TensorFlow.js model loads lazily.
- App continues to work if model fails to load.
- Model registry tracks version, input shape, accuracy, and exercise scope.

### Phase 7 — Clinical beta

Goal: test with real therapists and real users.

Tasks:

1. Define 5-10 supported exercises.
2. Create clinical testing protocol.
3. Compare app scores with therapist ratings.
4. Measure false positives and false negatives.
5. Collect usability feedback.
6. Update thresholds by exercise and population.

Exit criteria:

- Every supported exercise has setup instructions, required joints, scoring profile, and expected failure modes.
- Therapist review confirms feedback is understandable and safe.

### Phase 8 — Commercial production

Goal: production launch readiness.

Tasks:

1. Staging and production environments.
2. Error monitoring.
3. Performance monitoring.
4. Data retention policy.
5. Privacy policy and consent flow.
6. Account management.
7. Backup and recovery.
8. Rollback procedure.

Exit criteria:

- Production deployment can be rolled back.
- User data is protected.
- Logs and monitoring identify camera, model, API, and scoring failures.

## 5. File-by-file audit and improvement plan

### `shared/ai/PoseDetection.js`

Current role:

- Wraps MediaPipe PoseLandmarker.
- Loads local model/WASM with CDN fallback.
- Starts/stops camera.
- Draws skeleton.

Problems:

- No smoothing layer.
- Detection output goes directly to downstream scoring.
- Camera constraints are fixed.
- No performance telemetry beyond caller-side FPS.

Production changes:

- Add `LandmarkFilters.js` with EMA first, One Euro later.
- Add `createSmoothedPoseEngine()` or filter hook after `detectVideo()`.
- Add confidence/visibility summary.
- Add camera config by exercise metadata.
- Expose model load status and error code.

Priority: P0.

### `shared/ai/JointAngleCalculator.js`

Current role:

- Converts 33 landmarks into 12 joint angles.
- Uses 2D angle math.
- Uses virtual midpoints for back/neck.
- Has fallback for shoulder missing point.

Problems:

- 2D-only angles can be wrong when user rotates or moves in depth.
- Shoulder fallback can create a fake angle.
- Output lacks metadata about missing joints and visibility.

Production changes:

- Remove fake fallback by default.
- Add `jointAngleCalculatorDetailed()`.
- Return `{ angles, meta }` where meta includes missing joints and visibility ratio.
- Keep `jointAngleCalculator()` backward-compatible by returning angles only.
- Add optional `angleAt3D()` but keep disabled by default until validated.

Priority: P0 for fallback/meta, P2 for 3D.

### `shared/ai/MotionQualityEngine.js`

Current role:

- Scores rep and hold exercises.
- Supports motion cycles, alternating cycles, and hold poses.
- Aggregates reps and invalid reasons.

Problems:

- `poseScore` and `pathScore` are currently derived from the same angle score.
- Invalid reasons need more clinical specificity.
- Thresholds are mostly engine-level rather than exercise-profile driven.

Production changes:

- Separate pose scoring from trajectory/path scoring.
- Add `romScore`, `stabilityScore`, `symmetryScore`, and `visibilityScore`.
- Add invalid reasons: `wrong_path`, `insufficient_rom`, `unstable_motion`, `low_visibility`, `early_return`, `wrong_side`, `poor_setup`.
- Use exercise scoring profiles.
- Add unit tests for each reason.

Priority: P0.

### `shared/ai/MultiJointMotion.js`

Current role:

- Selects rep joints.
- Builds joint motion models.
- Builds reference trajectories.
- Supports alternating references.

Problems:

- Candidate joint maps are duplicated with exercise/body-region logic elsewhere.
- No explicit reference quality score.
- Some movement-pattern inference may be too simple for production.

Production changes:

- Move body-region joint definitions to a shared config.
- Add reference quality metrics: frame count, duration, visible ratio, ROM, smoothness, boundary ratio.
- Add validation before saving reference.
- Store trajectory schema version.

Priority: P1.

### `shared/ai/BoundaryBoxGate.js`

Current role:

- Validates whether required body points are visible and inside the camera frame.
- Handles region-based key joints.
- Provides hints and draws boundary box.

Problems:

- Visibility threshold is hard-coded.
- Boundary ratio is hard-coded.
- Body-region maps are duplicated with exercises/motion modules.
- Hints are generic.

Production changes:

- Use exercise metadata: required joints, min visibility, expected exits.
- Add graded statuses: `inside`, `soft_outside`, `missing_required`, `too_close`, `too_far`, `low_visibility`.
- Add better patient-facing hints.
- Add temporal debounce for outside streak.

Priority: P1.

### `shared/core/exercises.js`

Current role:

- Seed exercise library.
- Custom exercise persistence in localStorage.
- Body-region helpers.

Problems:

- Built-ins are minimal.
- Fixed default target/rest angles are not enough for production.
- Exercise safety/setup/scoring metadata is missing.
- Custom exercises are local-first with limited schema validation.

Production changes:

- Add production exercise schema.
- Add validation/migration for custom exercises.
- Add `scoringProfile`, `feedbackProfile`, `requiredJoints`, `minVisibility`, `minROM`, camera guidance.
- Move reusable region/joint maps into a shared config module.

Priority: P0/P1.

### `shared/core/patient-exercises.js`

Current role:

- Maps built-in and custom exercises to patient-facing data.
- Generates synthetic preview pose.
- Selects overlay joints.

Problems:

- Synthetic pose is useful for UI but not suitable as a clinical reference.
- Patient copy is hard-coded.
- Some practice preview values fall back to default angles.

Production changes:

- Separate UI preview from practice reference logic.
- Add localized copy from exercise metadata.
- Make missing reference explicit and never treat synthetic preview as scoring reference.
- Use required joints for overlay selection.

Priority: P1.

### `shared/core/store.js`

Current role:

- Local persistence and cloud sync for references, plans, sessions, patients, settings.
- Backward compatibility for older plan/reference shapes.

Problems:

- Local and cloud responsibilities are mixed.
- Reference and session schemas should be versioned.
- LocalStorage is useful for demo but must not be the only production persistence path.

Production changes:

- Split into `localStore.js`, `cloudStore.js`, `referenceStore.js`, `planStore.js`, `sessionStore.js`.
- Add schema validation before saving.
- Add sync conflict policy.
- Add migration for `physioai.v1.*` keys.

Priority: P1.

### `shared/core/api.js`

Current role:

- Same-origin API client with token handling.

Problems:

- Basic fetch wrapper only.
- No timeout/retry.
- No request id.
- Demo/cloud mode can be more explicit.

Production changes:

- Add request timeout.
- Add typed error mapping.
- Add retry only for safe GET requests.
- Add centralized token/session handling shared by patient and therapist.

Priority: P1.

### `shared/core/auth.js`

Current role:

- Therapist auth helper.
- Supports real login and guest demo.

Problems:

- Patient app has separate auth logic.
- Role handling should be shared.

Production changes:

- Create shared `authClient.js` with role-specific wrappers.
- Keep therapist/patient role checks strict.
- Add token expiry handling.
- Add refresh/logout behavior.

Priority: P1.

### `shared/practice/frame.js`

Current role:

- One-frame processing pipeline for practice.
- Evaluates boundary, angles, motion engine, overlay, ghost landmarks.

Problems:

- No smoothing hook.
- No detailed angle metadata.
- No low-visibility policy.

Production changes:

- Accept filtered landmarks.
- Use `jointAngleCalculatorDetailed()`.
- Pass visibility metadata to `MotionQualityEngine`.
- Return structured frame diagnostics.

Priority: P0/P1.

### `shared/practice/session.js`

Current role:

- Builds session payload and summary metrics.

Problems:

- Session payload is simple.
- No schema version.
- Limited analytics fields.

Production changes:

- Add `sessionVersion`.
- Add exercise/reference/scoring version fields.
- Add duration, device, FPS, invalid reason totals, score breakdown.
- Add privacy-safe frame summary, not raw video by default.

Priority: P1.

### `apps/patient/app.js`

Current role:

- Patient auth, plan loading, UI rendering, practice runtime, camera loop, session save.

Problems:

- Large single-file app.
- Duplicates API/auth logic.
- Practice runtime should be extracted.
- Error handling and camera lifecycle need hardening.

Production changes:

- Split into patient runtime modules.
- Reuse shared API/auth.
- Add robust camera permission UX.
- Add offline/retry for session save.
- Add runtime diagnostics.

Priority: P1/P2.

### `src/app/therapist/capture/captureController.js`

Current role:

- Therapist capture UI, state, camera, recording, preview, reference saving, validation.

Problems:

- Very large controller.
- Hard to test.
- Mixed responsibilities.

Production changes:

- Split into `captureState.js`, `sequenceRecorder.js`, `referenceSaver.js`, `previewController.js`, `captureUI.js`.
- Keep current behavior first; refactor after scoring foundation stabilizes.
- Add tests for recorder/reference builder logic.

Priority: P2 after Phase 1 scoring work.

### `scripts/verify-motion-quality-engine.mjs`

Current role:

- Verifies current motion engine behavior.

Problems:

- Good start but lacks cases for low visibility, wrong path, insufficient ROM, smoothing, and reference validation.

Production changes:

- Add golden motion fixtures.
- Add negative cases per invalid reason.
- Add regression tests for backward-compatible references.

Priority: P0/P1.

## 6. Scoring model target

Production scoring should expose:

```js
{
  overallScore,
  poseScore,
  pathScore,
  romScore,
  stabilityScore,
  symmetryScore,
  boundaryScore,
  visibilityScore,
  tempoScore,
  targetReachScore,
  reasons,
  worstJoint,
  jointDeltas,
  phase,
  progressPct
}
```

Suggested weights for early production:

```js
rep: {
  pose: 0.30,
  path: 0.25,
  rom: 0.15,
  stability: 0.10,
  visibility: 0.10,
  boundary: 0.05,
  tempo: 0.05,
}
hold: {
  pose: 0.45,
  stability: 0.20,
  visibility: 0.15,
  boundary: 0.10,
  duration: 0.10,
}
```

These weights should be configurable by exercise profile.

## 7. AI model roadmap

### V1 — Rule-based production

- MediaPipe landmarks.
- Smoothing.
- Joint angles.
- Trajectory matching.
- Explainable scores.

### V2 — TCN assistive classifier

- Input: temporal windows of normalized landmarks + angles.
- Output: phase / quality / compensation class.
- Used as extra signal, not replacement.

### V3 — Personalized thresholds

- Baseline per patient.
- Adaptive ROM targets.
- Therapist-approved progression.

### V4 — Advanced sensing

- Optional 3D angle mode.
- Optional IMU fusion.
- Optional multi-camera / depth camera.

## 8. Data and privacy roadmap

Data classes:

- Account data.
- Therapist-patient link.
- Exercise plans.
- Reference landmarks/angles.
- Session summaries.
- Optional dataset captures.

Principles:

- Store summaries by default, not raw video.
- Raw video requires explicit consent.
- Keep role access strict.
- Keep every model/scoring decision versioned.
- Make delete/export policies explicit.

## 9. Testing strategy

Required test layers:

1. Unit tests:
   - Joint angle math.
   - Visibility handling.
   - Boundary logic.
   - Motion scoring.
   - Session payloads.

2. Integration tests:
   - Therapist capture -> reference save -> patient practice.
   - Plan sync.
   - Reference migration.
   - Auth role separation.

3. Golden motion tests:
   - Clean rep.
   - Too fast.
   - Too slow.
   - Incomplete ROM.
   - Wrong path.
   - Low visibility.
   - Out of frame.
   - Alternating left/right.
   - Hold stable/unstable.

4. Performance tests:
   - FPS.
   - Model load time.
   - Memory.
   - Camera loop latency.

## 10. Performance targets

Early production targets:

```txt
Desktop Chrome:       30-60 FPS
Mobile Safari/Chrome: 20-30 FPS minimum
Frame processing:     < 35ms average
Model load:           < 5s after cache
Motion feedback:      < 100ms perceived delay
Memory:               stable over 15-minute session
```

## 11. Risk register

| Risk | Impact | Mitigation |
|---|---:|---|
| Landmark jitter | Bad feedback | EMA/One Euro smoothing |
| Landmark missing | False angle | Remove fake fallback, report low visibility |
| User rotated | 2D angle error | setup guidance, body-rotation detection, optional 3D later |
| Poor lighting | Missing pose | low-light hint, visibility score |
| Wrong camera distance | Bad boundary | exercise-specific camera guidance |
| Bad therapist reference | Bad patient scoring | reference quality validation before save |
| Overconfident scoring | Safety risk | explainable reasons, therapist oversight |
| Data leakage | High | RLS, role checks, audit tests |
| AI model drift | Medium | model registry and benchmark suite |

## 12. Definition of Done

A production task is done only when:

- Code is implemented.
- Existing `npm run verify` passes.
- New tests cover the change.
- Backward compatibility is considered.
- User-facing errors are handled.
- Reference/session schema changes are versioned.
- Performance is not worse than baseline.
- Documentation is updated.

## 13. Recommended delivery order

1. Add smoothing and detailed angle metadata.
2. Remove fake fallback angles.
3. Separate pose/path scoring.
4. Add invalid reason tests.
5. Add exercise metadata.
6. Add reference validation.
7. Refactor therapist capture.
8. Refactor patient runtime.
9. Harden Supabase/API security.
10. Add TCN model pipeline.
11. Run clinical beta.
12. Prepare production deployment.

## 14. Technical debt backlog

Do not do these first, but keep architecture ready:

- Full 3D angle scoring.
- Kalman filter.
- Transformer-based motion model.
- Multi-camera support.
- Depth-camera support.
- IMU fusion.
- Automatic exercise recognition.
- Apple Vision / Vision Pro support.
- Federated learning.
- Full clinical compliance package.

## 15. Production north star

The first production version should not try to be a perfect biomechanics lab. It should be a stable, explainable, therapist-supervised assistant for a limited number of exercises. The highest-value improvements are stability, visibility correctness, trajectory scoring, exercise metadata, and reliable therapist-patient sync.
