-- Tighten therapist access around explicit therapist/patient relationships.
-- This migration is additive because 20260626092807_init_physioai_schema.sql
-- may already be applied in Supabase.

create table if not exists public.therapist_patients (
  therapist_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (therapist_id, patient_id),
  check (therapist_id <> patient_id)
);

alter table public.therapist_patients enable row level security;

create or replace function private.is_linked_patient(target_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.therapist_patients
    where therapist_id = (select auth.uid())
      and patient_id = target_patient_id
  );
$$;

revoke all on function private.is_linked_patient(uuid) from public;
grant execute on function private.is_linked_patient(uuid) to authenticated;

create or replace function private.is_patient_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = target_profile_id
      and role = 'patient'
  );
$$;

revoke all on function private.is_patient_profile(uuid) from public;
grant execute on function private.is_patient_profile(uuid) to authenticated;

drop policy if exists "therapist_patients_select_own" on public.therapist_patients;
create policy "therapist_patients_select_own"
on public.therapist_patients for select
to authenticated
using ((select auth.uid()) = therapist_id or (select auth.uid()) = patient_id);

drop policy if exists "therapist_patients_insert_own" on public.therapist_patients;
create policy "therapist_patients_insert_own"
on public.therapist_patients for insert
to authenticated
with check (
  (select auth.uid()) = therapist_id
  and private.is_therapist()
  and private.is_patient_profile(patient_id)
);

drop policy if exists "therapist_patients_delete_own" on public.therapist_patients;
create policy "therapist_patients_delete_own"
on public.therapist_patients for delete
to authenticated
using ((select auth.uid()) = therapist_id and private.is_therapist());

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (
  (select auth.uid()) = id
  or private.is_linked_patient(id)
);

drop policy if exists "plans_select_own" on public.plans;
create policy "plans_select_own"
on public.plans for select
to authenticated
using ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "plans_upsert_own" on public.plans;
create policy "plans_upsert_own"
on public.plans for insert
to authenticated
with check ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "plans_update_own" on public.plans;
create policy "plans_update_own"
on public.plans for update
to authenticated
using ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id))
with check ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "references_select_own" on public.references;
create policy "references_select_own"
on public.references for select
to authenticated
using ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "references_insert_own" on public.references;
create policy "references_insert_own"
on public.references for insert
to authenticated
with check ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "references_update_own" on public.references;
create policy "references_update_own"
on public.references for update
to authenticated
using ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id))
with check ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "references_delete_own" on public.references;
create policy "references_delete_own"
on public.references for delete
to authenticated
using ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own"
on public.sessions for select
to authenticated
using ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own"
on public.sessions for insert
to authenticated
with check ((select auth.uid()) = patient_id or private.is_linked_patient(patient_id));

grant select, insert, delete on public.therapist_patients to authenticated;
grant delete on public.references to authenticated;
