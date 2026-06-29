# PhysioAI Therapist Handover

อัปเดตล่าสุด: 2026-06-28

เอกสารนี้สรุปงานฝั่ง Therapist Web ว่าทำอะไรไปแล้ว เพิ่มอะไรบ้าง และ function สำคัญอยู่ตรงไหน เพื่อให้ส่งต่อหรือกลับมาแก้ต่อได้เร็ว

## ภาพรวมที่ทำไปแล้ว

- เปลี่ยน backend ของ Therapist ให้คุยกับ Supabase ผ่าน Express API แทน local/mock เป็นหลัก
- เพิ่มระบบ Therapist login/register, verify-email handling และ patient link/create ผ่าน Supabase Auth/Profile
- ทำ patient relationship ผ่านตาราง `therapist_patients` เพื่อให้ therapist เห็นเฉพาะ patient ที่ผูกกับตัวเอง
- ทำ cloud sync สำหรับ `plans`, `references`, `sessions` โดยยังมี localStorage เป็น cache/library สำหรับ local/demo
- ปรับ Capture ให้รองรับ custom exercise library: สร้างท่าเองได้ก่อน ยังไม่ต้อง assign patient ทันที
- เพิ่ม two-step capture สำหรับ rep exercise: `Capture rest -> Capture target`
- เพิ่ม motion sequence capture แบบเต็มรอบ: `rest start -> target/peak -> rest end`
- เพิ่ม Motion Clip Editor เพื่อเลือกช่วงคลิปหลัง record แล้วค่อย save
- เพิ่ม preview player/skeleton preview สำหรับดู frame ก่อนเลือก start/target/end
- เพิ่ม JSON export สำหรับ skeleton clip ใช้ประมวลผลต่อได้
- ปรับ ROM Measurement ให้เป็น body region/fine-tune joints แทน preset ROM เดิม
- ปรับ multi-joint scoring ให้ joint ใน body region สำคัญทั้งหมดถูกเก็บและใช้เป็น reference pattern/trajectory ไม่ตัดเป็น static ง่ายเกินไป
- เพิ่ม Vercel deploy note และ Supabase Data API warning ใน `Therapist/README.md`

## ไฟล์หลัก

### Backend

- `Therapist/server.js`
  - Express API สำหรับ Auth, Patients, Plans, References, Sessions
  - ใช้ `@supabase/supabase-js`
  - ใช้ `SUPABASE_SERVICE_ROLE_KEY` เฉพาะฝั่ง server สำหรับ admin create/link patient
  - ห้ามใส่ค่า secret key จริงลง repo

- `Therapist/api/index.js`
  - entrypoint สำหรับ Vercel serverless function

- `Therapist/supabase/migrations/20260626094905_therapist_patient_links.sql`
  - migration สำหรับ patient relationship / Supabase schema เพิ่มเติม

### Therapist UI

- `Therapist/therapist/capture.html`
  - หน้าหลักที่เปลี่ยนเยอะที่สุด: camera, capture reference, motion recording, clip editor, JSON export, add to plan

- `Therapist/therapist/plan.html`
  - Plan Builder: เลือก patient, เพิ่ม exercise, reps/sets/frequency/schedule/notes, save plan ขึ้น cloud

- `Therapist/therapist/dashboard.html`
  - dashboard อ่าน sessions/plan ของ patient ที่ผูกกับ therapist

### Shared Core

- `Therapist/shared/core/api.js`
  - API wrapper, token storage, `apiGet/apiPost/apiPut/apiDelete`

- `Therapist/shared/core/auth.js`
  - therapist auth state/session

- `Therapist/shared/core/auth-ui.js`
  - login/register overlay และ gate `ensureTherapist()`

- `Therapist/shared/core/patients.js`
  - patient roster/link/create/session/plan client helpers

- `Therapist/shared/core/store.js`
  - local cache + cloud sync สำหรับ refs/plans

- `Therapist/shared/core/exercises.js`
  - built-in exercises, custom exercise library, body region metadata

### Motion / Pose

- `Therapist/shared/ai/MultiJointMotion.js`
  - เลือก rep joints, สร้าง motion reference, trajectory, role/weight ต่อ joint

- `Therapist/shared/ai/BoundaryBoxGate.js`
  - ตรวจว่าจุดใน body region อยู่ใน frame/boundary box หรือไม่

- `Therapist/shared/ai/JointAngleCalculator.js`
  - คำนวณ 12 joint angles

- `Therapist/shared/ai/PoseComparator.js`
  - compare live angle กับ reference

## Function map สำคัญ

### Auth / Backend (`Therapist/server.js`)

- `loadDotEnvLocal()`
  - โหลด `.env.local` ฝั่ง Therapist ก่อน start server

- `supabaseReady()`
  - เช็คว่ามี Supabase URL/key พอให้ API ทำงานหรือไม่

- `supabaseClient({ token, admin })`
  - สร้าง Supabase client
  - `admin: true` ใช้ service role เฉพาะฝั่ง server

- `requireSupabase()`
  - middleware กัน endpoint ถ้า env Supabase ไม่พร้อม

- `requireAuth()`
  - อ่าน Bearer token, verify user ผ่าน Supabase Auth, attach `req.auth`

- `requireRole(role)`
  - ใช้บังคับ endpoint เฉพาะ therapist เช่น `/patients`

- `canAccessPatient(req, patientId)`
  - เช็คสิทธิ์ว่าคนเรียกเป็น patient เอง หรือ therapist ที่ link กับ patient นั้นแล้ว

- `targetPatientId(req)`
  - ถ้ามี `patientId` ใน query/body ให้ใช้ค่านั้น ไม่งั้นใช้ user id จาก token
  - สำคัญกับ contract:
    - Therapist ใช้ `/plans?patientId=...`
    - Patient ใช้ `/plans` แล้ว backend infer จาก token patient

- `linkPatientToTherapist(db, therapistId, patient)`
  - upsert ความสัมพันธ์ใน `therapist_patients`

- `cleanPlan(plan, patientId)`
  - normalize plan payload ก่อนเขียน Supabase

- `planFromRow(row)`, `referenceFromRow(row)`, `sessionFromRow(row)`
  - แปลง row จาก Supabase table กลับเป็น object ที่ frontend ใช้

### Backend endpoints (`Therapist/server.js`)

- `POST /auth/register`
  - register therapist/patient
  - ถ้ามี `SUPABASE_SERVICE_ROLE_KEY` จะ admin create user + confirm email ทันที
  - ถ้าไม่มี service role อาจ return `email_confirmation_required`

- `POST /auth/resend-verification`
  - resend signup verification email

- `POST /auth/login`
  - login และคืน `{ token, user }`

- `GET /auth/me`
  - verify token ปัจจุบัน

- `GET /patients`
  - therapist เท่านั้น
  - return เฉพาะ patient ที่ link อยู่ใน `therapist_patients`

- `POST /patients/link`
  - link patient ที่มีอยู่แล้วด้วย email หรือ patient id

- `POST /patients`
  - therapist create patient account แล้ว link ให้ทันที

- `GET /plans`
  - patient อ่าน plan ของตัวเองได้โดยไม่ส่ง patientId
  - therapist อ่าน plan ของ patient ได้เมื่อส่ง `?patientId=...`

- `PUT /plans`
  - upsert treatment plan

- `GET /references`
  - อ่าน reference ของ patient/exercises

- `POST /references`
  - save reference ที่ therapist capture ให้ patient หรือ save library reference ตาม scope

- `DELETE /references`
  - delete reference ราย exercise

- `GET /sessions`
  - therapist อ่าน sessions ของ linked patient
  - patient อ่าน sessions ของตัวเอง

- `POST /sessions`
  - patient app ส่ง session analytics ขึ้น cloud
  - backend เก็บ `data` ทั้ง object เพื่อไม่ตัด field ใหม่ เช่น `overallScore`, `avgMotionScore`, `avgTempoScore`, `invalidRepCount`, `motionIssueCounts`, `repQualityLog`

## Capture page function map (`Therapist/therapist/capture.html`)

### Patient / cloud loading

- `loadPatientData(patientId)`
  - sync plan + references ของ patient จาก cloud แล้ว load reference ปัจจุบัน

- `refreshPatients(preferredId)`
  - ดึง patient list จาก `/patients`
  - เลือก patient ที่ยัง valid
  - ถ้าไม่มี patient จะอยู่ที่ library mode

- `addPatient()`
  - prompt ให้เลือก create patient ใหม่ หรือ link patient เดิม
  - เรียก `createPatient()` หรือ `linkPatient()`

### Boundary / body region

- `boundaryExercise()`
  - สร้าง exercise object ที่ใช้ตรวจ boundary จาก `S.romBodyRegion`

- `currentBoundary(landmarks, { reset })`
  - คำนวณ boundary status จาก landmarks และ body region ที่เลือก

- `updateBoundaryUi(boundary, prefix)`
  - update badge/hint และ disable capture ถ้า body region ยังไม่ framed

- `selectRomBodyRegion(regionId)`
  - ตั้ง body region ใน ROM Measurement
  - auto-select fine-tune joints ของ region เช่น `right_arm -> right_shoulder, right_elbow`

- `toggleOverlayJoint(joint)`
  - fine-tune angle overlay/joints ที่จะวาดและใช้เป็น preferred rep joints

- `candidateRepJointsForExercise(ex, bodyRegion, overlayJoints)`
  - คืน joints ที่ควรใช้เป็น candidate สำหรับ motion scoring ตาม body region และ fine-tune

### Reference capture

- `usesTwoStepReference(ex)`
  - ตัดสินว่า exercise ต้องใช้ flow rest/target หรือ single capture

- `captureButtonText()`
  - เปลี่ยน label ปุ่มตามขั้นตอน เช่น Capture rest, Capture target

- `currentCaptureHint(ex)`
  - ข้อความแนะนำว่าตอนนี้ต้อง capture ขั้นไหน

- `capture()`
  - detect pose จาก video ปัจจุบัน
  - เช็ค boundary
  - คำนวณ jointAngles
  - ส่งไป `saveDetectedPose()`

- `saveDetectedPose({ landmarks, jointAngles, boundary, source })`
  - ถ้าเป็น two-step ส่งต่อ `saveMotionReferenceStep()`
  - ถ้าเป็น single reference ส่งต่อ `saveSingleReference()`

- `saveSingleReference(...)`
  - เก็บ target pose แบบ single endpoint

- `saveMotionReferenceStep(...)`
  - ขั้นที่ 1 เก็บ rest
  - ขั้นที่ 2 เก็บ target
  - ถ้า alternating จะมี left target และ right target
  - สร้าง motion ด้วย `buildReferenceMotion()` หรือ `buildAlternatingReferenceMotion()`

- `saveMotionReference(...)`
  - สร้าง reference object เต็ม
  - เก็บ `restJointAngles`, `targetJointAngles`, `returnRestJointAngles`, `repJoints`, `jointMotion`, `referenceSequence`, `bodyRegion`
  - update custom exercise library ถ้าเป็น custom exercise
  - เรียก `persistReference()`

- `persistReference(ref, successText)`
  - save reference ผ่าน `saveReference()`
  - ถ้ามี patientId จะ POST `/references?patientId=...`
  - ถ้าไม่มี patientId จะ save เป็น library/local scope

### Motion sequence / clip editor

- `startSequenceRecording()`
  - เริ่มอัด motion
  - require ให้เลือก body region ก่อน
  - เก็บ `bodyRegionFlag` และ `angleOverlayJoints` ตอนเริ่มอัด

- `maybeRecordSequenceFrame({ landmarks, jointAngles, boundary, now })`
  - เก็บทุก frame ที่ boundary เป็น `inside`
  - ไม่ compact frame ตอน record

- `stopSequenceRecording()`
  - หยุดอัด
  - reject ถ้า frame น้อยกว่า `SEQUENCE_MIN_FRAMES`
  - infer target frame ด้วย `inferSequenceTargetIndex()`
  - สร้าง `S.pendingSequence`

- `motionClipEditor(lang)`
  - UI เลือก `start rest`, `target/peak`, `end rest`
  - แสดง selected frames, duration, split out/back
  - save ผ่าน `saveSequenceReference()`

- `saveSequenceReference(frames, targetOffset, regionFlag)`
  - สร้าง `motion` จาก frame แรก/target
  - สร้าง `referenceSequence` ด้วย `buildReferenceTrajectory()`
  - save ผ่าน `saveMotionReference()`

- `renderClipPreview()`, `drawClipPreviewFrame()`
  - วาด skeleton preview จาก recorded landmarks
  - preview ใช้ mirror เฉพาะการแสดงผล แต่ JSON export เก็บ raw landmarks

- `toggleClipPlayback()`, `clipPlaybackStep()`, `jumpClipPreview()`
  - คุม play/seek marker ใน preview

### Skeleton JSON export

- `buildSkeletonParameterPayload(sequence)`
  - สร้าง JSON payload schema `physioai.skeleton_clip.v1`
  - มี body region flag, raw MediaPipe landmarks 33 จุด, jointAngles ทุก frame, phase, timing/fps/duration/marker, skeletonConnections

- `phaseForClipFrame(index, targetOffset, totalFrames)`
  - tag phase ของ frame:
    - `rest_start`
    - `outbound`
    - `target`
    - `return`
    - `rest_end`

- `exportSkeletonParameters()`
  - validate ว่ามี pending sequence และเลือก body region แล้ว
  - download JSON ไฟล์ `physioai_skeleton_<exercise>_<timestamp>.json`

### Angle overlay / scoring UI

- `activeOverlayJoints()`
  - joints ที่ active ใน overlay

- `drawPrimaryAngleOverlay(ctx, landmarks, liveAngles)`
  - วาด angle overlay หลาย joint ตาม `activeOverlayJoints()`

- `drawAngleOverlayForJoint(ctx, landmarks, liveAngles, joint, color, includeName)`
  - วาด arc/label ของ joint นั้น

- `updateTable(liveAngles)`
  - update ตาราง 12 joint angles: ref/live/delta/ok

- `toleranceOverride(ex, ref)`
  - ใช้ tolerance ของ jointMotion ถ้ามี ไม่งั้น fallback plan/exercise tol

## Multi-joint motion logic (`Therapist/shared/ai/MultiJointMotion.js`)

- `candidateJoints(bodyRegion)`
  - mapping body region ไปหา candidate joints
  - เช่น `right_arm = right_shoulder, right_elbow`

- `selectRepJoints(restAngles, targetAngles, bodyRegion, side, preferredJoints)`
  - เลือก rep joints จากความต่างของ angle ระหว่าง rest/target
  - ถ้ามี preferred/fine-tune joints จะใช้ joints นั้นเป็นหลัก

- `buildReferenceMotion({ exercise, restAngles, targetAngles, ... })`
  - สร้าง motion reference สำหรับ unilateral/bilateral
  - ตั้ง `repJoints`, `jointMotion`, `dominantJoint`, `primaryJoint`, `restAngle`, `targetAngle`

- `buildAlternatingReferenceMotion(...)`
  - สร้าง motion reference สำหรับซ้าย/ขวาสลับกัน

- `buildReferenceTrajectory({ frames, motion, maxSamples, targetFrameIndex, targetFrameT })`
  - สร้าง trajectory จาก selected frames
  - ตอนนี้ default `maxSamples = null` หมายถึงไม่จำกัด 60 samples แล้ว
  - เก็บ `frames`, `durationMs`, `targetAtMs`, `phases`, `repJoints`

- `assignJointRoles(motion)`
  - แยก role ต่อ joint:
    - `primary_motion`
    - `coordinated_motion`
    - `reference_pattern`
  - ทุก joint ที่อยู่ใน reference ยัง `usedForScoring` และ `usedForTrajectory`

- `applyTrajectoryRanges(motion, frames)`
  - คำนวณ range จริงจาก trajectory ทั้งคลิป ไม่ใช่ดู endpoint อย่างเดียว

## Plan Builder (`Therapist/therapist/plan.html`)

- `refreshPatients(preferredId)`
  - load linked patients

- `loadPatientData(patientId)`
  - sync cloud plan ของ patient แล้ว render

- `addPatient()`
  - create/link patient จากหน้า plan ได้เหมือน capture

- `toggleExercise(id)`
  - add/remove exercise ใน plan

- `planItemDefault(id)`
  - สร้าง item default จาก exercise และ embed custom exercise snapshot ถ้ามี

- `save()`
  - save full plan ผ่าน `savePlanFull(patientId, plan)`
  - cloud save ต้องสำเร็จก่อน toast success

## Store / sync (`Therapist/shared/core/store.js`)

- `saveReference(exerciseId, reference, patientId)`
  - push reference ขึ้น cloud ก่อน แล้วค่อย cache local

- `syncReferencesFromCloud(patientId)`
  - GET `/references?patientId=...` แล้ว cache local

- `getPlanFull(patientId)`
  - return full HEP plan object

- `syncPlanFromCloud(patientId)`
  - GET `/plans?patientId=...` แล้ว normalize/cache

- `syncPatientCloudData(patientId)`
  - sync plan + references พร้อมกัน

- `savePlanFull(patientId, plan)`
  - PUT `/plans?patientId=...` แล้ว cache local

- `getPlan(patientId)` / `savePlan(patientId, exerciseIds)`
  - compatibility layer สำหรับ capture page ที่ยังใช้ array exercise ids

## Patient relationship (`Therapist/shared/core/patients.js`)

- `fetchPatients()`
  - logged in: GET `/patients`
  - not logged in/dev demo: demo patients ถ้า demo enabled

- `linkPatient(emailOrId)`
  - POST `/patients/link`

- `createPatient({ name, email, password })`
  - POST `/patients`
  - return `verificationRequired` ถ้า Supabase ต้อง verify email

- `fetchSessions(patientId)`
  - GET `/sessions?patientId=...`

- `fetchPlan(patientId)`
  - GET `/plans?patientId=...`

## Data ที่ reference เก็บเพิ่ม

Reference ที่ capture จาก Therapist อาจมี field เหล่านี้:

- `bodyRegion`
- `movementPattern`
- `countMode`
- `restJointAngles`
- `targetJointAngles`
- `targetJointAnglesBySide`
- `returnRestJointAngles`
- `restLandmarks`
- `targetLandmarks`
- `targetLandmarksBySide`
- `returnRestLandmarks`
- `repMode`
- `repJoints`
- `primaryJoints`
- `requestedRepJoints`
- `dominantJoint`
- `primaryJoint`
- `jointMotion`
- `jointRoles`
- `sideMotions`
- `referenceSequence`
- `boundaryStatus`
- `boundaryBoxRatio`
- `boundaryWillExit`
- `plan.tol`
- `plan.targetAngle`
- `plan.restAngle`
- `plan.dir`

Patient app ควรอ่าน field พวกนี้เพื่อ score custom/motion exercise ให้ตรงกับ therapist capture.

## Skeleton JSON export schema

ปุ่ม `Export JSON` ใน Motion Preview/Clip Editor export payload แบบ:

- `schema: physioai.skeleton_clip.v1`
- `flags.bodyRegionRequired`
- `flags.bodyRegionSelected`
- `flags.bodyRegion`
- `bodyRegionSelection`
- `coordinateSystem`
- `exercise`
- `clip.originalFrameCount`
- `clip.selectedFrameCount`
- `clip.fpsEstimate`
- `clip.durationMs`
- `clip.markers.restStart/target/restEnd`
- `clip.phases.restStartMs/targetMs/restEndMs/outboundMs/returnMs`
- `landmarkNames`
- `skeletonConnections`
- `frames[]`
  - `clipFrameIndex`
  - `absoluteFrameIndex`
  - `tMs`
  - `phase`
  - `landmarks[]` raw MediaPipe normalized coordinates
  - `jointAngles`

## Env / Supabase

Local `.env.local` ฝั่ง `Therapist/` ควรมี:

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

หรือใช้ชื่อ React-style ได้ตาม server fallback:

```bash
REACT_APP_SUPABASE_URL=...
REACT_APP_SUPABASE_PUBLISHABLE_KEY=...
```

หมายเหตุ:

- `SUPABASE_SERVICE_ROLE_KEY` ต้องเป็น server-only เท่านั้น
- อย่าใส่ key จริงลง Git
- Supabase โปรเจกต์ใหม่บางตัวไม่ expose table เข้า Data API อัตโนมัติ ต้องเปิดให้ tables เหล่านี้:
  - `profiles`
  - `therapist_patients`
  - `plans`
  - `references`
  - `sessions`

## Run / deploy

รัน local:

```bash
cd /Users/title/Desktop/AppTitle/Therapist
npm install
npm start
```

เปิด:

```text
http://localhost:3000
http://localhost:3000/therapist/capture
http://localhost:3000/therapist/plan
http://localhost:3000/therapist/dashboard
```

Supabase migration:

```bash
cd /Users/title/Desktop/AppTitle/Therapist
npm run supabase:push:dry
npm run supabase:push
```

Vercel:

```bash
cd /Users/title/Desktop/AppTitle/Therapist
npm run vercel:dev
npm run vercel:deploy
npm run vercel:deploy:prod
```

## Known notes / สิ่งที่ต้องระวัง

- ถ้าไม่มี `SUPABASE_SERVICE_ROLE_KEY`, create account อาจต้อง verify email ก่อน login สำเร็จ
- `capture.html` ยังเป็นไฟล์เดียวขนาดใหญ่ ถ้าจะ maintain ระยะยาวควรแยก motion editor / capture state / drawing helpers ออกเป็น modules
- `localStorage` ยังใช้เป็น cache และ library scope สำหรับ custom exercises/reference library; real patient scope ต้อง sync cloud สำเร็จก่อน
- JSON export เก็บ raw landmarks ไม่ mirror; preview บนจออาจ mirror เพื่อให้ดูเหมือน selfie
- Patient iOS/web ต้องใช้ `bodyRegion`, `repJoints`, `jointMotion`, `referenceSequence` ให้ตรงกับ Therapist ไม่งั้น score/rep custom motion จะไม่เหมือนกัน
- Dashboard ขึ้นอยู่กับ session payload จาก Patient ถ้า Patient ไม่ส่ง metric ใหม่ dashboard จะมีข้อมูลไม่ครบ
