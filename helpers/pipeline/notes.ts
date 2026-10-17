import "server-only";
import { after } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { screenFairnessText } from "@/helpers/ai/fairness";
import { parseMentions } from "@/helpers/team/mentions";
import { sendNoteMentionEmails } from "@/helpers/team/notify-mentions";
import type { Database, Tables } from "@/utils/types/database.types";
import { actorName } from "./move";
import type { CandidateRating } from "./ratings";

export { RATING_SCORE, ratingSummary, type CandidateRating, type RatingSummary } from "./ratings";

export type CandidateNote = Tables<"candidate_notes">;

type Ctx = { supabase: SupabaseClient<Database>; company: MyCompany; user: User };
type Result = { ok: true } | { ok: false; error: string };

/** PL-REQ-006. */
export const MAX_NOTE_LENGTH = 5000;

const LENGTH_ERROR = "Notes are 1 to 5,000 characters.";
export const NOTE_FAIRNESS_ERROR =
  "Notes can't mention protected characteristics such as age, gender or religion. Stick to skills and experience.";
const NOT_FOUND = { ok: false, error: "Note not found." } as const;

/** The trimmed body, or the reason it can't be saved (length, then fairness). */
function checkBody(body: string): { ok: true; body: string } | { ok: false; error: string } {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NOTE_LENGTH) return { ok: false, error: LENGTH_ERROR };
  // The same deny-list the recruiter agent's memories use (roadmap cross-cutting rule).
  if (!screenFairnessText(trimmed, { context: "memory" }).ok) {
    return { ok: false, error: NOTE_FAIRNESS_ERROR };
  }
  return { ok: true, body: trimmed };
}

/**
 * Adds a note by the session user (PL-TASK-020) on an application to one of
 * the company's jobs, or on a talent-pool candidate the company can view.
 * Writes a `note_added` event with the note's id, never its body. RLS checks
 * the same things.
 */
export async function addNote(
  { supabase, company, user }: Ctx,
  input: {
    body: string;
    rating?: CandidateRating | null;
    applicationId?: string;
    candidateUserId?: string;
  },
): Promise<{ ok: true; note: CandidateNote } | { ok: false; error: string }> {
  const checked = checkBody(input.body);
  if (!checked.ok) return checked;

  let candidateUserId: string;
  let applicationId: string | null = null;

  if (input.applicationId !== undefined) {
    if (!isUuid(input.applicationId)) return { ok: false, error: "Application not found." };
    const { data: app, error } = await supabase
      .from("applications")
      .select("id, applicant_user_id, job_postings!inner(company_id)")
      .eq("id", input.applicationId)
      .eq("job_postings.company_id", company.id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load the application: ${error.message}`);
    if (!app?.applicant_user_id) return { ok: false, error: "Application not found." };
    candidateUserId = app.applicant_user_id;
    applicationId = app.id;
  } else {
    if (!input.candidateUserId || !isUuid(input.candidateUserId)) {
      return { ok: false, error: "Candidate not found." };
    }
    const { data: canView, error } = await supabase.rpc("company_can_view_candidate", {
      p_user_id: input.candidateUserId,
    });
    if (error) throw new Error(`Failed to check the candidate: ${error.message}`);
    if (!canView) return { ok: false, error: "Candidate not found." };
    candidateUserId = input.candidateUserId;
  }

  const author = actorName(user, company);
  const rating = input.rating ?? null;
  const { data: note, error } = await supabase
    .from("candidate_notes")
    .insert({
      company_id: company.id,
      candidate_user_id: candidateUserId,
      application_id: applicationId,
      author_user_id: user.id,
      author_name: author,
      body: checked.body,
      rating,
    })
    .select("*")
    .single();
  if (error || !note) return { ok: false, error: "Couldn't save the note. Please try again." };

  const { error: eventError } = await supabase.from("application_events").insert({
    company_id: company.id,
    application_id: applicationId,
    candidate_user_id: candidateUserId,
    actor_user_id: user.id,
    actor_name: author,
    type: "note_added",
    payload: { note_id: note.id, rated: rating !== null },
  });
  // The note is saved; a missing timeline line isn't worth failing it.
  if (eventError) console.error("Failed to log note_added:", eventError.message);

  // TM-REQ-009: email the teammates it mentions, after the response.
  const mentioned = await mentionedTeammates(supabase, note.body, user.id);
  if (mentioned.length > 0) {
    after(() => sendNoteMentionEmails({ note, authorName: author ?? "A teammate", userIds: mentioned }));
  }

  return { ok: true, note };
}

/**
 * The teammates a note body mentions (`@[name](id)` tokens or a plain
 * `@name`), never the author. Empty without an `@` (no query) or when the
 * team can't be read: a missed mention isn't worth failing the note.
 */
async function mentionedTeammates(
  supabase: SupabaseClient<Database>,
  body: string,
  authorUserId: string,
): Promise<string[]> {
  if (!body.includes("@")) return [];
  const { data, error } = await supabase.rpc("list_mentionable_members");
  if (error) {
    console.error("Failed to load teammates for mentions:", error.message);
    return [];
  }
  const members = (data ?? []).map((m) => ({ userId: m.user_id, name: m.name ?? "" }));
  return parseMentions(body, members, authorUserId);
}

/** Edits the body and rating of one of the session user's own notes. */
export async function updateNote(
  { supabase, company, user }: Ctx,
  noteId: string,
  input: { body: string; rating: CandidateRating | null },
): Promise<Result> {
  const checked = checkBody(input.body);
  if (!checked.ok) return checked;
  if (!isUuid(noteId)) return NOT_FOUND;

  const { data, error } = await supabase
    .from("candidate_notes")
    .update({ body: checked.body, rating: input.rating })
    .eq("id", noteId)
    .eq("company_id", company.id)
    .eq("author_user_id", user.id)
    .select("id");
  if (error) return { ok: false, error: "Couldn't save the note. Please try again." };
  return data && data.length > 0 ? { ok: true } : NOT_FOUND;
}

/** Deletes one of the session user's own notes. */
export async function deleteNote({ supabase, company, user }: Ctx, noteId: string): Promise<Result> {
  if (!isUuid(noteId)) return NOT_FOUND;

  const { data, error } = await supabase
    .from("candidate_notes")
    .delete()
    .eq("id", noteId)
    .eq("company_id", company.id)
    .eq("author_user_id", user.id)
    .select("id");
  if (error) return { ok: false, error: "Couldn't delete the note. Please try again." };
  return data && data.length > 0 ? { ok: true } : NOT_FOUND;
}

/** The company's notes on an application or a candidate, newest first. Throws on a database error. */
export async function listNotes(
  { supabase, company }: Pick<Ctx, "supabase" | "company">,
  by: { applicationId: string } | { candidateUserId: string },
): Promise<CandidateNote[]> {
  const [column, value] =
    "applicationId" in by
      ? (["application_id", by.applicationId] as const)
      : (["candidate_user_id", by.candidateUserId] as const);

  const { data, error } = await supabase
    .from("candidate_notes")
    .select("*")
    .eq("company_id", company.id)
    .eq(column, value)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load the notes: ${error.message}`);
  return data ?? [];
}
