-- Followed website links on careers pages.
--
-- The careers page's Website link is `nofollow` unless the company is
-- verified, so the platform can't be used as a link farm. A company counts as
-- verified when:
--   * its website's host is the primary owner's email domain (or a subdomain
--     of it), e.g. owner hr@acme.dev and website https://www.acme.dev; or
--   * an admin set `careers_website_followed` (service role only), for
--     companies invited by hand whose owner signed up with another address.
-- Social links and section links stay `nofollow`.

alter table public.company_info
  add column if not exists careers_website_followed boolean not null default false;

-- "https://user@www.Acme.dev:443/jobs?x" → "acme.dev". Null if there's no host.
create or replace function public.url_host(p_url text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare v text := lower(btrim(coalesce(p_url, '')));
begin
  v := regexp_replace(v, '^[a-z][a-z0-9+.-]*://', '');   -- scheme
  v := split_part(split_part(split_part(v, '/', 1), '?', 1), '#', 1);
  v := regexp_replace(v, '^.*@', '');                      -- userinfo
  v := regexp_replace(v, ':[0-9]*$', '');                  -- port
  v := regexp_replace(v, '\.$', '');                       -- trailing dot
  v := regexp_replace(v, '^www\.', '');
  return case when v ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then v end;
end $$;

-- Whether the company's Website link is followed on its careers page.
create or replace function public.careers_website_verified(c public.company_info)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    c.careers_website_followed
    or exists (
      select 1
        from auth.users u
       where u.id = c.user_id
         and public.url_host(c.website) is not null
         and public.url_host('//' || split_part(u.email, '@', 2)) is not null
         and (
           public.url_host(c.website) = public.url_host('//' || split_part(u.email, '@', 2))
           or public.url_host(c.website) like '%.' || public.url_host('//' || split_part(u.email, '@', 2))
         )
    ),
    false)
$$;

revoke all on function public.careers_website_verified(public.company_info) from public, anon, authenticated;

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
    'website_verified', public.careers_website_verified(c),
    'headquarters', c.headquarters,
    'company_size', c.company_size,
    'industry', c.industry,
    'accent_color', c.careers_accent_color,
    'cover_url', c.careers_cover_url,
    'sections', c.careers_sections,
    'links', c.careers_links
  )
$$;

-- Same as 20261017230000_careers_page.sql, plus careers_website_followed,
-- which only an admin (service role) can set.
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
      new.careers_website_followed := false;
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
    new.careers_website_followed := old.careers_website_followed;
  elsif new.careers_slug is distinct from old.careers_slug and old.careers_slug is not null then
    insert into public.company_careers_slug_history (slug, company_id, retired_at)
    values (old.careers_slug, old.id, now())
    on conflict (slug) do update set company_id = excluded.company_id, retired_at = excluded.retired_at;
  end if;
  return new;
end $$;
