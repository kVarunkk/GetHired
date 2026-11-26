-- Job alerts, migration A (JAT-010, spec JA-REQ-001/004/005).
--
-- ADDITIVE ONLY: safe to push before the code ships. The deployed applicant
-- code reads and writes `bookmarks` with `name`, `url` and `is_alert_on`, and
-- ignores the new columns. Migration B (deleting alert-off rows, switching the
-- cron) waits until the deploy that removes the old bookmark UI is live.
--
-- `filters` is the source of truth for an alert; `url`, `name` and
-- `filters_key` are rebuilt from it on the server (helpers/job-alerts/).

alter table public.bookmarks
  add column if not exists filters jsonb not null default '{}'::jsonb,
  add column if not exists filters_key text,
  add column if not exists frequency text not null default 'weekly',
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists source text;

alter table public.bookmarks drop constraint if exists bookmarks_frequency_check;
alter table public.bookmarks
  add constraint bookmarks_frequency_check check (frequency in ('daily', 'weekly'));

-- JOB_ALERT_SOURCES in helpers/job-alerts/filters.ts.
alter table public.bookmarks drop constraint if exists bookmarks_source_check;
alter table public.bookmarks
  add constraint bookmarks_source_check check (
    source is null
    or source in ('feed_banner', 'empty_state', 'settings', 'agent', 'mcp', 'legacy_bookmark')
  );

-- The same search can't be alerted twice. Old rows have no key until the
-- backfill (JAT-071), so the index is partial.
create unique index if not exists bookmarks_user_filters_key
  on public.bookmarks (user_id, filters_key)
  where filters_key is not null;

-- The worker's due scan: active alerts by when they were last checked.
create index if not exists bookmarks_alert_due
  on public.bookmarks (last_checked_at nulls first)
  where is_alert_on;

-- ---------------------------------------------------------------------------
-- Write guard (JA-REQ-005): the derived columns are written by the server
-- (service role) only. Same pattern as 20261020130000_browser_write_guards:
-- SECURITY INVOKER so current_role is the caller's; the service role and
-- SECURITY DEFINER functions pass through. A browser write that sets one of
-- them is refused rather than silently reset, so a bug shows up.
-- ---------------------------------------------------------------------------

create or replace function public.protect_bookmarks_alert_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.filters <> '{}'::jsonb
       or new.filters_key is not null
       or new.last_sent_at is not null
       or new.last_checked_at is not null then
      raise exception 'Job alert filters are set by the server.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.filters is distinct from old.filters
     or new.filters_key is distinct from old.filters_key
     or new.last_sent_at is distinct from old.last_sent_at
     or new.last_checked_at is distinct from old.last_checked_at then
    raise exception 'Job alert filters are set by the server.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists bookmarks_protect_alert_columns on public.bookmarks;
create trigger bookmarks_protect_alert_columns
  before insert or update on public.bookmarks
  for each row execute function public.protect_bookmarks_alert_columns();
