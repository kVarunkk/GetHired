-- The deferred constraint triggers fire at commit, after the security-definer
-- RPC that wrote the rows has returned, so they run as the calling user under
-- RLS. company_members RLS hides the owners from anyone without team.view, so
-- accepting an invite failed with "A company needs at least one owner"; and
-- check_role_dependencies skipped its check whenever the caller couldn't see
-- the role. Run both as their owner so they see every row.
alter function public.check_company_owners() security definer;
alter function public.check_role_dependencies() security definer;
