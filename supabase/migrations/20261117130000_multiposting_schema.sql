-- Multiposting schema (plan/multiposting, MPT-010 / MP-CON-004).
-- Additive: deployed applicant code keeps working. Differs from the spec:
-- applications.source stays the origin kind and gains 'job_board'; the
-- channel (jooble, indeed, google, ...) goes in source_detail.

-- 1. Channel catalog (seeded, read-only for clients).
create table if not exists public.distribution_channels (
  key text primary key check (key ~ '^[a-z0-9_]{2,30}$'),
  kind text not null check (kind in ('index', 'feed', 'partner_api', 'byo_account')),
  name text not null,
  enabled boolean not null default true,
  requires_approval boolean not null default false
);
alter table public.distribution_channels enable row level security;
drop policy if exists "Anyone signed in can read channels" on public.distribution_channels;
create policy "Anyone signed in can read channels" on public.distribution_channels
  for select to authenticated using (true);

insert into public.distribution_channels (key, kind, name, requires_approval) values
  ('google', 'index', 'Google for Jobs', false),
  ('bing', 'index', 'Bing and IndexNow', false),
  ('jooble', 'feed', 'Jooble', true),
  ('adzuna', 'feed', 'Adzuna', true),
  ('talent', 'feed', 'Talent.com', true),
  ('indeed', 'feed', 'Indeed', true),
  ('naukri', 'byo_account', 'Naukri', true)
on conflict (key) do nothing;

-- 2. Company opt-in and BYO credentials. config_encrypted is never readable
-- by clients: reads go through the view below, writes through the service role.
create table if not exists public.company_channel_settings (
  company_id uuid not null references public.company_info(id) on delete cascade,
  channel_key text not null references public.distribution_channels(key),
  enabled boolean not null default false,
  config_encrypted text,
  approved_at timestamptz,
  status text not null default 'off' check (status in ('off', 'pending', 'live', 'error')),
  updated_at timestamptz not null default now(),
  primary key (company_id, channel_key)
);
alter table public.company_channel_settings enable row level security;
revoke all on public.company_channel_settings from anon, authenticated;
grant select (company_id, channel_key, enabled, approved_at, status, updated_at)
  on public.company_channel_settings to authenticated;

drop policy if exists "Members with distribution.view read settings" on public.company_channel_settings;
create policy "Members with distribution.view read settings" on public.company_channel_settings
  for select to authenticated
  using (public.has_company_permission(company_id, 'distribution.view')
      or public.has_company_permission(company_id, 'distribution.manage'));

-- 3. One row per job and channel (+ per-job opt-out via status 'opted_out').
create table if not exists public.job_channel_postings (
  job_id uuid not null references public.job_postings(id) on delete cascade,
  channel_key text not null references public.distribution_channels(key),
  external_job_id text,
  status text not null default 'pending'
    check (status in ('pending', 'live', 'ineligible', 'opted_out', 'removed', 'error')),
  reason text,
  last_pushed_at timestamptz,
  last_seen_at timestamptz,
  primary key (job_id, channel_key)
);
alter table public.job_channel_postings enable row level security;
revoke insert, update, delete on public.job_channel_postings from anon, authenticated;
grant select on public.job_channel_postings to authenticated;

drop policy if exists "Members with distribution.view read postings" on public.job_channel_postings;
create policy "Members with distribution.view read postings" on public.job_channel_postings
  for select to authenticated
  using (job_id = any ((select public.my_job_ids_with('distribution.view'))::uuid[]));

-- 4. Audit and webhook idempotency (service role only).
create table if not exists public.channel_events (
  id bigint generated always as identity primary key,
  channel_key text not null references public.distribution_channels(key),
  job_id uuid references public.job_postings(id) on delete set null,
  kind text not null,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.channel_events enable row level security;
revoke all on public.channel_events from anon, authenticated;
create unique index if not exists channel_events_idempotency_idx
  on public.channel_events (channel_key, idempotency_key) where idempotency_key is not null;
create index if not exists channel_events_job_idx on public.channel_events (job_id, created_at desc);

-- 5. Applications: board attribution and the board's own id.
alter table public.applications
  add column if not exists external_application_id text;
alter table public.applications drop constraint if exists applications_source_check;
alter table public.applications add constraint applications_source_check
  check (source in ('applied', 'outreach', 'imported', 'agent', 'careers_page', 'job_board'));
create unique index if not exists applications_source_external_id_idx
  on public.applications (source_detail, external_application_id)
  where external_application_id is not null;
