-- Security hardening. Safe to run more than once.
-- Supabase: SQL Editor -> New query -> paste -> Run.

-- 1. Tutors can edit their own profile through the API directly, not only through the site.
--    These rules make sure stored links can't be used to attack people who view the profile
--    (e.g. a "javascript:" payment link, or a photo that points at a tracking server).
--    NOT VALID = existing rows are left alone; every new insert/update is checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pay_link_safe') then
    alter table public.profiles add constraint profiles_pay_link_safe
      check (pay_link is null or pay_link = '' or pay_link ~ '^https://(buy|donate)\.stripe\.com/[^\s"''<>]*$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_photo_safe') then
    alter table public.profiles add constraint profiles_photo_safe
      check (photo is null or photo = '' or photo like 'https://tginxgkjvhwjzhovbqvi.supabase.co/storage/v1/object/public/avatars/%') not valid;
  end if;
end $$;

-- 2. Keep free-text fields to sensible sizes (stops someone storing megabytes in a bio).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_text_sizes') then
    alter table public.profiles add constraint profiles_text_sizes check (
      coalesce(length(name), 0) <= 100 and coalesce(length(bio), 0) <= 400 and
      coalesce(length(uni), 0) <= 120 and coalesce(length(program), 0) <= 120 and
      coalesce(cardinality(subjects), 0) <= 15 and coalesce(cardinality(vibe), 0) <= 12) not valid;
  end if;
end $$;

-- 3. The old "settings" table from the first version is still readable by anyone and has a
--    meeting_link column. The site now uses app_settings + the meeting_link() function, so
--    close the old one off.
do $$
begin
  if to_regclass('public.settings') is not null then
    revoke all on public.settings from anon, authenticated;
  end if;
end $$;
