# PhysioAI Integration Guide

> Developer/Codex implementation guide. This file explains exactly what to change, where to change it, and how to verify it.

## 0. Purpose

Use this guide together with `PRODUCTION_ROADMAP.md`.

- `PRODUCTION_ROADMAP.md` = master product and architecture roadmap.
- `integration.md` = concrete engineering checklist and file-by-file implementation plan.

This guide focuses on the current codebase and the next production-readiness steps.

## 1. Current stack

From the audited repo:

- Framework: Next.js.
- UI/runtime: browser JavaScript modules.
- Pose model: MediaPipe PoseLandmarker.
- Persistence: localStorage + cloud sync via API/Supabase.
- Patient app: `apps/patient/app.js`.
- Therapist capture: `src/app/therapist/capture/captureController.js`.
- Shared motion code: `shared/ai/*`, `shared/practice/*`, `shared/core/*`.
- Verification: `npm run verify` plus motion and patient-live scripts.

## 2. Implementation priority

Do not start with 3D angles or a large refactor. First stabilize what affects perceived accuracy.

Priority order:

1. Add smoothing.
2. Remove fake fallback angles.
3. Add visibility/missing-joint metadata.
4. Separate `poseScore` and `pathScore`.
5. Add invalid reason tests.
6. Add exercise metadata.
7. Add reference validation.
8. Refactor `captureController.js`.
9. Refactor patient runtime.
10. Add TCN/TensorFlow.js pipeline.

## 3. Phase 1 — Stable motion foundation

### 3.1 Add landmark smoothing

Create new file:

```txt
shared/ai/LandmarkFilters.js
```

Initial implementation should use EMA because it is simple, fast, and safe.

Suggested API:

```js
export function createEmaLandmarkFilter({ alpha = 0.55, minVisibility = 0.35 } = {}) {
  let previous = null;

  function reset() {
    previous = null;
  }

  function smooth(landmarks) {
    if (!Array.isArray(landmarks)) {
      previous = null;
      return landmarks;
    }

    if (!previous || previous.length !== landmarks.length) {
      previous = landmarks.map((p) => p ? { ...p } : p);
      return previous;
    }

    const out = landmarks.map((p, i) => {
      const old = previous[i];
      if (!p || !old || (p.visibility ?? 1) < minVisibility) return p;
      return {
        ...p,
        x: old.x + alpha * (p.x - old.x),
        y: old.y + alpha * (p.y - old.y),
        z: (old.z ?? 0) + alpha * ((p.z ?? 0) - (old.z ?? 0)),
        visibility: p.visibility,
      };
    });

    previous = out.map((p) => p ? { ...p } : p);
    return out;
  }

  return { smooth, reset };
}
```

Integration options:

Option A — Filter in `PoseDetection.js`:

```js
const filter = createEmaLandmarkFilter();
const res = state.video.detectForVideo(videoEl, ts);
if (res?.landmarks?.[0]) res.landmarks[0] = filter.smooth(res.landmarks[0]);
return res;
```

Option B — Filter in practice/capture loops:

- Better if therapist capture and patient practice need separate filter state.
- Add filter state in `apps/patient/app.js` practice runtime.
- Add filter state in `captureController.js` state.

Recommended first step: Option B to avoid changing global engine behavior.

Files to modify:

- `shared/ai/LandmarkFilters.js` new
- `shared/practice/frame.js`
- `apps/patient/app.js`
- `src/app/therapist/capture/captureController.js`

Verify:

- Live angles should be visibly less jittery.
- Rapid motion should still reach target.
- Reset filter when camera stops, exercise changes, or reference capture restarts.

### 3.2 Remove fake shoulder fallback

File:

```txt
shared/ai/JointAngleCalculator.js
```

Current issue:

- `fallbackKp()` creates artificial shoulder ray point using `y + 0.25`.
- In PT scoring, fake points can produce misleading angles.

Change:

- Disable fake fallback by default.
- Return `null` when required points are not visible.
- Report missing points in metadata.

Suggested change:

```js
function fallbackKp() {
  return null;
}
```

Then add detailed API instead of silently guessing:

```js
export function jointAngleCalculatorDetailed(landmarks, { minVisibility = MIN_VIS } = {}) {
  const angles = {};
  const meta = {
    minVisibility,
    missingByJoint: {},
    visibleByJoint: {},
    usableJoints: [],
    unusableJoints: [],
  };

  for (const s of JOINT_SPECS) {
    const points = {
      a: visibleKp(landmarks, s.a),
      b: visibleKp(landmarks, s.b),
      c: visibleKp(landmarks, s.c),
    };

    const missing = [];
    if (!points.a) missing.push(s.a);
    if (!points.b) missing.push(s.b);
    if (!points.c) missing.push(s.c);

    if (missing.length) {
      angles[s.joint] = null;
      meta.missingByJoint[s.joint] = missing;
      meta.unusableJoints.push(s.joint);
      continue;
    }

    angles[s.joint] = angleAt(points.a, points.b, points.c);
    meta.usableJoints.push(s.joint);
  }

  meta.usableJointRatio = JOINT_SPECS.length ? meta.usableJoints.length / JOINT_SPECS.length : 0;
  return { angles, meta };
}

export function jointAngleCalculator(landmarks) {
  return jointAngleCalculatorDetailed(landmarks).angles;
}
```

Verify:

- Existing imports still work.
- Low-visibility frames do not create shoulder angles.
- Tests cover missing shoulder/hip/knee/ankle landmarks.

### 3.3 Add optional 3D angle function, but do not enable globally

File:

```txt
shared/ai/JointAngleCalculator.js
```

Add:

```js
export function angleAt3D(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = (a.z ?? 0) - (b.z ?? 0);
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = (c.z ?? 0) - (b.z ?? 0);

  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const m1 = Math.sqrt(v1x ** 2 + v1y ** 2 + v1z ** 2);
  const m2 = Math.sqrt(v2x ** 2 + v2y ** 2 + v2z ** 2);

  if (m1 < 1e-6 || m2 < 1e-6) return null;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  const deg = Math.acos(cos) * 180 / Math.PI;
  return Number.isFinite(deg) ? deg : null;
}
```

Do not switch all scoring to 3D yet. MediaPipe `z` is estimated depth, not real depth-camera data. Use only when an exercise has:

```js
allow3D: true
```

Recommended status: prepare API now, enable later after validation.

### 3.4 Separate `poseScore` and `pathScore`

File:

```txt
shared/ai/MotionQualityEngine.js
```

Current issue:

```js
const pathScore = scored.score;
const poseScore = scored.score;
```

Target behavior:

- `poseScore`: current live joint angles vs expected angles at current progress.
- `pathScore`: how closely the movement follows the recorded trajectory/sequence over time.

Add helper:

```js
function scorePathProgress(liveProgress, expectedProgress, tolerance = 0.15) {
  if (!Number.isFinite(liveProgress) || !Number.isFinite(expectedProgress)) return 0;
  const delta = Math.abs(liveProgress - expectedProgress);
  return scoreClamp((1 - delta / Math.max(0.01, tolerance)) * 100);
}
```

Better path score should compare live frame sequence against reference sequence:

```js
function scoreTrajectoryFrame(liveAngles, reference, progress, joints) {
  const expectedFrame = expectedFrameForProgress(reference?.referenceSequence, progress);
  if (!expectedFrame?.angles) return null;
  return scoreAngles(liveAngles, expectedFrame.angles, reference, joints);
}
```

Implementation target:

```js
const poseScored = scoreAngles(jointAngles, expectedAngles, scoringReference, scoringJoints);
const trajectoryScored = scoreTrajectoryFrame(jointAngles, scoringReference, progress ?? 0, scoringJoints);

const poseScore = poseScored.score;
const pathScore = trajectoryScored?.score ?? poseScore;
```

Then later improve by comparing a time window, not just one frame.

Add invalid reason:

```js
if (pathScore < motionThresholds.validScore) reasons.push('wrong_path');
```

Verify:

- A movement that reaches the final target but skips the correct path should receive lower path score.
- Existing clean rep test still passes.

### 3.5 Add visibility score to MotionQualityEngine

Inputs should allow:

```js
motionEngine.pushFrame({
  timestamp,
  landmarks,
  jointAngles,
  angleMeta,
  boundary,
});
```

Frame score should include:

```js
visibilityScore: scoreClamp((angleMeta?.usableJointRatio ?? scored.visibleRatio ?? 0) * 100)
```

Invalid reason:

```js
if (visibleJointRatio < motionThresholds.visibleJointRatio) reasons.push('low_visibility');
```

This reason already exists partially; make it more reliable by feeding angle metadata.

## 4. Phase 2 — Exercise metadata

File:

```txt
shared/core/exercises.js
```

Add production metadata fields to every built-in exercise.

Example:

```js
{
  id: 'shoulder',
  key: 'shoulder',
  icon: 'body',
  accent: '#7BA88F',
  primaryJoint: 'right_shoulder',
  bodyRegion: 'right_arm',
  dir: 'up',
  target: 158,
  rest: 22,
  tol: 15,
  reps: 12,
  sets: 3,
  holdSec: 1.5,
  type: 'rep',

  cameraOrientation: 'front',
  recommendedCameraDistanceM: [1.5, 3.0],
  recommendedCameraHeight: 'chest',
  requiredJoints: ['right_shoulder', 'right_elbow', 'right_hip'],
  optionalJoints: ['right_wrist'],
  minVisibility: 0.6,
  minUsableJointRatio: 0.8,
  minROMDeg: 15,
  minRepMs: 600,
  maxRepMs: 12000,
  movementPlane: 'frontal',
  scoringProfile: 'upper_limb_rom',
  feedbackProfile: 'simple_patient',
  allow3D: false,
  allowMirror: true,
  allowSeated: true,
  contraindicationNote: '',
}
```

Add helper:

```js
export function scoringProfileForExercise(ex = {}) {
  return ex.scoringProfile || 'default_rep';
}
```

Update these files to consume metadata:

- `shared/ai/BoundaryBoxGate.js`
- `shared/ai/MotionQualityEngine.js`
- `shared/core/patient-exercises.js`
- `src/app/therapist/capture/captureController.js`

## 5. Phase 3 — Reference validation

Create:

```txt
shared/ai/ReferenceSchema.js
shared/validation/referenceValidation.js
```

Reference schema target:

```js
export const CURRENT_REFERENCE_VERSION = 3;

export function normalizeReferenceSchema(ref) {
  if (!ref) return null;
  return {
    referenceVersion: ref.referenceVersion || 1,
    scoringVersion: ref.scoringVersion || 1,
    kind: ref.kind,
    exerciseId: ref.exerciseId,
    bodyRegion: ref.bodyRegion,
    movementPattern: ref.movementPattern,
    repJoints: ref.repJoints || ref.scoringJoints || [],
    primaryJoints: ref.primaryJoints || ref.repJoints || [],
    scoringJoints: ref.scoringJoints || ref.repJoints || [],
    jointMotion: ref.jointMotion || {},
    referenceSequence: ref.referenceSequence || null,
    targetJointAngles: ref.targetJointAngles || ref.jointAngles || null,
    restJointAngles: ref.restJointAngles || null,
    capturedAt: ref.capturedAt || null,
    quality: ref.quality || null,
    raw: ref,
  };
}
```

Reference validation target:

```js
export function validateReferenceQuality(ref, exercise = {}) {
  const issues = [];
  const warnings = [];

  if (!ref?.kind) issues.push('missing_kind');
  if (!ref?.repJoints?.length && !ref?.scoringJoints?.length) issues.push('missing_scoring_joints');
  if (exercise.type !== 'hold' && !ref?.referenceSequence?.frames?.length) issues.push('missing_reference_sequence');

  const frames = ref?.referenceSequence?.frames || [];
  if (frames.length && frames.length < 8) issues.push('too_few_frames');

  return {
    ok: issues.length === 0,
    issues,
    warnings,
  };
}
```

Use before `saveReference()` in therapist capture.

## 6. Phase 4 — Refactor therapist capture

Current large file:

```txt
src/app/therapist/capture/captureController.js
```

Do not refactor before Phase 1 scoring changes are stable.

Target split:

```txt
src/app/therapist/capture/
  captureController.js      # orchestration only
  captureState.js           # state object and transitions
  sequenceRecorder.js       # start/stop/trim/markers
  referenceSaver.js         # save hold/motion/alternating references
  previewController.js      # clip preview playback and marker controls
  captureUI.js              # render helpers
```

### 6.1 `captureState.js`

Move:

- State object `S`.
- Initial default state.
- State reset helpers.
- Mode changes.

### 6.2 `sequenceRecorder.js`

Move:

- `maybeRecordSequenceFrame()`
- `startSequenceRecording()`
- `stopSequenceRecording()`
- `toggleSequenceRecording()`
- `pendingSequenceIndexes()`
- `inferSequenceTargetIndex()`
- `trimPendingSequence()`

Add:

- `discardNoisyFrames()`
- `autoTrimRestTargetRest()`
- `scoreReferenceQuality()`

### 6.3 `referenceSaver.js`

Move:

- `persistReference()`
- `saveHoldReference()`
- `saveMotionReference()`
- `saveSequenceReference()`
- `saveDetectedPose()`

Add:

- `validateReferenceQuality()` before save.
- Reference schema normalization.

### 6.4 `previewController.js`

Move:

- Clip preview rendering.
- Playback.
- Marker jump/set helpers.
- Export JSON.

### 6.5 `captureUI.js`

Move:

- Reusable UI component functions.
- Button labels.
- Status text.
- Score ring updates.

Exit criteria:

- Current behavior preserved.
- `captureController.js` becomes mostly `mountTherapistCapture()` orchestration.
- New modules can be tested without DOM where possible.

## 7. Phase 5 — Patient runtime refactor

File:

```txt
apps/patient/app.js
```

Problems:

- Auth, API, UI, practice runtime, camera, and session save live together.
- Shared API/auth should be reused.

Target split:

```txt
apps/patient/
  app.js                 # route/app orchestration
  patientState.js        # state
  patientApi.js          # thin wrapper around shared API
  patientScreens.js      # render screens
  practiceRuntime.js     # camera/model/frame loop
  sessionSync.js         # save/retry sessions
```

First extraction should be `practiceRuntime.js`, because it is the most important for motion stability.

Practice runtime target API:

```js
export function createPatientPracticeRuntime({
  poseEngine,
  exercise,
  reference,
  planItems,
  onSnapshot,
  onSummary,
  onError,
}) {
  return {
    start(video, canvas),
    stop(),
    reset(),
    isRunning(),
  };
}
```

## 8. Phase 6 — Supabase and API hardening

Current observed client behavior:

- Shared `api.js` uses token from localStorage.
- Shared `auth.js` handles therapist login/register.
- Patient app currently has its own API/auth wrapper.
- Store sync pushes references/plans/sessions through API helpers.

Required production work:

1. Centralize API/auth logic.
2. Add request timeout.
3. Add role-specific auth wrappers.
4. Validate payloads server-side.
5. Add RLS tests.
6. Version references and sessions.

Suggested route test matrix:

```txt
/auth/login
/auth/register
/auth/me
/auth/resend-verification
/plans
/references
/sessions
/patients
```

Each endpoint must be tested for:

- unauthenticated request
- patient role
- therapist role
- linked therapist/patient
- unlinked therapist/patient
- malformed payload

## 9. Phase 7 — Dataset and TCN pipeline

Do this after Phase 1-5 are stable.

### 9.1 Dataset format

Create dataset rows as JSONL:

```json
{
  "version": 1,
  "exerciseId": "shoulder",
  "label": "good_rep",
  "phaseLabels": ["rest", "moving", "target", "returning"],
  "frames": [
    {
      "t": 0,
      "landmarks": [[0.1, 0.2, 0.0, 0.99]],
      "angles": { "right_shoulder": 30 }
    }
  ],
  "source": "therapist_capture",
  "subjectId": "anon_001"
}
```

### 9.2 Feature vector

Recommended features per frame:

- Normalized landmarks: x, y, z, visibility.
- Joint angles for tracked joints.
- Angle velocity.
- Progress estimate.
- Boundary/visibility flags.

### 9.3 TCN output

Initial output:

```js
{
  phase: 'rest' | 'moving_to_target' | 'target' | 'returning',
  quality: 'good' | 'incomplete' | 'wrong_path' | 'unstable' | 'out_of_frame',
  confidence: 0.0
}
```

### 9.4 Runtime integration

Create:

```txt
shared/ai/ModelRegistry.js
shared/ai/TcnMotionClassifier.js
shared/ai/MotionFeatureExtractor.js
```

Do not block rule-based scoring if model fails.

```js
const aiSignal = await classifier.predict(windowFeatures).catch(() => null);
const snapshot = motionEngine.pushFrame({ ...frame, aiSignal });
```

## 10. Verification plan

Run after every implementation step:

```bash
npm run test
npm run verify:motion
npm run verify:patient-live
npm run verify
```

Add tests:

```txt
tests/joint-angle-calculator.test.mjs
tests/landmark-filters.test.mjs
tests/boundary-box-gate.test.mjs
tests/reference-validation.test.mjs
tests/practice-session.test.mjs
```

### 10.1 Joint angle tests

Cases:

- 90 degree angle.
- 180 degree angle.
- missing point returns null.
- low visibility returns null.
- shoulder fallback no longer creates fake angle.
- detailed metadata includes missing joints.

### 10.2 Smoothing tests

Cases:

- first frame passes through.
- second frame is smoothed.
- reset clears state.
- low visibility does not poison previous state.

### 10.3 Motion engine tests

Cases:

- clean rep valid.
- incomplete target no rep or invalid rep.
- out-of-frame invalid.
- low visibility invalid.
- wrong path invalid.
- too fast invalid.
- too slow invalid.
- alternating cycle valid.
- hold stable valid.
- hold unstable invalid.

## 11. Codex task checklist

### P0 — Do first

- [x] Create `shared/ai/LandmarkFilters.js`.
- [x] Add EMA landmark filter.
- [x] Wire smoothing into patient practice runtime.
- [x] Wire smoothing into therapist capture runtime.
- [x] Reset smoothing on camera stop/exercise change/reference recording restart.
- [x] Remove fake `fallbackKp()` behavior from `JointAngleCalculator.js`.
- [x] Add `jointAngleCalculatorDetailed()`.
- [x] Keep `jointAngleCalculator()` backward-compatible.
- [x] Pass angle metadata through `shared/practice/frame.js`.
- [x] Add visibility score to `MotionQualityEngine.js`.
- [x] Separate `poseScore` and `pathScore`.
- [x] Add `wrong_path` invalid reason.
- [x] Add tests for missing landmarks.
- [x] Add tests for smoothing.
- [x] Add tests for wrong path.
- [x] Run `npm run verify`.

### P1 — Do next

- [x] Add exercise metadata to `shared/core/exercises.js`.
- [x] Update `BoundaryBoxGate.js` to use exercise `requiredJoints` and `minVisibility`.
- [x] Update `patient-exercises.js` to use metadata for setup copy and overlay joints.
- [x] Add `ReferenceSchema.js`.
- [x] Add `referenceValidation.js`.
- [x] Validate reference before save.
- [x] Add `sessionVersion` to session payloads.
- [x] Add score breakdown to session payloads.
- [x] Add API timeout/retry for safe GET requests.
- [x] Centralize patient/therapist auth client.

### P2 — Refactor

- [x] Create `captureState.js`.
- [x] Create `sequenceRecorder.js`.
- [x] Create `referenceSaver.js`.
- [x] Create `previewController.js`.
- [x] Create `captureUI.js`.
- [x] Reduce `captureController.js` to orchestration.
- [x] Extract patient `practiceRuntime.js`.
- [x] Extract patient `sessionSync.js`.
- [x] Add tests for extracted modules.

### P3 — AI

- [x] Define dataset JSONL schema.
- [x] Add dataset export from therapist capture.
- [x] Add `MotionFeatureExtractor.js`.
- [x] Add TCN training script outside frontend runtime.
- [x] Convert model to TensorFlow.js.
- [x] Add `ModelRegistry.js`.
- [x] Add lazy model loading.
- [x] Fuse AI signal with rule-based scoring.

## 12. Migration rules

Never break existing saved references or plans.

Rules:

1. Always keep `referenceVersion` and `scoringVersion`.
2. Add migrations for older references.
3. Do not remove old fields until migration is proven.
4. Keep `jointAngleCalculator()` return shape as plain angles.
5. Add new detailed API instead of changing all callers at once.
6. Treat localStorage data as untrusted input and normalize it.

## 13. Recommended first Codex prompt

Use this prompt:

```txt
Read PRODUCTION_ROADMAP.md and integration.md. Implement Phase 1 P0 only.
Do not refactor captureController yet. Create LandmarkFilters.js, add EMA smoothing,
remove fake angle fallback, add jointAngleCalculatorDetailed(), pass angle metadata through
practice frames, separate poseScore/pathScore minimally, add tests, and run npm run verify.
Preserve backward compatibility.
```

## 14. Done criteria for Phase 1

Phase 1 is done when:

- Smoothing exists and is reset correctly.
- Missing landmarks do not create fake angles.
- Angle metadata is available.
- Motion engine uses visibility metadata.
- `poseScore` and `pathScore` can diverge.
- New tests pass.
- Existing tests pass.
- `npm run verify` passes.
