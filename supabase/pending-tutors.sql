-- Tutor approval
-- Tutors who sign up themselves start as "pending". They can log in and fill in their
-- profile, but they don't appear on the site until an admin approves them.
-- Tutors created by an admin are approved straight away (by the admin-users function).
-- Existing tutors are not changed.
--
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

-- 1. Allow the new "pending" status.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'suspended', 'pending'));

-- 2. Every new tutor profile starts pending.
create or replace function public.tutor_starts_pending() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'tutor' then
    new.status := 'pending';
  end if;
  return new;
end $$;

drop trigger if exists tutor_starts_pending on public.profiles;
create trigger tutor_starts_pending
  before insert on public.profiles
  for each row execute function public.tutor_starts_pending();

-- 3. Only admins (or the server) can change an account's status or role, so a pending
--    tutor can't approve themselves and a student can't turn into a tutor.
create or replace function public.lock_status_and_role() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Requests from the website run as "anon" or "authenticated"; the server and the
  -- SQL Editor run as other roles and are trusted.
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return new;
  end if;
  new.status := old.status;
  new.role := old.role;
  return new;
end $$;

drop trigger if exists lock_status_and_role on public.profiles;
create trigger lock_status_and_role
  before update on public.profiles
  for each row execute function public.lock_status_and_role();

-- 4. Check: the public tutor list must only show active tutors.
--    This should return TRUE. If it returns FALSE, tell Claude (pending tutors would be listed).
select position('''active''' in pg_get_functiondef('public.list_tutors()'::regprocedure)) > 0
  as tutor_list_only_shows_active;
