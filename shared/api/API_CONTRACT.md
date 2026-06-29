# PhysioAI API Contract

This contract defines the shared HTTP API exposed by the root Next app.

The route-neutral contract lives in `shared/api/contracts.mjs`. Shared handlers
under `shared/api/handlers/` are used by Next route handlers and are verified by:

```sh
node scripts/verify-api-contract.mjs
node scripts/verify-api-core.mjs
node scripts/verify-api-request.mjs
node scripts/verify-api-auth-context.mjs
node scripts/verify-api-auth-routes.mjs
node scripts/verify-api-data-routes.mjs
node scripts/verify-api-supabase-runtime.mjs
node scripts/verify-next-api-routes.mjs
node scripts/verify-next-auth-routes.mjs
node scripts/verify-next-data-routes.mjs
node scripts/verify-next-static-routes.mjs
```

The migration should keep the same methods, paths, auth requirements, response
shapes, and error codes as patient and therapist features move from transitional
static surfaces into final Next pages.

Next route parity is tracked incrementally in
`shared/api/next-route-manifest.mjs`. That manifest should contain only routes
that have actually been ported and verified.

## Endpoint Groups

- Auth: `/auth/register`, `/auth/resend-verification`, `/auth/login`, `/auth/me`
- Therapist roster: `/patients`, `/patients/link`
- Patient plan data: `/plans`
- Therapist references and captured motion: `/references`
- Completed exercise sessions and dashboard analytics: `/sessions`
- Health: `/health`

## Shared Handlers

- `/health` uses `shared/api/handlers/health.js`.
- Shared API response helpers and plan/reference/session mappers live in
  `shared/api/handlers/core.js`.
- Shared request parsing helpers for bearer tokens, redirect origins, and target
  patient selection live in `shared/api/handlers/request.js`.
- Shared auth and role middleware factories live in
  `shared/api/handlers/auth-context.js`.
- Shared auth endpoint handlers live in `shared/api/handlers/auth-routes.js`.
- Shared patient, plan, reference, and session endpoint handlers live in
  `shared/api/handlers/data-routes.js`.
- Shared Supabase env, table, and client runtime helpers live in
  `shared/api/runtime/supabase.js`.

## Invariants

- Bearer auth stays header-based.
- Therapists can access linked patients only.
- Patients can access only their own plan, references, and sessions.
- Plan/reference/session JSON shapes must preserve custom exercise snapshots,
  boundary metadata, joint angles, motion scores, and reference trajectories.
- The root Next app is the final server surface; patient and therapist features
  must keep using the shared contract as UI code moves.
