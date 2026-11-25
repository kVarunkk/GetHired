-- Job states (JLT-011 fix): set_job_post_state writes 'job.state_changed' to
-- the company audit log, which the action check didn't allow, so every move
-- (and the set_job_post_status wrapper) failed.

alter table public.company_audit_log drop constraint company_audit_log_action_check;
alter table public.company_audit_log add constraint company_audit_log_action_check check (action = any (array[
  'role.created', 'role.updated', 'role.deleted', 'role.default_changed',
  'member.role_changed', 'member.removed', 'member.left',
  'owner.added', 'owner.removed', 'owner.primary_changed',
  'invite.created', 'invite.revoked', 'invite.accepted',
  'job.assigned', 'job.unassigned',
  'candidates.imported', 'candidates.deleted',
  'job.state_changed'
]));
