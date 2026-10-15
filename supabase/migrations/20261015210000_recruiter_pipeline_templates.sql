-- Recruiter pipeline, part 3 (PLT-062, PL-TASK-030/031): email templates,
-- the scheduling link and the notification settings from §3.1.
--
-- 1. company_email_templates, RLS through is_company_member (PL-SEC-001).
-- 2. seed_default_templates, its company_info trigger and the backfill.
-- 3. company_info: scheduling_url (https only), notify_new_applicants,
--    notify_weekly_matches, last_applicant_digest_at (written by the digest
--    worker only).

-- ---------------------------------------------------------------------------
-- 1. Templates
-- ---------------------------------------------------------------------------

create table if not exists public.company_email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  purpose text not null check (purpose in ('rejection','advance','interview_invite','offer','custom')),
  name text not null check (char_length(name) between 1 and 60),
  subject text not null check (char_length(subject) between 1 and 150),
  body_md text not null check (char_length(body_md) between 1 and 5000),
  is_default boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists company_email_templates_company_purpose_idx
  on public.company_email_templates (company_id, purpose);
-- One default per purpose.
create unique index if not exists company_email_templates_one_default_idx
  on public.company_email_templates (company_id, purpose) where is_default;

alter table public.company_email_templates enable row level security;

drop policy if exists "company_email_templates_select_company" on public.company_email_templates;
create policy "company_email_templates_select_company" on public.company_email_templates
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "company_email_templates_insert_company" on public.company_email_templates;
create policy "company_email_templates_insert_company" on public.company_email_templates
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists "company_email_templates_update_company" on public.company_email_templates;
create policy "company_email_templates_update_company" on public.company_email_templates
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists "company_email_templates_delete_company" on public.company_email_templates;
create policy "company_email_templates_delete_company" on public.company_email_templates
  for delete to authenticated using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 2. Default templates (PL-REQ-007)
-- ---------------------------------------------------------------------------

-- Idempotent: a company that already has templates is left alone.
create or replace function public.seed_default_templates(p_company_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.company_email_templates where company_id = p_company_id) then
    return;
  end if;

  insert into public.company_email_templates (company_id, purpose, name, subject, body_md, is_default)
  values
    (p_company_id, 'rejection', 'Rejection',
     'Your application for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nThank you for your interest in the {{job_title}} role at {{company_name}}, and for the time you put into your application. After careful consideration, we''ve decided not to move forward with it this time.\n\nWe wish you the best in your search.\n\n{{sender_name}}\n{{company_name}}',
     true),
    (p_company_id, 'advance', 'Next steps',
     'Next steps for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nThanks for applying for {{job_title}}. We enjoyed reading your application and would like to move you to the next stage. We''ll be in touch shortly with the details.\n\n{{sender_name}}\n{{company_name}}',
     true),
    (p_company_id, 'interview_invite', 'Interview invite',
     'Interview for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nWe''d like to invite you to interview for {{job_title}}. Please pick a time that works for you: {{scheduling_link}}\n\nLooking forward to speaking with you.\n\n{{sender_name}}\n{{company_name}}',
     true),
    (p_company_id, 'offer', 'Offer',
     'An offer for {{job_title}} at {{company_name}}',
     E'Hi {{candidate_first_name}},\n\nWe''re delighted to let you know that we''d like to offer you the {{job_title}} role at {{company_name}}. We''ll follow up shortly with the details.\n\n{{sender_name}}\n{{company_name}}',
     true),
    (p_company_id, 'custom', 'Message',
     'A message from {{company_name}}',
     E'Hi {{candidate_first_name}},\n\n\n\n{{sender_name}}\n{{company_name}}',
     true);
end $$;

revoke all on function public.seed_default_templates(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_templates(uuid) to service_role;

create or replace function public.seed_default_templates_for_company()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.seed_default_templates(new.id);
  return new;
end $$;

revoke all on function public.seed_default_templates_for_company() from public, anon, authenticated;

drop trigger if exists company_info_seed_templates on public.company_info;
create trigger company_info_seed_templates
  after insert on public.company_info
  for each row execute function public.seed_default_templates_for_company();

select public.seed_default_templates(ci.id) from public.company_info ci;

-- ---------------------------------------------------------------------------
-- 3. company_info settings
-- ---------------------------------------------------------------------------

alter table public.company_info
  add column if not exists scheduling_url text,
  add column if not exists notify_new_applicants text not null default 'daily',
  add column if not exists notify_weekly_matches boolean not null default true,
  add column if not exists last_applicant_digest_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_info_scheduling_url_check') then
    alter table public.company_info add constraint company_info_scheduling_url_check
      check (scheduling_url is null
             or (scheduling_url ~ '^https://[^[:space:]<>"]+$' and char_length(scheduling_url) <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_info_notify_new_applicants_check') then
    alter table public.company_info add constraint company_info_notify_new_applicants_check
      check (notify_new_applicants in ('off','instant','daily'));
  end if;
end $$;

-- Only the digest worker (service role) moves the digest watermark.
-- SECURITY INVOKER on purpose: current_role must be the caller's role.
create or replace function public.protect_company_digest_watermark()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_role = 'authenticated' then
    if tg_op = 'INSERT' then
      new.last_applicant_digest_at := null;
    else
      new.last_applicant_digest_at := old.last_applicant_digest_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists company_info_protect_digest_watermark on public.company_info;
create trigger company_info_protect_digest_watermark
  before insert or update on public.company_info
  for each row execute function public.protect_company_digest_watermark();
