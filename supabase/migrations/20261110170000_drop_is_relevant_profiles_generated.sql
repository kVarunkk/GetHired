-- SM-ISS-011 (plan/state-machines, SMT-053): company_info.is_relevant_profiles_generated
-- was added outside the CLI and nothing reads or writes it (checked 2026-11-10:
-- no function, view, policy, trigger, index, cron job or app query names it;
-- every row is false). job_postings.matching_status is the real state.
alter table public.company_info
  drop column if exists is_relevant_profiles_generated;
