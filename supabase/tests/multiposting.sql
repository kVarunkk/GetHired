-- Multiposting schema (MPT-010). Rolls back, so it is safe on the linked project
-- once 20261117130000_multiposting_schema.sql is applied:
--   npx supabase db query --linked -f supabase/tests/multiposting.sql
-- Any failed check raises an exception; success prints 'multiposting: ok'.
begin;

do $$
declare n int;
begin
  -- catalog is seeded
  select count(*) into n from public.distribution_channels where key in ('google','bing','jooble','adzuna','talent','indeed','naukri');
  if n <> 7 then raise exception 'catalog: expected 7 seeded channels, got %', n; end if;

  -- applications.source accepts job_board; unknown values are refused
  if not exists (select 1 from pg_constraint where conname = 'applications_source_check'
                 and pg_get_constraintdef(oid) like '%job_board%') then
    raise exception 'applications_source_check lacks job_board';
  end if;

  -- unique (channel, external id) index exists and is partial
  if not exists (select 1 from pg_indexes where indexname = 'applications_source_external_id_idx'
                 and indexdef like '%external_application_id IS NOT NULL%') then
    raise exception 'unique external application id index missing';
  end if;

  -- clients cannot read BYO credentials or channel_events, nor write postings
  if has_column_privilege('authenticated', 'public.company_channel_settings', 'config_encrypted', 'select') then
    raise exception 'config_encrypted readable by authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.channel_events', 'select') then
    raise exception 'channel_events readable by authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.job_channel_postings', 'insert')
     or has_table_privilege('authenticated', 'public.job_channel_postings', 'update') then
    raise exception 'job_channel_postings writable by authenticated';
  end if;

  -- RLS is on everywhere
  if exists (select 1 from pg_class where relname in ('distribution_channels','company_channel_settings','job_channel_postings','channel_events')
             and relnamespace = 'public'::regnamespace and not relrowsecurity) then
    raise exception 'RLS disabled on a multiposting table';
  end if;
end $$;

select 'multiposting: ok';
rollback;
