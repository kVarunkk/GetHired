-- Tighten the grants on the application-form tables (AF-SEC-003).
--
-- 20261017220000 revoked from public and anon only, so Supabase's default
-- privileges left authenticated with ALL (including TRUNCATE, which skips
-- RLS). Reset authenticated to what each table needs; RLS still decides rows.

revoke all on public.job_posting_form_rules from authenticated;
grant select on public.job_posting_form_rules to authenticated;

revoke all on public.application_knockouts from authenticated;
grant select on public.application_knockouts to authenticated;

revoke all on public.company_question_sets from authenticated;
grant select, insert, update, delete on public.company_question_sets to authenticated;
