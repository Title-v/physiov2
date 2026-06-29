# PhysioAI Project Structure

This is the transitional web-only layout after removing the old native Patient
app.

```text
.
├── apps/
│   └── patient/          Patient-facing static web app
├── supabase/             Supabase config, migrations, and schema
├── public/               Static patient assets and browser-safe shared symlinks
├── src/app/              Next.js App Router pages and API routes
├── shared/               Shared browser modules and API handlers
└── PROJECT_STRUCTURE.md  This guide
```

## Shared Logic

Patient and therapist code should import shared pose/exercise logic from
`shared/`.

The canonical browser logic in `shared/` includes:

- built-in exercises and motion setup metadata
- BlazePose landmark schema
- joint angle calculation
- boundary box evaluation/drawing
- angle overlay drawing
- multi-joint motion and trajectory helpers

## Migration Direction

The final structure should converge toward a labautomotive-style Next.js app:

```text
src/
├── app/
│   ├── (patient)/
│   ├── therapist/
│   └── api/
├── components/
├── lib/
└── services/
```

The old Node wrapper has been removed from the final web-only structure. The root Next app
now owns API routes for auth, patients, plans, references, sessions, and health.

API parity is tracked in `shared/api/contracts.mjs`. Run
`node scripts/verify-api-contract.mjs` after changing the API contract or Next
route manifest.

Next route parity is tracked in `shared/api/next-route-manifest.mjs`. Do not add
an endpoint to that manifest until the matching `src/app/**/route.js` file
returns the same method/path contract as `shared/api/contracts.mjs`.

Current Next API parity:

- Ported: all 15 current API contract endpoints
- Native Therapist home: `/` is `src/app/page.jsx`
- Native Therapist setup/capture: `/therapist` and `/therapist/capture` are
  native Next pages under `src/app/therapist/`
- Native Therapist plan builder: `/therapist/plan` is `src/app/therapist/plan/page.jsx`
- Native Therapist data recorder: `/therapist/record` is `src/app/therapist/record/page.jsx`
- Native Therapist dashboard: `/therapist/dashboard` is `src/app/therapist/dashboard/page.jsx`
- Patient UI serving: `/patient/` rewrites to `public/patient/index.html`
- Shared browser assets: `/shared/*` are browser-safe symlinks to root `shared/`
- Old Node and Therapist Vercel wrappers: removed

## Migration Phases

1. Current phase: keep native `/`, native `/therapist`, native
   `/therapist/capture`, native `/therapist/plan`, native `/therapist/record`,
   native `/therapist/dashboard`, `apps/patient/`, `shared/`, `public/`, and
   `supabase/` working under the root Next app.
2. Next phase: create native Next.js `src/app/(patient)`, `src/app/therapist`, and
   `src/app/api` surfaces while reusing the same `shared/` logic.
3. Parity phase: keep each contract endpoint backed by a Next route handler and
   keep the verifier scripts green after endpoint changes.
4. Refinement phase: keep retiring transitional compatibility pieces only after
   patient plans, built-in exercises, boundary boxes, angle overlays, motion
   scoring, and trajectory references pass smoke tests from their final
   component locations.
