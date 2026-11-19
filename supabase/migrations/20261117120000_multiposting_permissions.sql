-- Multiposting permissions (plan/multiposting, MPT-011 / MP-REQ-001).
-- `distribution.view` shows a job's Distribution section; `distribution.manage`
-- opts channels and jobs in or out. Both can be scoped to assigned jobs.
-- seed_company_roles gives new Admin roles every key in company_permissions,
-- and Member gets neither, so it needs no change.

insert into public.company_permissions (key, scopable, requires) values
  ('distribution.view', true, '{jobs.view}'),
  ('distribution.manage', true, '{distribution.view}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

-- Existing Admin roles (RP-REQ-004: every permission but company.profile).
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, k, 'all'
  from public.company_roles r
 cross join unnest(array['distribution.view', 'distribution.manage']) k
 where r.template_key = 'admin'
on conflict do nothing;
