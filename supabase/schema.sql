-- cultivar+ database. Paste into Supabase: SQL Editor -> New query -> Run.
create extension if not exists btree_gist;

create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('student','tutor','admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  name text not null default '', email text,
  grade smallint check (grade between 9 and 12),
  uni text, program text,
  subjects text[] not null default '{}', vibe text[] not null default '{}',
  bio text, photo_url text,
  rate numeric(8,2),                       -- null = use settings.default_rate (admin controls this)
  created_at timestamptz not null default now());

create table public.availability(
  tutor_id uuid references public.profiles(id) on delete cascade,
  weekday smallint check (weekday between 0 and 6),        -- 0 = Sunday
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 1 and 24 and end_hour > start_hour),
  primary key (tutor_id, weekday));

create table public.days_off(
  tutor_id uuid references public.profiles(id) on delete cascade,
  day date, primary key (tutor_id, day));

create table public.settings(
  id int primary key default 1 check (id = 1),
  default_rate numeric(8,2) not null default 40,
  session_minutes int not null default 60, buffer_minutes int not null default 15,
  notice_hours int not null default 12, window_days int not null default 60,
  timezone text not null default 'America/Toronto', meeting_link text default '');
insert into public.settings default values on conflict do nothing;

create table public.bookings(
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default upper(substr(md5(random()::text),1,6)),
  tutor_id uuid not null references public.profiles(id),
  student_id uuid not null references public.profiles(id),
  subject text not null, grade smallint,
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  format text not null default 'Online', notes text,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
  amount_cents int, stripe_session_id text,
  created_at timestamptz not null default now(),
  -- a tutor can never be double booked
  exclude using gist (tutor_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'confirmed'));

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active') $$;

-- Create a profile automatically when someone signs up (role can only be student or tutor here)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := coalesce(new.raw_user_meta_data->>'role','student');
begin
  if r not in ('student','tutor') then r := 'student'; end if;
  insert into profiles(id, role, name, email, grade, uni, program, subjects, vibe, bio)
  values(new.id, r, coalesce(new.raw_user_meta_data->>'name',''), new.email,
    nullif(new.raw_user_meta_data->>'grade','')::smallint,
    new.raw_user_meta_data->>'uni', new.raw_user_meta_data->>'program',
    coalesce(array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'subjects','[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'vibe','[]'::jsonb))), '{}'),
    new.raw_user_meta_data->>'bio');
  if r = 'tutor' then
    insert into availability(tutor_id, weekday, start_hour, end_hour) select new.id, d, 16, 20 from generate_series(1,5) d;
    insert into availability values (new.id, 6, 10, 16);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Only admins can change role, status, rate or email on a profile
create or replace function public.guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or coalesce(auth.jwt()->>'role','') = 'service_role') then
    new.role := old.role; new.status := old.status; new.rate := old.rate; new.email := old.email;
  end if;
  return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

-- Students and tutors can only cancel; payment fields are changed by the server or an admin
create or replace function public.guard_booking() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt()->>'role','') = 'service_role' or is_admin() then return new; end if;
  new.payment_status := old.payment_status; new.amount_cents := old.amount_cents; new.stripe_session_id := old.stripe_session_id;
  new.tutor_id := old.tutor_id; new.student_id := old.student_id; new.starts_at := old.starts_at; new.ends_at := old.ends_at;
  if old.status = 'cancelled' then new.status := 'cancelled'; end if;
  return new;
end $$;
create trigger guard_booking before update on public.bookings for each row execute function public.guard_booking();

-- Students need to see which times are taken without seeing other students' bookings
create or replace function public.busy_slots(p_tutor uuid) returns table(starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as
$$ select starts_at, ends_at from bookings where tutor_id = p_tutor and status = 'confirmed' and ends_at > now() $$;
grant execute on function public.busy_slots(uuid) to anon, authenticated;

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.availability enable row level security;
alter table public.days_off enable row level security;
alter table public.settings enable row level security;
alter table public.bookings enable row level security;

create policy "active tutors are public" on public.profiles for select using (role = 'tutor' and status = 'active');
create policy "read own profile" on public.profiles for select using (id = auth.uid());
create policy "tutors see their students" on public.profiles for select
  using (exists(select 1 from bookings b where b.tutor_id = auth.uid() and b.student_id = profiles.id));
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin manages profiles" on public.profiles for all using (is_admin()) with check (is_admin());

create policy "availability is public" on public.availability for select using (true);
create policy "tutor edits own availability" on public.availability for all
  using (tutor_id = auth.uid() or is_admin()) with check (tutor_id = auth.uid() or is_admin());
create policy "days off are public" on public.days_off for select using (true);
create policy "tutor edits own days off" on public.days_off for all
  using (tutor_id = auth.uid() or is_admin()) with check (tutor_id = auth.uid() or is_admin());

create policy "settings are public" on public.settings for select using (true);
create policy "admin edits settings" on public.settings for update using (is_admin()) with check (is_admin());

create policy "see own bookings" on public.bookings for select
  using (student_id = auth.uid() or tutor_id = auth.uid() or is_admin());
create policy "students create bookings" on public.bookings for insert
  with check (student_id = auth.uid() and status = 'confirmed' and payment_status = 'unpaid' and amount_cents is null and starts_at > now());
create policy "cancel own bookings" on public.bookings for update
  using (student_id = auth.uid() or tutor_id = auth.uid() or is_admin());

-- Tutor photos
insert into storage.buckets(id, name, public) values ('avatars','avatars',true) on conflict do nothing;
create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
