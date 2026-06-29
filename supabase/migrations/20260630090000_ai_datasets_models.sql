-- PhysioAI AI-first v3 dataset/model metadata storage.

create table if not exists public.motion_datasets (
  id text primary key,
  therapist_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid references public.profiles(id) on delete set null,
  exercise_id text not null,
  landmark_schema_id text not null,
  label_status text not null check (label_status in ('reviewed')),
  data_quality text not null check (data_quality = 'usable'),
  trainable boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists motion_datasets_therapist_idx
on public.motion_datasets (therapist_id, created_at desc);

create index if not exists motion_datasets_schema_idx
on public.motion_datasets (landmark_schema_id, exercise_id);

create table if not exists public.ai_models (
  id text primary key,
  therapist_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id text,
  landmark_schema_id text not null,
  version text not null,
  approved boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_models_therapist_idx
on public.ai_models (therapist_id, updated_at desc);

create index if not exists ai_models_schema_idx
on public.ai_models (landmark_schema_id, exercise_id);

alter table public.motion_datasets enable row level security;
alter table public.ai_models enable row level security;

drop policy if exists "motion_datasets_select_own" on public.motion_datasets;
create policy "motion_datasets_select_own"
on public.motion_datasets for select
to authenticated
using ((select auth.uid()) = therapist_id and private.is_therapist());

drop policy if exists "motion_datasets_insert_own" on public.motion_datasets;
create policy "motion_datasets_insert_own"
on public.motion_datasets for insert
to authenticated
with check (
  (select auth.uid()) = therapist_id
  and private.is_therapist()
  and (patient_id is null or private.is_linked_patient(patient_id))
);

drop policy if exists "ai_models_select_own" on public.ai_models;
create policy "ai_models_select_own"
on public.ai_models for select
to authenticated
using ((select auth.uid()) = therapist_id and private.is_therapist());

drop policy if exists "ai_models_insert_own" on public.ai_models;
create policy "ai_models_insert_own"
on public.ai_models for insert
to authenticated
with check ((select auth.uid()) = therapist_id and private.is_therapist());

drop policy if exists "ai_models_update_own" on public.ai_models;
create policy "ai_models_update_own"
on public.ai_models for update
to authenticated
using ((select auth.uid()) = therapist_id and private.is_therapist())
with check ((select auth.uid()) = therapist_id and private.is_therapist());

grant select, insert on public.motion_datasets to authenticated;
grant select, insert, update on public.ai_models to authenticated;
