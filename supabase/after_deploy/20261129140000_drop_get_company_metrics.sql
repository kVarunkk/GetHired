-- Company dashboard (plan/company-dashboard, CD-MIG-1): the cleanup.
--
-- PUSH ONLY AFTER the new company dashboard is live in production. The old one
-- calls get_company_metrics and fails without it.
--
-- This file is kept out of supabase/migrations/ so that an earlier
-- `supabase db push` can't apply it. After the deploy:
--   1. git mv supabase/after_deploy/20261129140000_drop_get_company_metrics.sql supabase/migrations/
--   2. supabase migration list   (only this file should be pending)
--   3. supabase db push          (add --include-all if a later migration is already applied)
--   4. regenerate utils/types/database.types.ts
-- If anything else is still pending, don't use db push. Instead of steps 2 and
-- 3, apply and record this file alone:
--   supabase db query --linked -f supabase/migrations/20261129140000_drop_get_company_metrics.sql
--   supabase migration repair --status applied 20261129140000 --linked

drop function if exists public.get_company_metrics(uuid);
