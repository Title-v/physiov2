# PhysioAI Web Apps

This workspace now contains the patient-facing web app in `apps/patient/` and
the native Therapist web app in `src/app/therapist/`. The old native Patient app
and legacy Therapist static pages have been removed.

Shared pose, exercise, boundary, angle-overlay, and motion modules are exposed
through `shared/` so patient and therapist web surfaces can import the same
browser logic while the repo migrates toward the final Next.js structure.
The root `supabase/` folder owns database config and migrations.

The root Next app now has API route parity for the current 15 endpoint contract,
a native Therapist home page at `/`, native Therapist setup/capture at
`/therapist` and `/therapist/capture`, a native Therapist plan builder at
`/therapist/plan`, a native Therapist data recorder at `/therapist/record`, and
a native Therapist dashboard at `/therapist/dashboard`. The patient-facing app and
browser-safe `shared/` folders are served from `public/` symlinks, with rewrites
preserving `/patient` and legacy Therapist `.html` links.
Run `npm run verify` after changing shared API or static route behavior.
