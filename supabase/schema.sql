-- PhysioAI Supabase schema for the root Next API.
--
-- Kept as a readable copy of the current migration state. Apply migrations
-- with `npx supabase db push`.
-- For full therapist cross-patient access from the Next API, set
-- SUPABASE_SERVICE_ROLE_KEY in Vercel Project Settings. Never expose that key
-- in frontend code.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null,
  role text not null check (role in ('patient', 'therapist')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.therapist_patients (
  therapist_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (therapist_id, patient_id),
  check (therapist_id <> patient_id)
);

create table if not exists public.plans (
  patient_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.references (
  patient_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (patient_id, exercise_id)
);

create table if not exists public.sessions (
  id text primary key,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id text,
  ended_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.therapist_patients enable row level security;
alter table public.plans enable row level security;
alter table public.references enable row level security;
alter table public.sessions enable row level security;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.is_therapist()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'therapist'
  );
$$;

revoke all on function private.is_therapist() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_therapist() to authenticated;

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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', 'patient')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name,
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

grant select on public.profiles to authenticated;
grant select, insert, delete on public.therapist_patients to authenticated;
grant select, insert, update on public.plans to authenticated;
grant select, insert, update, delete on public.references to authenticated;
grant select, insert on public.sessions to authenticated;
