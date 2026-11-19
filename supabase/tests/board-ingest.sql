-- Board application ingestion (MPT-030/031). Rolls back, so it is safe on the
-- linked project once 20261118120000_board_application_ingest.sql is applied:
--   npx supabase db query --linked -f supabase/tests/board-ingest.sql
-- Any failed check raises an exception; success prints 'board-ingest: ok'.
begin;

do $$
declare r jsonb;
begin
  -- service role only
  if has_function_privilege('authenticated', 'public.ingest_board_application(text, uuid, text, jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.ingest_board_application(text, uuid, text, jsonb, jsonb)', 'execute') then
    raise exception 'ingest_board_application callable by a client';
  end if;
  if has_function_privilege('authenticated', 'public.attach_board_resume(uuid, text, jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.attach_board_resume(uuid, text, jsonb, jsonb)', 'execute') then
    raise exception 'attach_board_resume callable by a client';
  end if;

  -- browsers can't set the board's id
  if not exists (select 1 from pg_trigger where tgname = 'applications_protect_external_id'
                 and tgrelid = 'public.applications'::regclass) then
    raise exception 'applications_protect_external_id trigger missing';
  end if;

  -- index channels and unknown keys take no applications
  r := public.ingest_board_application('google', gen_random_uuid(), 'x1',
         '{"full_name":"A","email":"a@example.com"}'::jsonb);
  if r ->> 'reason' <> 'unknown_channel' then raise exception 'index channel: %', r; end if;
  r := public.ingest_board_application('nope', gen_random_uuid(), 'x1',
         '{"full_name":"A","email":"a@example.com"}'::jsonb);
  if r ->> 'reason' <> 'unknown_channel' then raise exception 'unknown channel: %', r; end if;

  -- missing id, email or name
  r := public.ingest_board_application('indeed', gen_random_uuid(), ' ',
         '{"full_name":"A","email":"a@example.com"}'::jsonb);
  if r ->> 'reason' <> 'invalid' then raise exception 'blank id: %', r; end if;
  r := public.ingest_board_application('indeed', gen_random_uuid(), 'x1', '{"full_name":"A","email":"nope"}'::jsonb);
  if r ->> 'reason' <> 'invalid' then raise exception 'bad email: %', r; end if;
  r := public.ingest_board_application('indeed', gen_random_uuid(), 'x1', '{"email":"a@example.com"}'::jsonb);
  if r ->> 'reason' <> 'invalid' then raise exception 'no name: %', r; end if;

  -- a job that doesn't exist
  r := public.ingest_board_application('indeed', gen_random_uuid(), 'board-ingest-test-1',
         '{"full_name":"A","email":"a@example.com"}'::jsonb);
  if r ->> 'reason' <> 'unknown_job' then raise exception 'unknown job: %', r; end if;

  -- a replayed id is a duplicate before anything else is looked at
  insert into public.channel_events (channel_key, kind, idempotency_key)
  values ('indeed', 'application_received', 'board-ingest-test-2');
  r := public.ingest_board_application('indeed', gen_random_uuid(), 'board-ingest-test-2',
         '{"full_name":"A","email":"a@example.com"}'::jsonb);
  if r ->> 'reason' <> 'duplicate' then raise exception 'replay: %', r; end if;

  -- attach_board_resume: unknown candidate
  r := public.attach_board_resume(gen_random_uuid(), 'x/candidates/y/z.pdf');
  if r ->> 'reason' <> 'not_found' then raise exception 'attach unknown: %', r; end if;

  raise notice 'board-ingest: ok';
end $$;

rollback;
