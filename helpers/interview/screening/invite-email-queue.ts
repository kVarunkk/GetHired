export const SCREENING_INVITE_EMAIL_QUEUE = "screening_invite_email_queue";
/** Reads before the worker gives up on a message. */
export const SCREENING_INVITE_EMAIL_MAX_READS = 5;

/**
 * One invite email. create_screening_invite and manage_screening_interview's
 * reopen queue it in the invite's transaction; the worker loads everything
 * else when it sends.
 */
export type ScreeningInviteEmailMessage = { application_interview_id: string };
