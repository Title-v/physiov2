-- Do not trust user-editable auth metadata for authorization roles.
-- Public sign-up should always create a patient profile; server-side routes
-- with explicit authorization may promote/update roles by writing profiles.

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
    'patient'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name,
    updated_at = now();
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
