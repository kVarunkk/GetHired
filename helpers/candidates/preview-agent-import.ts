import "server-only";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { reviewImport, type ReviewRow } from "./staged-import";

const uuid = z.string().uuid();

const destinationSchema = {
  jobPostId: uuid.nullable().optional(),
  stageId: uuid.optional(),
  talentListId: uuid.optional(),
  newListName: z.string().trim().min(1).max(60).optional(),
};

const importSchema = z.object({ batchId: uuid, ...destinationSchema });
const candidateSchema = z.object({ full_name: z.string().max(120).optional(), ...destinationSchema });
const deleteSchema = z.object({ candidateIds: z.array(uuid).min(1).max(50) });

/** Where the people go, by name. */
export type DestinationPreview = {
  jobTitle: string | null;
  /** Null with a job: its first stage. */
  stageName: string | null;
  listName: string | null;
  newList: boolean;
};

export type ImportPreview =
  | ({
      ok: true;
      kind: "spreadsheet" | "resumes";
      fileName: string | null;
      /** Rows that will be imported or linked. */
      importing: number;
      /** Already on GetHired: linked, not imported again. */
      known: number;
      /** Already the company's candidates: the duplicate action applies. */
      existing: number;
      /** Left out: rows that need a fix, failed, repeats or still being read. */
      leftOut: number;
      /** Imported, but not added to the job without an email (spreadsheets). */
      noEmailForJob: number;
      /** Resumes going into a job without an email: the import is refused until they have one. */
      missingEmail: number;
      reading: number;
    } & DestinationPreview)
  | { ok: false; error: string };

export type AddCandidatePreview = ({ ok: true; name: string } & DestinationPreview) | { ok: false; error: string };

export type DeleteCandidatesPreview =
  | { ok: true; candidates: { id: string; name: string; jobs: number }[]; notFound: number }
  | { ok: false; error: string };

async function destinationOf(
  auth: CompanySessionContext,
  input: { jobPostId?: string | null; stageId?: string; talentListId?: string; newListName?: string },
): Promise<DestinationPreview | { error: string }> {
  const { supabase, company } = auth;
  const [job, stage, list] = await Promise.all([
    input.jobPostId
      ? supabase.from("job_postings").select("title").eq("id", input.jobPostId).eq("company_id", company.id).maybeSingle()
      : Promise.resolve({ data: null }),
    input.jobPostId && input.stageId
      ? supabase.from("pipeline_stages").select("name").eq("id", input.stageId).eq("company_id", company.id).maybeSingle()
      : Promise.resolve({ data: null }),
    input.talentListId
      ? supabase.from("talent_lists").select("name").eq("id", input.talentListId).eq("company_id", company.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (input.jobPostId && !job.data) return { error: "Job post not found." };
  if (input.jobPostId && input.stageId && !stage.data) return { error: "Pick one of your pipeline stages." };
  if (input.talentListId && !list.data) return { error: "Talent list not found." };
  return {
    jobTitle: job.data?.title ?? null,
    stageName: stage.data?.name ?? null,
    listName: list.data?.name ?? input.newListName ?? null,
    newList: !input.talentListId && !!input.newListName,
  };
}

/**
 * BI-REQ-060: what a proposed `confirmImport` would do: the file, the
 * destination by name, and how many rows go in, are linked or are left out.
 * Writes nothing; the confirm checks everything again. The batch is read
 * through RLS. Shared by the agent's approval card and MCP's confirmation.
 */
export async function previewAgentImport(auth: CompanySessionContext, input: unknown): Promise<ImportPreview> {
  const denied = companyAllows(auth.company, { permission: "applicants.import" });
  if (denied) return { ok: false, error: denied };
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this request." };

  const [review, destination] = await Promise.all([reviewImport(auth, parsed.data.batchId), destinationOf(auth, parsed.data)]);
  if (!review) return { ok: false, error: "Import not found." };
  if ("error" in destination) return { ok: false, error: destination.error };
  if (review.batch.status === "confirmed") return { ok: false, error: "This import was already confirmed." };

  const toJob = !!parsed.data.jobPostId;
  const rows = review.rows;
  const count = (pick: (r: ReviewRow) => boolean) => rows.filter(pick).length;
  const importable = (r: ReviewRow) =>
    r.status === "ready" || r.status === "existing" || r.status === "known" || r.status === "needs_email";
  const noEmail = (r: ReviewRow) => importable(r) && r.status !== "known" && !r.fields.email;
  return {
    ok: true,
    kind: review.batch.kind,
    fileName: review.batch.fileName,
    importing: count(importable),
    known: count((r) => r.status === "known"),
    existing: count((r) => r.status === "existing"),
    leftOut: count((r) => !importable(r)),
    noEmailForJob: toJob && review.batch.kind === "spreadsheet" ? count(noEmail) : 0,
    missingEmail: toJob && review.batch.kind === "resumes" ? count(noEmail) : 0,
    reading: review.counts.reading ?? 0,
    ...destination,
  };
}

/** BI-REQ-060: the destination of a proposed `addCandidate`, by name. Writes nothing. */
export async function previewAgentAddCandidate(auth: CompanySessionContext, input: unknown): Promise<AddCandidatePreview> {
  const denied = companyAllows(auth.company, { permission: "applicants.import" });
  if (denied) return { ok: false, error: denied };
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this request." };
  const destination = await destinationOf(auth, parsed.data);
  if ("error" in destination) return { ok: false, error: destination.error };
  return { ok: true, name: parsed.data.full_name ?? "", ...destination };
}

/**
 * BI-REQ-060: who a proposed `deleteMyCandidates` would delete, by name,
 * with how many jobs each is in. Writes nothing.
 */
export async function previewAgentDeleteCandidates(
  auth: CompanySessionContext,
  input: unknown,
): Promise<DeleteCandidatesPreview> {
  const denied = companyAllows(auth.company, { permission: "applicants.import", jobId: null });
  if (denied) return { ok: false, error: denied };
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this request." };
  const ids = [...new Set(parsed.data.candidateIds)];

  const { data, error } = await auth.supabase
    .from("company_candidates")
    .select("id, full_name, applications(count)")
    .eq("company_id", auth.company.id)
    .in("id", ids);
  if (error) return { ok: false, error: "Couldn't load the candidates." };
  const rows = (data ?? []) as unknown as { id: string; full_name: string; applications: { count: number }[] }[];
  return {
    ok: true,
    candidates: rows.map((r) => ({ id: r.id, name: r.full_name, jobs: r.applications?.[0]?.count ?? 0 })),
    notFound: ids.length - rows.length,
  };
}
