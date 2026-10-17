-- Recruiter teams, phase 4: @mentions in notes (plan/feature-recruiter-teams-spec.md
-- TM-REQ-009, TMT-070..072).
--
-- A note mentions teammates as `@[name](user id)` tokens (or a plain `@name`).
-- After the note is saved, the server emails each mentioned teammate once.
-- candidate_note_mentions records who was emailed for which note: its primary
-- key makes the email at most once per note and per person, and its rows give
-- the per-company hourly cap. Only the service role touches it.

create table if not exists public.candidate_note_mentions (
  note_id uuid not null references public.candidate_notes(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, mentioned_user_id)
);
create index if not exists candidate_note_mentions_company_recent
  on public.candidate_note_mentions (company_id, created_at desc);

alter table public.candidate_note_mentions enable row level security;
-- No policies and no grants: written and read by the service role only.
revoke all on public.candidate_note_mentions from public, anon, authenticated;

-- The caller's teammates, for the composer's picker and for matching plain
-- `@name` mentions. Any member who can write notes may list them; members
-- without team.view can't read company_members themselves. Only names (the
-- display name, else the email's local part, the same name notes show), never
-- emails.
create or replace function public.list_mentionable_members()
returns table (user_id uuid, name text)
language sql stable security definer
set search_path = ''
as $$
  select m.user_id, public.member_display_name(m.user_id)
    from public.company_members m
   where m.company_id = public.my_company_id()
     and public.company_permission_scope(public.my_company_id(), 'notes.write') is not null
   order by m.is_owner desc, m.created_at
$$;

-- Whether a member (not the caller) may read notes on a job's application:
-- an owner, scope 'all', or scope 'assigned' on that job. Notes without a job
-- (talent-pool candidates) need scope 'all', as in candidate_notes' select policy.
create or replace function public.member_can_view_notes(
  p_company_id uuid, p_user_id uuid, p_job_post_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.is_owner then true
      else (
        select case rp.scope::text
          when 'all' then true
          when 'assigned' then p_job_post_id is not null and exists (
            select 1 from public.company_job_assignments ja
             where ja.job_post_id = p_job_post_id and ja.company_id = p_company_id
               and ja.user_id = p_user_id
          )
          else false
        end
        from public.company_role_permissions rp
       where rp.role_id = m.role_id and rp.permission_key = 'notes.view'
      )
    end
    from public.company_members m
   where m.company_id = p_company_id and m.user_id = p_user_id
  ), false)
$$;

-- TMT-071: which of the mentioned users to email for a note, recorded in the
-- same statement. A user is emailed when they are still a member of the
-- note's company, can read the note, isn't its author and wasn't already
-- emailed for it, and while the company has sent fewer than 20 mention emails
-- in the last hour. Returns the claimed user ids.
create or replace function public.claim_note_mention_emails(p_note_id uuid, p_user_ids uuid[])
returns setof uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note record;
  v_room int;
begin
  select n.id, n.company_id, n.author_user_id, a.job_post_id
    into v_note
    from public.candidate_notes n
    left join public.applications a on a.id = n.application_id
   where n.id = p_note_id;
  if not found then return; end if;

  -- Serialise claims per company so two notes can't both pass the cap.
  perform pg_advisory_xact_lock(hashtextextended('note_mentions:' || v_note.company_id::text, 0));

  select greatest(0, 20 - count(*))::int into v_room
    from public.candidate_note_mentions c
   where c.company_id = v_note.company_id and c.created_at > now() - interval '1 hour';
  if v_room = 0 then return; end if;

  return query
  insert into public.candidate_note_mentions (note_id, company_id, mentioned_user_id)
  select v_note.id, v_note.company_id, u.id
    from (select distinct unnest(p_user_ids) as id) u
   where u.id is distinct from v_note.author_user_id
     and public.member_can_view_notes(v_note.company_id, u.id, v_note.job_post_id)
   limit v_room
  on conflict do nothing
  returning mentioned_user_id;
end;
$$;

revoke all on function public.list_mentionable_members() from public, anon;
grant execute on function public.list_mentionable_members() to authenticated, service_role;

revoke all on function public.member_can_view_notes(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_can_view_notes(uuid, uuid, uuid) to service_role;

revoke all on function public.claim_note_mention_emails(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_note_mention_emails(uuid, uuid[]) to service_role;
