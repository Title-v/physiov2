import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schemaSql = fs.readFileSync('supabase/schema.sql', 'utf8');
const hardeningSql = fs.readFileSync('supabase/migrations/20260629162040_harden_profile_role_metadata.sql', 'utf8');

function compact(sql) {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

test('current Supabase schema enables RLS on every exposed PhysioAI table', () => {
  for (const table of ['profiles', 'therapist_patients', 'plans', 'references', 'sessions']) {
    assert.match(schemaSql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
});

test('current Supabase policies restrict patient data to owner or linked therapist', () => {
  const sql = compact(schemaSql);
  for (const table of ['plans', 'references', 'sessions']) {
    assert.match(sql, new RegExp(`create policy "${table}_[^"]+".*on public\\.${table}.*private\\.is_linked_patient\\(patient_id\\)`, 'i'));
  }
  assert.match(sql, /create policy "profiles_select_own".*private\.is_linked_patient\(id\)/i);
  assert.doesNotMatch(sql, /auth\.role\s*\(/i);
});

test('therapist-patient relationship policies require therapist role and patient profile on insert', () => {
  const sql = compact(schemaSql);
  assert.match(sql, /create policy "therapist_patients_insert_own".*with check .*private\.is_therapist\(\).*private\.is_patient_profile\(patient_id\)/i);
  assert.match(sql, /check \(therapist_id <> patient_id\)/i);
});

test('profile role hardening does not trust user-editable metadata', () => {
  const finalSchema = compact(schemaSql);
  const hardening = compact(hardeningSql);
  assert.doesNotMatch(finalSchema, /raw_user_meta_data\s*->>\s*'role'/i);
  assert.doesNotMatch(finalSchema, /role\s*=\s*excluded\.role/i);
  assert.match(finalSchema, /coalesce\(new\.raw_user_meta_data ->> 'name'.*'patient'/i);
  assert.doesNotMatch(hardening, /raw_user_meta_data\s*->>\s*'role'/i);
});

test('public security definer trigger function is revoked from public', () => {
  const sql = compact(schemaSql);
  assert.match(sql, /create or replace function public\.handle_new_user\(\).*security definer/i);
  assert.match(sql, /revoke all on function public\.handle_new_user\(\) from public/i);
});
