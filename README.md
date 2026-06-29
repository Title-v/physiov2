# PhysioAI Web

PhysioAI Web is a web-only physiotherapy platform for therapist setup,
patient home practice, and shared motion-quality analysis. The repo now runs as
one Next.js project: the root app owns the web server, API routes, Therapist UI,
Patient Web entry point, and shared browser logic.

This repository intentionally no longer contains React Native, Expo, native iOS
or Android app code, Express, or the old static Therapist app.

## Contents

- [Current Scope](#current-scope)
- [Quick Start](#quick-start)
- [Routes](#routes)
- [Project Structure](#project-structure)
- [Shared Motion Logic](#shared-motion-logic)
- [AI Model Pipeline](#ai-model-pipeline)
- [Development Scripts](#development-scripts)
- [Testing And Verification](#testing-and-verification)
- [Environment Variables](#environment-variables)
- [Supabase](#supabase)
- [Contributor Rules](#contributor-rules)

## Current Scope

| Area | Location | Notes |
| --- | --- | --- |
| Therapist web app | `src/app/therapist/` | Native Next pages for capture, plan, record, and dashboard. |
| Patient web app | `apps/patient/` | Static browser app served through the root Next app. |
| Shared browser logic | `shared/` | Pose, boundary, overlay, trajectory, scoring, practice, API helpers. |
| Optional AI models | `shared/models/` | Lazy-loaded browser model artifacts, not bundled into the app runtime. |
| API routes | `src/app/**/route.js` | Next route handlers backed by shared API handlers. |
| Database config | `supabase/` | Supabase migrations, schema, and local CLI config. |
| Verification | `tests/`, `scripts/` | Node tests plus route, API, motion, and patient-practice verifiers. |

## Quick Start

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the main surfaces:

| Surface | URL |
| --- | --- |
| Therapist | `http://localhost:3000/therapist` |
| Patient | `http://localhost:3000/patient` |
| Health check | `http://localhost:3000/health` |

## Routes

### Application Routes

| Route | Purpose |
| --- | --- |
| `/` | Therapist home |
| `/therapist` | Therapist capture and reference setup |
| `/therapist/capture` | Therapist capture and reference setup |
| `/therapist/plan` | Patient plan builder |
| `/therapist/record` | Labeled AI training data recorder |
| `/therapist/dashboard` | Patient adherence, score, alert, and session review dashboard |
| `/patient` | Patient home-practice web app |
| `/health` | API health check |

### Compatibility Rewrites

Legacy `.html` Therapist URLs are kept as rewrites so old bookmarks do not
break:

| Legacy URL | Current Route |
| --- | --- |
| `/therapist/index.html` | `/` |
| `/therapist/capture.html` | `/therapist/capture` |
| `/therapist/plan.html` | `/therapist/plan` |
| `/therapist/record.html` | `/therapist/record` |
| `/therapist/dashboard.html` | `/therapist/dashboard` |

## Project Structure

```text
.
├── apps/
│   └── patient/              Patient-facing static web app
├── public/                   Browser-served patient and shared assets
├── scripts/                  Verification scripts
├── shared/
│   ├── ai/                   Pose, boundary, overlay, motion, analytics
│   ├── api/                  API contracts, handlers, Next adapter
│   ├── core/                 Auth, store, exercises, UI helpers
│   ├── models/               Optional browser-loadable AI model artifacts
│   ├── practice/             Frame and session practice processing
│   └── vendor/               Browser-safe MediaPipe runtime files
├── src/app/                  Next.js App Router pages and API routes
├── supabase/                 Supabase config, migrations, schema
└── tests/                    Node test suites
```

## Shared Motion Logic

Therapist capture and Patient practice must use the same movement rules. The
shared stack lives in `shared/` and covers:

- built-in exercise metadata
- MediaPipe / BlazePose landmark handling
- joint angle calculation
- boundary-box evaluation and drawing
- angle overlay drawing
- reference motion and trajectory builders
- alternating sequence support
- per-frame practice processing
- rep counting and validity checks
- motion scoring and session summaries

Keep this logic route-neutral. If Therapist and Patient behavior differ, prefer
fixing the shared implementation instead of adding separate scoring paths.

## AI Model Pipeline

Phase 7 dataset and TCN support is optional and fail-soft. Rule-based motion
scoring remains authoritative when no model is available.

| Command | Purpose |
| --- | --- |
| `npm run train:tcn -- --input dataset.jsonl --dry-run` | Validate dataset JSONL and feature extraction without TensorFlow. |
| `npm run train:tcn -- --input dataset.jsonl --out shared/models/motion-tcn` | Train a TCN in an external training environment with `@tensorflow/tfjs-node`. |
| `npm run convert:tcn -- --from-tfjs path/to/model --out shared/models/motion-tcn` | Register an existing TensorFlow.js model and write the browser manifest. |
| `npm run convert:tcn -- --from-keras path/to/model.keras --out shared/models/motion-tcn` | Convert a Keras model through `tensorflowjs_converter`, then write the manifest. |

Therapist capture can export motion clips as JSONL from `Export JSONL`. Trained
artifacts are served from `/shared/models/motion-tcn/*` and loaded lazily by the
shared model registry. If the manifest, model, or TFJS runtime is missing, the
classifier returns `null` and practice continues with deterministic scoring.

## Development Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Build the production app. |
| `npm start` | Run the production build. |
| `npm test` | Run Node test suites in `tests/`. |
| `npm run verify` | Run all verification gates. |
| `npm run verify:api` | Check API contracts, handlers, auth, data routes, and Next route parity. |
| `npm run verify:static` | Check static and native route availability. |
| `npm run verify:motion` | Check motion-quality engine behavior. |
| `npm run verify:patient-live` | Check patient live-practice behavior. |
| `npm run train:tcn` | Train or dry-run the optional motion TCN pipeline. |
| `npm run convert:tcn` | Prepare/register a TensorFlow.js motion TCN model. |

Run the full verifier before pushing changes that touch routes, API contracts,
shared motion logic, patient practice, or Therapist capture:

```bash
npm run verify
```

## Testing And Verification

The verification suite is meant to protect the logic that can easily regress:

| Coverage Area | Protected Behavior |
| --- | --- |
| Motion engine | Rep counting, phase changes, scoring, hold and motion references. |
| Boundary gate | Camera framing checks and per-frame accept/reject state. |
| Trajectory logic | Reference trajectory shape and live motion comparison. |
| Practice processor | Per-frame boundary, angles, motion snapshot, and exercise state. |
| Session summary | End-of-session score, rep, and quality summary payloads. |
| API parity | Shared API contracts match Next route handlers. |
| Static routes | Patient, Therapist, and shared browser files are still served. |

Use targeted verifiers while developing, then run `npm run verify` before a
commit.

## Environment Variables

Create local environment variables from the example file:

```bash
cp .env.example .env.local
```

Required:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_publishable_key
```

Optional browser aliases:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_publishable_key
```

Optional server-only key:

```bash
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to client-side code.

## Supabase

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run supabase:login` | Log in to Supabase CLI. |
| `npm run supabase:link` | Link the local repo to the configured project. |
| `npm run supabase:push:dry` | Preview pending database changes. |
| `npm run supabase:push` | Push migrations to the linked project. |
| `npm run supabase:advisors` | Run Supabase advisors against the linked project. |

Schema and migrations live in `supabase/`. API contracts live in
`shared/api/contracts.mjs`.

## Contributor Rules

- Do not add React Native, Expo, native iOS, native Android, or Express back
  into this repo.
- Keep Therapist UI in `src/app/therapist/` and Patient UI in `apps/patient/`.
- Keep motion, boundary, overlay, trajectory, rep-count, score, and session
  logic shared under `shared/`.
- Keep Therapist capture and Patient practice compatible with the same shared
  references.
- When an API endpoint changes, update `shared/api/contracts.mjs` and the
  matching `src/app/**/route.js` implementation together.
- When a route changes, update `next.config.mjs`, the route verifiers, and this
  README together.
