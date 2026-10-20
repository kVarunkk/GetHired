import "server-only";
import { render } from "react-email";
import NoteMentionEmail from "@/emails/NoteMentionEmail";
import { firstName } from "@/helpers/outreach/linkify";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { mentionsToText } from "./mentions";

/** TMT-071: the most of a note a mention email shows. */
export const MENTION_EXCERPT_MAX = 200;

export function mentionExcerpt(body: string): string {
  const text = mentionsToText(body).replace(/\s+/g, " ").trim();
  return text.length <= MENTION_EXCERPT_MAX ? text : `${text.slice(0, MENTION_EXCERPT_MAX - 1).trimEnd()}…`;
}

type MentionedNote = {
  id: string;
  body: string;
  application_id: string | null;
  candidate_user_id: string;
};

/**
 * Emails the teammates a note mentions (TM-REQ-009). Runs after the response,
 * with the service role. `claim_note_mention_emails` decides who gets one, in
 * SQL: still a member, can read the note, not the author, once per note, and
 * at most 20 per company per hour. Failures are logged, never thrown.
 */
export async function sendNoteMentionEmails({
  note,
  authorName,
  userIds,
}: {
  note: MentionedNote;
  authorName: string;
  userIds: string[];
}): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const service = createServiceRoleClient();
    const { data: claimed, error } = await service.rpc("claim_note_mention_emails", {
      p_note_id: note.id,
      p_user_ids: userIds,
    });
    if (error) throw new Error(error.message);
    const recipients = (claimed ?? []) as string[];
    if (recipients.length === 0) return;

    const [{ data: candidate }, { data: application }] = await Promise.all([
      service.from("user_info").select("full_name").eq("user_id", note.candidate_user_id).maybeSingle(),
      note.application_id
        ? service.from("applications").select("job_postings(title)").eq("id", note.application_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const candidateFirstName = firstName(candidate?.full_name) ?? "a candidate";
    const jobTitle = application?.job_postings?.title ?? null;
    const url = note.application_id
      ? `${deploymentUrl()}/company/applications/${note.application_id}`
      : `${deploymentUrl()}/company/profiles/${note.candidate_user_id}`;

    const message = (
      <NoteMentionEmail
        authorName={authorName}
        candidateFirstName={candidateFirstName}
        jobTitle={jobTitle}
        excerpt={mentionExcerpt(note.body)}
        url={url}
      />
    );
    const [htmlContent, textContent] = await Promise.all([
      render(message),
      render(message, { plainText: true }),
    ]);

    await Promise.all(
      recipients.map(async (userId) => {
        try {
          const { data } = await service.auth.admin.getUserById(userId);
          const toEmail = data?.user?.email;
          if (!toEmail) return;
          await sendEmail({
            toEmail,
            subject: `${authorName} mentioned you in a note on ${candidateFirstName}`,
            htmlContent,
            textContent,
          });
        } catch (err) {
          console.error("[notes] mention email failed for note", note.id, err);
        }
      }),
    );
  } catch (err) {
    console.error("[notes] mention emails failed for note", note.id, err);
  }
}
