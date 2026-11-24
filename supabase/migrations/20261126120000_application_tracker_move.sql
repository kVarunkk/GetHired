-- Application tracker, migration B (plan/application-tracker/feature-application-tracker-spec.md
-- §7.1 step 3 and §7.2, task ATT-070). Data only.
--
-- PUSH THIS ONLY AFTER THE APP THAT READS THE TRACKER IS LIVE (ATT-071):
-- until then the deployed code still reads external applications from
-- `applications`, and the rows would disappear from the Applied tab.
--
-- Moves every external application (an `applications` row with no
-- job_post_id, on a board job, from a GetHired applicant) into
-- tracked_applications, then deletes it. `applications` is left holding only
-- company applications. Run it once; running it again moves nothing, and a
-- row that is already tracked is never duplicated (the unique index on
-- (user_id, all_jobs_id) refuses it, and the old row is dropped anyway).
--
-- The work lives in a function so supabase/tests/application_tracker.sql
-- (block 6) can run it twice. The cleanup migration (ATT-072) drops it.
--
-- Mapping (§7.2): submitted -> applied, reviewed -> in_review,
-- stand_by -> in_review, selected -> offer, rejected -> rejected.

create or replace function public.move_external_applications_to_tracker()
returns table (moved integer, removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
  v_removed integer;
begin
  -- Keep each row's own dates: the guard trigger would stamp "now" on every
  -- insert, and the cap doesn't apply to rows that are already the user's.
  alter table public.tracked_applications disable trigger tracked_applications_guard;

  begin
    insert into public.tracked_applications (
      user_id, all_jobs_id, job_title, company_name, job_url, location,
      status, status_changed_at, applied_at, resume_id, source, created_at, updated_at
    )
    select
      a.applicant_user_id,
      a.all_jobs_id,
      coalesce(nullif(left(btrim(j.job_name), 200), ''), 'Untitled job'),
      coalesce(nullif(left(btrim(j.company_name), 200), ''), 'Unknown company'),
      case when j.job_url ~ '^https://[^\s]+$' and char_length(j.job_url) <= 2048 then j.job_url end,
      nullif(left(btrim(j.locations[1]), 200), ''),
      case a.status
        when 'submitted' then 'applied'
        when 'reviewed' then 'in_review'
        when 'stand_by' then 'in_review'
        when 'selected' then 'offer'
        when 'rejected' then 'rejected'
        else 'applied'
      end::public.tracked_application_status,
      a.updated_at,
      (a.created_at at time zone 'utc')::date,
      (select r.id from public.resumes r where r.id = a.resume_id),
      'migrated',
      a.created_at,
      a.updated_at
    from public.applications a
    left join public.all_jobs j on j.id = a.all_jobs_id
    where a.job_post_id is null
      and a.all_jobs_id is not null
      and a.company_candidate_id is null
      and a.applicant_user_id is not null
    on conflict do nothing;
    get diagnostics v_moved = row_count;

    -- Every external row now has a tracked twin (new, or there already), so
    -- the original can go.
    delete from public.applications a
    where a.job_post_id is null
      and a.all_jobs_id is not null
      and a.company_candidate_id is null
      and a.applicant_user_id is not null
      and exists (
        select 1 from public.tracked_applications t
        where t.user_id = a.applicant_user_id and t.all_jobs_id = a.all_jobs_id
      );
    get diagnostics v_removed = row_count;
  exception when others then
    alter table public.tracked_applications enable trigger tracked_applications_guard;
    raise;
  end;

  alter table public.tracked_applications enable trigger tracked_applications_guard;
  return query select v_moved, v_removed;
end;
$$;

revoke all on function public.move_external_applications_to_tracker() from public, anon, authenticated;
grant execute on function public.move_external_applications_to_tracker() to service_role;

-- One transaction: the migration runner wraps this file in one.
select * from public.move_external_applications_to_tracker();
