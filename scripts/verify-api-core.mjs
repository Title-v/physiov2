import core from '../shared/api/handlers/core.js';

const {
  apiErrorBody,
  cleanPlan,
  isoFromEpochMs,
  normalizeAuthError,
  planFromRow,
  publicUser,
  referenceFromRow,
  sessionFromRow,
} = core;

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

check('normalize exists', normalizeAuthError({ message: 'User already registered' }) === 'exists');
check('normalize invalid', normalizeAuthError({ message: 'Invalid login credentials' }) === 'invalid');
check('normalize confirmation', normalizeAuthError({ message: 'Email not confirmed' }) === 'email_confirmation_required');
check('api error dev detail', apiErrorBody('supabase_error', 'detail', 'development').detail === 'detail');
check('api error production hides detail', apiErrorBody('supabase_error', 'detail', 'production').detail == null);

const user = publicUser(
  { id: 'u1', email: 'patient@example.com', user_metadata: { name: 'Meta Name', role: 'patient' } },
  null,
);
check('public user fallback', user.id === 'u1' && user.name === 'Meta Name' && user.role === 'patient');
const spoofed = publicUser(
  { id: 'u2', email: 'spoof@example.com', user_metadata: { name: 'Spoof', role: 'therapist' } },
  null,
);
check('public user fallback does not trust metadata role', spoofed.role === 'patient');

const plan = cleanPlan({ items: [{ exerciseId: 'shoulder' }], durationWeeks: 2 }, 'p1');
check('clean plan defaults', plan.patientId === 'p1' && plan.durationDays === 14 && plan.daysPerWeek === 7);
check('plan from row', planFromRow({ patient_id: 'p2', data: { items: [] } })?.patientId === 'p2');
check('reference from row', referenceFromRow({ exercise_id: 'knee', data: { score: 1 } }).exerciseId === 'knee');

const session = sessionFromRow({
  id: 's1',
  patient_id: 'p1',
  exercise_id: 'shoulder',
  ended_at: '2026-01-01T00:00:00.000Z',
  data: { reps: 5 },
});
check('session from row', session.id === 's1' && session.patientId === 'p1' && session.exerciseId === 'shoulder' && session.reps === 5);
check('iso from epoch', isoFromEpochMs(0) === '1970-01-01T00:00:00.000Z');

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
