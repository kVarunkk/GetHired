-- Short confirmation tokens for MCP clients that can't elicit (MCP spec §4.6 B).
--
-- The signed confirmation_token was ~200 characters, and models copying it
-- back changed a few, so confirmations failed until a copy came out exact.
-- Now the preview stores the confirmation here, unused, and the model gets a
-- 10-character code. claim_mcp_confirmation checks the code against the
-- session user and the input's digest, and uses it up once.
--
-- The elicitation path (A) is unchanged: it still inserts an already-used
-- row on claim, with no code or digest.
--
-- Only /api/mcp uses this table, so nothing deployed reads or writes it.

alter table public.mcp_confirmations
  add column if not exists code text unique,
  add column if not exists digest text,
  alter column used_at drop not null;

alter table public.mcp_confirmations
  drop constraint if exists mcp_confirmations_code_digest;
alter table public.mcp_confirmations
  add constraint mcp_confirmations_code_digest check ((code is null) = (digest is null));

-- Returns 'claimed', or why not: 'invalid' (no such code for this user),
-- 'expired', 'mismatch' (another tool or input) or 'used'.
create or replace function public.claim_mcp_confirmation(p_code text, p_digest text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_row public.mcp_confirmations;
begin
  select * into found_row
  from public.mcp_confirmations
  where code = p_code and user_id = (select auth.uid())
  for update;

  if not found then
    return 'invalid';
  end if;
  if found_row.expires_at <= now() then
    return 'expired';
  end if;
  if found_row.digest is distinct from p_digest then
    return 'mismatch';
  end if;
  if found_row.used_at is not null then
    return 'used';
  end if;

  update public.mcp_confirmations set used_at = now() where jti = found_row.jti;
  return 'claimed';
end;
$$;

revoke all on function public.claim_mcp_confirmation(text, text) from public, anon;
grant execute on function public.claim_mcp_confirmation(text, text) to authenticated;
