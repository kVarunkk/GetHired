-- JAT-010 (JA-TST-006): migration 20261125120000_job_alerts.sql. Runs in a
-- transaction that always rolls back, so it's safe to run against the linked
-- project:
--   npx supabase db query --linked -f supabase/tests/job_alerts.sql
-- Any failed check raises an exception; success prints 'job_alerts: ok'.

begin;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'ada@alerts.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-0000000000a2', 'bob@alerts.test', 'authenticated', 'authenticated');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-0000000000a1', 'ada@alerts.test', 'Ada', true, true),
  ('a0000000-0000-4000-8000-0000000000a2', 'bob@alerts.test', 'Bob', true, true);

-- ------------------------------------------------- 1. columns and the index
do $$
declare
  v_row public.bookmarks%rowtype;
begin
  insert into public.bookmarks (user_id, name, url)
  values ('a0000000-0000-4000-8000-0000000000a1', 'Old bookmark', '/jobs?location=pune')
  returning * into v_row;
  assert v_row.filters = '{}'::jsonb, 'filters default';
  assert v_row.filters_key is null, 'filters_key default';
  assert v_row.frequency = 'weekly', 'frequency default';
  assert v_row.last_sent_at is null and v_row.last_checked_at is null, 'timestamps default';
  assert v_row.source is null, 'source default';

  begin
    update public.bookmarks set frequency = 'hourly' where id = v_row.id;
    raise exception 'frequency accepted hourly';
  exception when check_violation then null;
  end;

  begin
    update public.bookmarks set source = 'somewhere' where id = v_row.id;
    raise exception 'source accepted an unknown value';
  exception when check_violation then null;
  end;

  -- Two rows with no key are fine (old bookmarks before the backfill).
  insert into public.bookmarks (user_id, name, url)
  values ('a0000000-0000-4000-8000-0000000000a1', 'Old bookmark 2', '/jobs?location=delhi');

  insert into public.bookmarks (user_id, name, url, filters, filters_key)
  values ('a0000000-0000-4000-8000-0000000000a1', 'Pune', '/jobs?location=pune',
          '{"location":["pune"]}', '{"location":["pune"]}');
  begin
    insert into public.bookmarks (user_id, name, url, filters, filters_key)
    values ('a0000000-0000-4000-8000-0000000000a1', 'Pune again', '/jobs?location=pune',
            '{"location":["pune"]}', '{"location":["pune"]}');
    raise exception 'the same key was saved twice for one user';
  exception when unique_violation then null;
  end;
  -- The same key for another user is fine.
  insert into public.bookmarks (user_id, name, url, filters, filters_key)
  values ('a0000000-0000-4000-8000-0000000000a2', 'Pune', '/jobs?location=pune',
          '{"location":["pune"]}', '{"location":["pune"]}');
end $$;

-- ------------------------------------------------------- 2. the write guard
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","email":"ada@alerts.test"}',
  true
);
set local role authenticated;

do $$
declare
  v_id uuid;
begin
  -- The deployed code's insert (name, url) still works.
  insert into public.bookmarks (user_id, name, url)
  values ('a0000000-0000-4000-8000-0000000000a1', 'Browser bookmark', '/jobs?location=goa')
  returning id into v_id;

  begin
    insert into public.bookmarks (user_id, name, url, filters)
    values ('a0000000-0000-4000-8000-0000000000a1', 'x', '/jobs', '{"location":["x"]}');
    raise exception 'browser insert set filters';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.bookmarks (user_id, name, url, filters_key)
    values ('a0000000-0000-4000-8000-0000000000a1', 'x', '/jobs', 'k');
    raise exception 'browser insert set filters_key';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.bookmarks set filters = '{"location":["x"]}' where id = v_id;
    raise exception 'browser update set filters';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.bookmarks set filters_key = 'k' where id = v_id;
    raise exception 'browser update set filters_key';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.bookmarks set last_sent_at = now() where id = v_id;
    raise exception 'browser update set last_sent_at';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.bookmarks set last_checked_at = now() where id = v_id;
    raise exception 'browser update set last_checked_at';
  exception when insufficient_privilege then null;
  end;

  -- name and is_alert_on stay editable (the deployed UI uses them).
  update public.bookmarks set name = 'Renamed', is_alert_on = true where id = v_id;
  assert (select name from public.bookmarks where id = v_id) = 'Renamed', 'name not editable';
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
begin
  update public.bookmarks set filters = '{"location":["goa"]}', filters_key = '{"location":["goa"]}',
         last_checked_at = now(), last_sent_at = now()
   where name = 'Renamed';
  assert (select filters_key from public.bookmarks where name = 'Renamed') = '{"location":["goa"]}',
    'service role blocked';
end $$;

reset role;

-- ------------------------------------------------------ 3. the cap still holds
do $$
begin
  delete from public.bookmarks where user_id = 'a0000000-0000-4000-8000-0000000000a2';
  insert into public.bookmarks (user_id, name, url, is_alert_on)
  select 'a0000000-0000-4000-8000-0000000000a2', 'Alert ' || n, '/jobs?q=' || n, true
  from generate_series(1, 5) as n;

  -- A sixth paused alert is fine.
  insert into public.bookmarks (user_id, name, url, is_alert_on)
  values ('a0000000-0000-4000-8000-0000000000a2', 'Paused', '/jobs?q=6', false);

  begin
    update public.bookmarks set is_alert_on = true
     where user_id = 'a0000000-0000-4000-8000-0000000000a2' and name = 'Paused';
    raise exception 'turned on a sixth alert';
  exception when check_violation then null;
  end;
  begin
    insert into public.bookmarks (user_id, name, url, is_alert_on)
    values ('a0000000-0000-4000-8000-0000000000a2', 'Seventh', '/jobs?q=7', true);
    raise exception 'inserted a sixth active alert';
  exception when check_violation then null;
  end;
end $$;

-- ------------------------------------------------------ 4. cutover (migration B)
-- Keep the statements below in step with 20261128140000_job_alerts_cutover.sql.
do $$
begin
  delete from public.bookmarks where user_id = 'a0000000-0000-4000-8000-0000000000a2';
  insert into public.bookmarks (user_id, name, url, is_alert_on)
  values ('a0000000-0000-4000-8000-0000000000a2', 'Off', '/jobs?q=off', false),
         ('a0000000-0000-4000-8000-0000000000a2', 'On', '/jobs?q=on', true);

  delete from public.bookmarks where is_alert_on = false;

  assert (select count(*) from public.bookmarks where user_id = 'a0000000-0000-4000-8000-0000000000a2') = 1,
    'only the alert-on row should remain';
  assert (select name from public.bookmarks where user_id = 'a0000000-0000-4000-8000-0000000000a2') = 'On',
    'the alert-on row was deleted';

  -- The cron swap, in a savepoint-free form: run it, then check the names and schedule.
  perform cron.unschedule(jobid) from cron.job where jobname = 'weekly-bookmark-alert';
  perform cron.schedule('job-alerts', '30 3 * * *', 'select 1');
  assert exists (select 1 from cron.job where jobname = 'job-alerts' and schedule = '30 3 * * *'),
    'job-alerts cron missing';
  assert not exists (select 1 from cron.job where jobname = 'weekly-bookmark-alert'),
    'weekly-bookmark-alert still scheduled';
end $$;

select 'job_alerts: ok';

rollback;
