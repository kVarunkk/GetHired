"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  addCompanyCandidateToTalentList,
  addToTalentList,
  createTalentList,
  deleteTalentList,
  removeCompanyCandidateFromTalentList,
  removeFromTalentList,
  renameTalentList,
  type TalentList,
} from "@/helpers/pipeline/talent-lists";

const uuid = z.string().uuid();
const name = z.string().max(200);
// A GetHired candidate or one of the company's own (BI-REQ-006), never both.
const candidate = { candidateUserId: uuid.optional(), companyCandidateId: uuid.optional() };
const inputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), name, ...candidate }).strict(),
  z.object({ op: z.literal("rename"), listId: uuid, name }).strict(),
  z.object({ op: z.literal("delete"), listId: uuid }).strict(),
  z.object({ op: z.literal("add"), listId: uuid, ...candidate }).strict(),
  z.object({ op: z.literal("remove"), listId: uuid, ...candidate }).strict(),
]);

export type SaveTalentListResult = { ok: true; list?: TalentList } | { ok: false; error: string };

type Auth = Parameters<typeof addToTalentList>[0];
type Candidate = { candidateUserId?: string; companyCandidateId?: string };

const addMember = (auth: Auth, listId: string, c: Candidate) =>
  c.companyCandidateId
    ? addCompanyCandidateToTalentList(auth, listId, c.companyCandidateId)
    : addToTalentList(auth, listId, c.candidateUserId!);

const removeMember = (auth: Auth, listId: string, c: Candidate) =>
  c.companyCandidateId
    ? removeCompanyCandidateFromTalentList(auth, listId, c.companyCandidateId)
    : removeFromTalentList(auth, listId, c.candidateUserId!);

/**
 * SERVER ACTION (PL-TASK-051): one change to the session company's talent
 * lists. `create` with a candidate also adds them, for "New list…" on a card.
 */
export async function saveTalentListAction(input: z.input<typeof inputSchema>): Promise<SaveTalentListResult> {
  const auth = await requireCompanyForAction({ permission: "talent_lists.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't save that change." };
  const change = parsed.data;
  if ("candidateUserId" in change && change.candidateUserId && change.companyCandidateId) {
    return { ok: false, error: "Couldn't save that change." };
  }
  if ((change.op === "add" || change.op === "remove") && !change.candidateUserId && !change.companyCandidateId) {
    return { ok: false, error: "Couldn't save that change." };
  }

  let result: SaveTalentListResult;
  switch (change.op) {
    case "create": {
      const created = await createTalentList(auth, change.name);
      if (created.ok && (change.candidateUserId || change.companyCandidateId)) {
        const added = await addMember(auth, created.list.id, change);
        result = added.ok ? created : added;
      } else {
        result = created;
      }
      break;
    }
    case "rename":
      result = await renameTalentList(auth, change.listId, change.name);
      break;
    case "delete":
      result = await deleteTalentList(auth, change.listId);
      break;
    case "add":
      result = await addMember(auth, change.listId, change);
      break;
    case "remove":
      result = await removeMember(auth, change.listId, change);
      break;
  }

  if (result.ok) {
    revalidatePath("/company/profiles");
    if ("companyCandidateId" in change && change.companyCandidateId) {
      revalidatePath(`/company/candidates/${change.companyCandidateId}`);
    }
  }
  return result;
}
