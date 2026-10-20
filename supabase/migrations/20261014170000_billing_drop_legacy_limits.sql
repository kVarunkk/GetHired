-- Billing spec phase 4 (BL-TASK-036, BLT-106): the old plan limit columns.
-- Limits now live in tier_entitlements (active_job_posts, profiles_per_search),
-- and nothing reads company_info.ai_search_uses. job_posts_created stays for
-- history; nothing increments it any more (BL-DEC-007).
-- Apply only after the code that reads entitlements is deployed.

-- The guard no longer mentions ai_search_uses.
create or replace function public.protect_company_info_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role = 'authenticated' then
    if tg_op = 'INSERT' then
      -- The column defaults: new companies start on the free tier.
      new.tier_id := (select t.id from public.company_tiers t where t.slug = 'free');
      new.ai_credits := 50;
      new.job_posts_created := 0;
    else
      new.tier_id := old.tier_id;
      new.ai_credits := old.ai_credits;
      new.job_posts_created := old.job_posts_created;
    end if;
  end if;
  return new;
end;
$$;

alter table public.company_tiers
  drop column if exists allowed_job_posts,
  drop column if exists allowed_profiles;

alter table public.company_info drop column if exists ai_search_uses;
