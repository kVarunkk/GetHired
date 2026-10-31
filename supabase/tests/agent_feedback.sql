-- Agent feedback (plan/agent-feedback/feature-agent-feedback-tasks.md, AFT-010):
-- the agent_feedback table's checks, unique key, RLS and update trigger, the
-- cascade from agent_sessions, and agent_sessions.feedback_requested_at. Runs
-- in a transaction that always rolls back, so it's safe against the linked
-- project once the migration is applied:
--   npx supabase db query --linked -f supabase/tests/agent_feedback.sql
-- Any failed check raises an exception; success prints 'agent_feedback: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
-- Runs p_sql and raises unless it fails.
create function pg_temp.refused(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception '%: expected an error', p_label;
end $$;
grant execute on function pg_temp.act(uuid), pg_temp.refused(text, text) to authenticated, anon;

-- Seed: users A and B, one session each, one assistant message each.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('af000000-0000-4000-8000-00000000000a', 'a@feedback.test', 'authenticated', 'authenticated', now(), '{}'),
  ('af000000-0000-4000-8000-00000000000b', 'b@feedback.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.agent_sessions (id, user_id) values
  ('af100000-0000-4000-8000-00000000000a', 'af000000-0000-4000-8000-00000000000a'),
  ('af100000-0000-4000-8000-00000000000b', 'af000000-0000-4000-8000-00000000000b');

insert into public.agent_messages (id, session_id, user_id, role, parts) values
  ('msg-a', 'af100000-0000-4000-8000-00000000000a', 'af000000-0000-4000-8000-00000000000a', 'assistant', '[]'),
  ('msg-b', 'af100000-0000-4000-8000-00000000000b', 'af000000-0000-4000-8000-00000000000b', 'assistant', '[]');

-- feedback_requested_at exists, defaults to null, and the partial index exists.
do $$
begin
  if (select feedback_requested_at from public.agent_sessions
       where id = 'af100000-0000-4000-8000-00000000000a') is not null then
    raise exception 'feedback_requested_at should default to null';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'agent_sessions_user_feedback_idx'
                    and indexdef ilike '%where (feedback_requested_at is not null)%') then
    raise exception 'agent_sessions_user_feedback_idx is missing or not partial';
  end if;
end $$;

-- Checks and the unique key (as the table owner).
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'reply', 0)$$,
  'reply rating 0');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'reply', 2)$$,
  'reply rating 2');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'reply')$$,
  'reply with no rating');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating, dismissed)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'reply', 1, true)$$,
  'dismissed reply');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'survey', 6)$$,
  'survey rating 6');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'survey')$$,
  'survey with no rating and not dismissed');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating, dismissed)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'survey', 3, true)$$,
  'dismissed survey with a rating');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating, comment)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'reply', 1, repeat('x', 2001))$$,
  'comment over 2000 characters');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'admin', 'reply', 1)$$,
  'unknown agent_role');

-- RLS: A writes and reads their own rows.
set local role authenticated;
select pg_temp.act('af000000-0000-4000-8000-00000000000a');

insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating, comment)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'reply', -1, repeat('x', 2000));
-- A reply and a survey row on the same message are allowed.
insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, dismissed)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'survey', true);

select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-a', 'applicant', 'reply', 1)$$,
  'second reply row for the same message');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000b', 'af100000-0000-4000-8000-00000000000b', 'msg-b', 'applicant', 'reply', 1)$$,
  'A inserting a row as B');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000b', 'msg-b', 'applicant', 'reply', 1)$$,
  'A inserting into B''s session');
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-0000000000ff', 'msg-x', 'applicant', 'reply', 1)$$,
  'A inserting into a session that does not exist');

-- The update trigger: updated_at moves, identity columns can't change.
do $$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  select updated_at into v_before from public.agent_feedback where message_id = 'msg-a' and kind = 'reply';
  perform pg_sleep(0.01);
  -- now() is fixed for the transaction, so move the stored value back to see it change.
  update public.agent_feedback set updated_at = v_before - interval '1 hour', rating = 1
   where message_id = 'msg-a' and kind = 'reply';
  select updated_at into v_after from public.agent_feedback where message_id = 'msg-a' and kind = 'reply';
  if v_after is distinct from now() then
    raise exception 'updated_at should be set by the trigger, got %', v_after;
  end if;
end $$;
select pg_temp.refused($$update public.agent_feedback set message_id = 'msg-z' where message_id = 'msg-a' and kind = 'reply'$$, 'changing message_id');
select pg_temp.refused($$update public.agent_feedback set kind = 'survey', rating = 4 where message_id = 'msg-a' and kind = 'reply'$$, 'changing kind');
select pg_temp.refused($$update public.agent_feedback set agent_role = 'company' where message_id = 'msg-a' and kind = 'reply'$$, 'changing agent_role');
select pg_temp.refused($$update public.agent_feedback set session_id = 'af100000-0000-4000-8000-00000000000b' where message_id = 'msg-a' and kind = 'reply'$$, 'changing session_id');

-- B's row, seen from A.
reset role;
insert into public.agent_feedback (id, user_id, session_id, message_id, agent_role, kind, rating)
  values ('af200000-0000-4000-8000-00000000000b', 'af000000-0000-4000-8000-00000000000b',
          'af100000-0000-4000-8000-00000000000b', 'msg-b', 'company', 'reply', 1);
select pg_temp.refused($$update public.agent_feedback set user_id = 'af000000-0000-4000-8000-00000000000a'
  where id = 'af200000-0000-4000-8000-00000000000b'$$, 'changing user_id');

set local role authenticated;
select pg_temp.act('af000000-0000-4000-8000-00000000000a');
do $$
declare
  v_count int;
begin
  if exists (select 1 from public.agent_feedback where id = 'af200000-0000-4000-8000-00000000000b') then
    raise exception 'A can read B''s feedback';
  end if;
  update public.agent_feedback set rating = -1 where id = 'af200000-0000-4000-8000-00000000000b';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'A updated B''s feedback'; end if;
  delete from public.agent_feedback where id = 'af200000-0000-4000-8000-00000000000b';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'A deleted B''s feedback'; end if;
  if (select count(*) from public.agent_feedback) <> 2 then
    raise exception 'A should see exactly their two rows';
  end if;
end $$;

-- anon can't do anything.
reset role;
set local role anon;
select pg_temp.act(null);
do $$
begin
  if exists (select 1 from public.agent_feedback) then
    raise exception 'anon can read agent_feedback';
  end if;
end $$;
select pg_temp.refused($$insert into public.agent_feedback (user_id, session_id, message_id, agent_role, kind, rating)
  values ('af000000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-00000000000a', 'msg-n', 'applicant', 'reply', 1)$$,
  'anon insert');

-- Deleting the session deletes its feedback.
reset role;
delete from public.agent_sessions where id = 'af100000-0000-4000-8000-00000000000a';
do $$
begin
  if exists (select 1 from public.agent_feedback where session_id = 'af100000-0000-4000-8000-00000000000a') then
    raise exception 'deleting the session should delete its feedback';
  end if;
end $$;

select 'agent_feedback: ok';

rollback;
