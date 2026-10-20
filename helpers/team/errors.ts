/** TM-REQ-003: the exact text for an invite opened by a candidate account. */
export const APPLICANT_INVITE_MESSAGE =
  "This email already has a GetHired candidate account (signing in with Google creates one). Ask for an invite to a different email, such as your work email.";

export const INVALID_INVITE_MESSAGE = "This invite link isn't valid any more. Ask for a new one.";

/**
 * User copy for the `reason` the team and role RPCs return (`{ ok: false,
 * reason }`, supabase/migrations/*_recruiter_team*.sql and *_recruiter_roles.sql).
 * Unknown reasons fall back to a generic message, so a new DB reason never
 * leaks raw. RP-RISK-005: no message names a role.
 */
const MESSAGES: Record<string, string> = {
  forbidden: "Your role doesn't allow this.",
  invalid_role: "Choose one of your company's roles.",
  invalid_email: "Enter a valid email address.",
  already_member: "That person is already on your team.",
  already_invited: "That email already has an open invite. Resend it instead.",
  seat_limit: "Your plan's seats are all in use. Upgrade to add more.",
  not_found: "That person, role or invite isn't on your team.",
  owner: "Only owners can change another owner.",
  invalid_target: "Choose another member of your team.",
  invalid_name: "Use a name between 1 and 40 characters and a description under 200.",
  not_member: "You're not part of a company.",
  not_signed_in: "Sign in to accept the invite.",
  // Roles (RP-REQ-012).
  above_ceiling: "That includes permissions or limits your own role doesn't have.",
  own_role: "You can't change your own role or what it allows. Ask someone else on your team.",
  name_taken: "Another role already has that name.",
  has_members: "Move this role's members and open invites to another role first.",
  is_default: "This is the role new invites get. Make another role the default first.",
  invalid_grant: "One of those permissions isn't valid.",
  invalid_limit: "Limits must be whole numbers, 0 or more.",
  // Owners (RP-REQ-006).
  primary_owner: "The primary owner can't do this. Make another owner primary first.",
  last_owner: "A company needs at least one owner.",
  not_owner: "That person isn't an owner. Make them an owner first.",
  invalid: INVALID_INVITE_MESSAGE,
  revoked: INVALID_INVITE_MESSAGE,
  used: INVALID_INVITE_MESSAGE,
  expired: INVALID_INVITE_MESSAGE,
  unconfirmed: "Confirm your email address first, then open the invite link again.",
  wrong_email: "This invite was sent to a different email address. Sign in with that email to accept it.",
  applicant: APPLICANT_INVITE_MESSAGE,
};

export const TEAM_FALLBACK_ERROR = "Something went wrong. Please try again.";

export function teamErrorMessage(reason: unknown): string {
  return (typeof reason === "string" && MESSAGES[reason]) || TEAM_FALLBACK_ERROR;
}

/** The jsonb every team RPC returns. */
export type TeamRpcResult = { ok: true; [key: string]: unknown } | { ok: false; reason: string };

export function asTeamRpcResult(data: unknown): TeamRpcResult {
  if (data && typeof data === "object" && "ok" in data) return data as TeamRpcResult;
  return { ok: false, reason: "unknown" };
}
