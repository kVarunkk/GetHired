-- Board application ingestion (plan/multiposting, MPT-030 / MPT-031,
-- MP-REQ-008). A board that takes the application on its own site (Indeed
-- Apply, later Talent Apply) POSTs it to /api/webhooks/jobboards/[platform].
-- The route checks the signature, then calls ingest_board_application with
-- the service role. Both functions are service role only: a webhook has no
-- session, so they take no company from the caller and check the channel,
-- the job and the company's opt-in themselves.

-- ---------------------------------------------------------------------------
-- 1. external_application_id is written only by ingestion
-- ---------------------------------------------------------------------------
-- The unique index on (source_detail, external_application_id) is the
-- idempotency key, so a browser must not be able to claim a board's id first.
create or replace function public.protect_application_external_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_role <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.external_application_id := null;
  elsif new.external_application_id is distinct from old.external_application_id then
    raise exception 'Only a job board can set this application''s board id.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists applications_protect_external_id on public.applications;
create trigger applications_protect_external_id
  before insert or update on public.applications
  for each row execute function public.protect_application_external_id();

-- ---------------------------------------------------------------------------
-- 2. ingest_board_application
-- ---------------------------------------------------------------------------
-- p_job_ref: the id the feed gave the board, which is the public job id
-- (job_postings.job_id, the /jobs/[job_id] page); a job_postings.id is
-- accepted too. p_applicant: full_name, email, phone. Returns
--   { ok: true, application_id, candidate_id, company_id, job_post_id, has_resume }
--   { ok: false, reason } with reason one of
--   unknown_channel, invalid, unknown_job, closed, duplicate, already_in_job.
-- Nobody is emailed from here; the company's new-application notification
-- and MT screening come from the existing insert triggers.
create or replace function public.ingest_board_application(
  p_channel text, p_job_ref uuid, p_external_id text, p_applicant jsonb, p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_channel public.distribution_channels%rowtype;
  v_job public.job_postings%rowtype;
  v_external text := nullif(btrim(p_external_id), '');
  v_email text := lower(nullif(btrim(p_applicant ->> 'email'), ''));
  v_name text := left(nullif(btrim(p_applicant ->> 'full_name'), ''), 200);
  v_phone text := left(nullif(btrim(p_applicant ->> 'phone'), ''), 50);
  v_candidate public.company_candidates%rowtype;
  v_stage uuid;
  v_app uuid;
begin
  select * into v_channel from public.distribution_channels where key = p_channel;
  if v_channel.key is null or not v_channel.enabled or v_channel.kind not in ('feed', 'partner_api') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_channel');
  end if;

  if v_external is null or length(v_external) > 200
     or v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 320
     or v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- A replay is a duplicate whatever happened to the job since.
  if exists (select 1 from public.applications a
              where a.source_detail = p_channel and a.external_application_id = v_external)
     or exists (select 1 from public.channel_events e
                 where e.channel_key = p_channel and e.idempotency_key = v_external) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  select * into v_job from public.job_postings jp where jp.job_id = p_job_ref or jp.id = p_job_ref
   order by (jp.job_id = p_job_ref) desc limit 1;
  if v_job.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_job');
  end if;

  -- Closed, the company's channel off or not approved, or this job left out:
  -- the job isn't on the board any more (Indeed's 410).
  if v_job.status is distinct from 'active'
     or not exists (select 1 from public.company_channel_settings s
                     where s.company_id = v_job.company_id and s.channel_key = p_channel
                       and s.enabled and s.status = 'live')
     or exists (select 1 from public.job_channel_postings p
                 where p.job_id = v_job.id and p.channel_key = p_channel and p.status = 'opted_out') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- BI-REQ-019: a GetHired user with this email already applied to the job.
  if exists (select 1 from public.applications a join auth.users u on u.id = a.applicant_user_id
              where a.job_post_id = v_job.id and lower(u.email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'already_in_job');
  end if;

  select * into v_candidate from public.company_candidates c
   where c.company_id = v_job.company_id and lower(c.email) = v_email
   order by c.created_at limit 1 for update;

  if v_candidate.id is not null and (
    exists (select 1 from public.applications a
             where a.company_candidate_id = v_candidate.id and a.job_post_id = v_job.id)
    or (v_candidate.claimed_user_id is not null and exists (
      select 1 from public.applications a
       where a.job_post_id = v_job.id and a.applicant_user_id = v_candidate.claimed_user_id))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_in_job');
  end if;

  if v_candidate.id is null then
    -- Never linked to a GetHired account automatically: the claim flow does that.
    insert into public.company_candidates (company_id, full_name, email, phone, created_by)
    values (v_job.company_id, v_name, v_email, v_phone, null)
    returning * into v_candidate;
  elsif v_candidate.phone is null and v_phone is not null then
    update public.company_candidates set phone = v_phone, updated_at = now() where id = v_candidate.id;
  end if;

  v_stage := public.import_job_stage(v_job.id, null);

  begin
    insert into public.applications
      (applicant_user_id, job_post_id, all_jobs_id, source, source_detail, external_application_id,
       stage_id, stage_entered_at, company_candidate_id)
    values
      (null, v_job.id, v_job.job_id, 'job_board', p_channel, v_external,
       v_stage, now(), v_candidate.id)
    returning id into v_app;
  exception when unique_violation then
    -- The same delivery arriving twice at once.
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end;

  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, actor_name, type, payload)
  values
    (v_job.company_id, v_app, null, null, v_channel.name, 'imported',
     jsonb_build_object('stage_id', v_stage, 'source', 'job_board', 'channel', p_channel,
                        'company_candidate_id', v_candidate.id));

  -- Audit and idempotency. The payload is the caller's summary, never the resume.
  insert into public.channel_events (channel_key, job_id, kind, idempotency_key, payload)
  values (p_channel, v_job.id, 'application_received', v_external,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('application_id', v_app));

  return jsonb_build_object(
    'ok', true,
    'application_id', v_app,
    'candidate_id', v_candidate.id,
    'company_id', v_job.company_id,
    'job_post_id', v_job.id,
    'has_resume', v_candidate.resume_path is not null
  );
end $$;

revoke all on function public.ingest_board_application(text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_board_application(text, uuid, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. attach_board_resume
-- ---------------------------------------------------------------------------
-- The resume a board sent, stored by the route under the candidate's folder.
-- Never replaces a resume the company already has (returns `has_resume`, and
-- the caller deletes its file). Parsed fields only fill empty ones. Returns
-- the candidate's open applications so the caller can screen them again.
create or replace function public.attach_board_resume(
  p_candidate_id uuid, p_path text, p_content jsonb default null, p_fields jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_candidate public.company_candidates%rowtype;
begin
  select * into v_candidate from public.company_candidates c where c.id = p_candidate_id for update;
  if v_candidate.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_candidate.company_id::text
     or split_part(p_path, '/', 3) <> p_candidate_id::text or p_path !~ '\.(pdf|docx)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_content is not null and jsonb_typeof(p_content -> 'sections') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_candidate.resume_path is not null then
    return jsonb_build_object('ok', false, 'reason', 'has_resume');
  end if;

  perform public.import_update_candidate(p_candidate_id, coalesce(p_fields, '{}'::jsonb) - 'email' - 'full_name', 'fill');
  update public.company_candidates set resume_path = p_path, resume_content = p_content, updated_at = now()
   where id = p_candidate_id;

  return jsonb_build_object(
    'ok', true,
    'company_id', v_candidate.company_id,
    'applications', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'job_post_id', a.job_post_id)), '[]'::jsonb)
        from public.applications a
        left join public.pipeline_stages s on s.id = a.stage_id
       where a.company_candidate_id = p_candidate_id
         and a.merged_into_application_id is null
         and coalesce(s.kind, 'applied') not in ('rejected', 'hired')
    )
  );
end $$;

revoke all on function public.attach_board_resume(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.attach_board_resume(uuid, text, jsonb, jsonb) to service_role;
