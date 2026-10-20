-- Careers pages (plan/careers-page/feature-careers-page-spec.md CP-*, tasks CPT-040/041).
--
-- Every company gets a slug (CP-DEC-002), unpublished until it publishes.
-- The careers columns are written only through the RPCs below, which check
-- careers.edit (roles spec) and validate the input; a direct update by an
-- authenticated user (the company profile form) can't change them.
-- The public page reads through get_careers_page / get_careers_jobs, which
-- return public columns only (CP-SEC-001).

-- ---------------------------------------------------------------------------
-- 1. Slugs
-- ---------------------------------------------------------------------------

-- CP-REQ-001. Matches helpers/careers/slug.ts (RESERVED_SLUGS, SLUG_PATTERN).
create or replace function public.careers_slug_valid(p_slug text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_slug is not null
     and char_length(p_slug) between 3 and 40
     and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     and p_slug <> all (array[
       'admin', 'api', 'app', 'auth', 'blog', 'careers', 'companies', 'company', 'dashboard',
       'edit', 'gethired', 'help', 'jobs', 'login', 'new', 'preview', 'settings', 'signup',
       'support', 'www'
     ])
$$;

-- "Acme, Inc." → "acme-inc". Short or empty names get a suffix so they're valid.
create or replace function public.slugify_company_name(p_name text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when char_length(s) >= 3 then s
    when s = '' then 'company'
    else s || '-jobs'
  end
  from (
    select btrim(left(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 34), '-') as s
  ) x
$$;

alter table public.company_info
  add column if not exists careers_slug text,
  add column if not exists careers_published boolean not null default false,
  add column if not exists careers_accent_color text,
  add column if not exists careers_cover_url text,
  add column if not exists careers_sections jsonb not null default '[]'::jsonb,
  add column if not exists careers_links jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_info_careers_slug_valid') then
    alter table public.company_info add constraint company_info_careers_slug_valid
      check (careers_slug is null or public.careers_slug_valid(careers_slug));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_info_careers_accent_color') then
    alter table public.company_info add constraint company_info_careers_accent_color
      check (careers_accent_color is null or careers_accent_color ~ '^#[0-9a-f]{6}$');
  end if;
end $$;

create unique index if not exists company_info_careers_slug on public.company_info (careers_slug);

-- CP-REQ-002: old slugs redirect, and stay reserved for 90 days.
create table if not exists public.company_careers_slug_history (
  slug text primary key,
  company_id uuid not null references public.company_info(id) on delete cascade,
  retired_at timestamptz not null default now()
);
alter table public.company_careers_slug_history enable row level security;
revoke all on public.company_careers_slug_history from public, anon, authenticated;
grant all on public.company_careers_slug_history to service_role;

-- Whether `p_company` may take `p_slug`: free, its own, or retired by another
-- company more than 90 days ago.
create or replace function public.careers_slug_available(p_slug text, p_company uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from public.company_info c where c.careers_slug = p_slug and c.id <> p_company)
     and not exists (
       select 1 from public.company_careers_slug_history h
        where h.slug = p_slug and h.company_id <> p_company and h.retired_at > now() - interval '90 days'
     )
$$;

-- The first free slug from a base: acme, acme-2, acme-3, …
create or replace function public.unique_careers_slug(p_base text, p_company uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_base text := public.slugify_company_name(p_base);
  v_slug text := v_base;
  n int := 1;
begin
  if not public.careers_slug_valid(v_slug) then
    v_base := left(v_base, 30) || '-jobs';
    v_slug := v_base;
  end if;
  while not public.careers_slug_available(v_slug, p_company) loop
    n := n + 1;
    v_slug := left(v_base, 36) || '-' || n;
  end loop;
  return v_slug;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Triggers: a slug for every new company; careers columns are RPC-only
-- ---------------------------------------------------------------------------

create or replace function public.protect_careers_columns()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_role = 'authenticated' then
      new.careers_published := false;
      new.careers_accent_color := null;
      new.careers_cover_url := null;
      new.careers_sections := '[]'::jsonb;
      new.careers_links := '{}'::jsonb;
      new.careers_slug := null;
    end if;
    if new.careers_slug is null then
      new.careers_slug := public.unique_careers_slug(new.name, new.id);
    end if;
    return new;
  end if;

  if current_role = 'authenticated' then
    new.careers_slug := old.careers_slug;
    new.careers_published := old.careers_published;
    new.careers_accent_color := old.careers_accent_color;
    new.careers_cover_url := old.careers_cover_url;
    new.careers_sections := old.careers_sections;
    new.careers_links := old.careers_links;
  elsif new.careers_slug is distinct from old.careers_slug and old.careers_slug is not null then
    insert into public.company_careers_slug_history (slug, company_id, retired_at)
    values (old.careers_slug, old.id, now())
    on conflict (slug) do update set company_id = excluded.company_id, retired_at = excluded.retired_at;
  end if;
  return new;
end $$;

drop trigger if exists company_info_protect_careers_columns on public.company_info;
create trigger company_info_protect_careers_columns
  before insert or update on public.company_info
  for each row execute function public.protect_careers_columns();

-- Backfill (CP-DEC-002): every existing company gets a slug, unpublished.
do $$
declare r record;
begin
  for r in select id, name from public.company_info where careers_slug is null order by created_at loop
    update public.company_info set careers_slug = public.unique_careers_slug(r.name, r.id) where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Public reads (CP-SEC-001): public columns only, published pages only
-- ---------------------------------------------------------------------------

create or replace function public.careers_page_json(c public.company_info)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'slug', c.careers_slug,
    'published', c.careers_published,
    'name', c.name,
    'tag_line', c.tag_line,
    'description', c.description,
    'logo_url', c.logo_url,
    'website', c.website,
    'headquarters', c.headquarters,
    'company_size', c.company_size,
    'industry', c.industry,
    'accent_color', c.careers_accent_color,
    'cover_url', c.careers_cover_url,
    'sections', c.careers_sections,
    'links', c.careers_links
  )
$$;

-- A published page, `{redirect}` for a retired slug, or null.
create or replace function public.get_careers_page(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.company_info;
  v_current text;
begin
  select * into c from public.company_info where careers_slug = lower(p_slug) and careers_published;
  if found then return public.careers_page_json(c); end if;

  select ci.careers_slug into v_current
    from public.company_careers_slug_history h
    join public.company_info ci on ci.id = h.company_id
   where h.slug = lower(p_slug) and ci.careers_published;
  if v_current is not null then return jsonb_build_object('redirect', v_current); end if;
  return null;
end $$;

-- The session member's own page, published or not (the editor's preview, CP-REQ-008).
create or replace function public.get_my_careers_page()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select public.careers_page_json(c) from public.company_info c where c.id = public.my_company_id()
$$;

-- The active platform jobs of a published page (CP-REQ-006), public columns only.
-- `p_preview` returns the session member's own company's jobs instead.
create or replace function public.get_careers_jobs(p_slug text, p_preview boolean default false)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', jp.id,
           'all_jobs_id', jp.job_id,
           'title', jp.title,
           'description', left(coalesce(jp.description, ''), 20000),
           'location', jp.location,
           'job_type', jp.job_type,
           'department', jp.department,
           'workplace_type', jp.workplace_type,
           'salary_currency', jp.salary_currency,
           'salary_range', jp.salary_range,
           'min_salary', jp.min_salary,
           'max_salary', jp.max_salary,
           'min_experience', jp.min_experience,
           'max_experience', jp.max_experience,
           'experience', jp.experience,
           'visa_sponsorship', jp.visa_sponsorship,
           'created_at', jp.created_at
         ) order by jp.created_at desc), '[]'::jsonb)
    from public.job_postings jp
    join public.company_info c on c.id = jp.company_id
   where jp.status = 'active'
     and jp.job_id is not null
     and (
       (not p_preview and c.careers_slug = lower(p_slug) and c.careers_published)
       or (p_preview and c.id = public.my_company_id())
     )
$$;

-- ---------------------------------------------------------------------------
-- 4. Writes (CP-REQ-001/002/004/008/009, CP-SEC-002/003): careers.edit
-- ---------------------------------------------------------------------------

create or replace function public.claim_careers_slug(p_slug text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if v_company is null or not public.has_company_permission(v_company, 'careers.edit') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not public.careers_slug_valid(v_slug) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not public.careers_slug_available(v_slug, v_company) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;
  delete from public.company_careers_slug_history where slug = v_slug;
  update public.company_info set careers_slug = v_slug where id = v_company;
  return jsonb_build_object('ok', true, 'slug', v_slug);
end $$;

-- Sections and links are validated in the app (helpers/careers/page-schema.ts);
-- the database bounds their size and shape.
create or replace function public.save_careers_page(
  p_accent_color text, p_cover_url text, p_sections jsonb, p_links jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.has_company_permission(v_company, 'careers.edit') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if (p_accent_color is not null and p_accent_color !~ '^#[0-9a-f]{6}$')
     or jsonb_typeof(coalesce(p_sections, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_sections, '[]')) > 20
     or jsonb_typeof(coalesce(p_links, '{}')) <> 'object'
     or octet_length(coalesce(p_sections, '[]')::text) > 100000
     or (p_cover_url is not null and p_cover_url !~ '^https://') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.company_info
     set careers_accent_color = p_accent_color,
         careers_cover_url = p_cover_url,
         careers_sections = coalesce(p_sections, '[]'),
         careers_links = coalesce(p_links, '{}')
   where id = v_company;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.set_careers_published(p_published boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_company uuid := public.my_company_id();
begin
  if v_company is null or not public.has_company_permission(v_company, 'careers.edit') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  update public.company_info set careers_published = coalesce(p_published, false) where id = v_company;
  return jsonb_build_object('ok', true);
end $$;

do $$
begin
  execute 'revoke all on function public.careers_slug_available(text, uuid) from public, anon, authenticated';
  execute 'revoke all on function public.unique_careers_slug(text, uuid) from public, anon, authenticated';
  execute 'revoke all on function public.protect_careers_columns() from public, anon';
  execute 'revoke all on function public.careers_page_json(public.company_info) from public, anon, authenticated';
  execute 'revoke all on function public.get_my_careers_page() from public, anon';
  execute 'revoke all on function public.claim_careers_slug(text) from public, anon';
  execute 'revoke all on function public.save_careers_page(text, text, jsonb, jsonb) from public, anon';
  execute 'revoke all on function public.set_careers_published(boolean) from public, anon';
  execute 'grant execute on function public.get_careers_page(text) to anon, authenticated, service_role';
  execute 'grant execute on function public.get_careers_jobs(text, boolean) to anon, authenticated, service_role';
  execute 'grant execute on function public.get_my_careers_page() to authenticated, service_role';
  execute 'grant execute on function public.claim_careers_slug(text) to authenticated, service_role';
  execute 'grant execute on function public.save_careers_page(text, text, jsonb, jsonb) to authenticated, service_role';
  execute 'grant execute on function public.set_careers_published(boolean) to authenticated, service_role';
end $$;

-- CP-REQ-009: cover images, public, one folder per company.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('careers', 'careers', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
