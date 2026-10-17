"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  addToTalentList,
  createTalentList,
  deleteTalentList,
  removeFromTalentList,
  renameTalentList,
  type TalentList,
} from "@/helpers/pipeline/talent-lists";

const uuid = z.string().uuid();
const name = z.string().max(200);
const inputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), name, candidateUserId: uuid.optional() }).strict(),
  z.object({ op: z.literal("rename"), listId: uuid, name }).strict(),
  z.object({ op: z.literal("delete"), listId: uuid }).strict(),
  z.object({ op: z.literal("add"), listId: uuid, candidateUserId: uuid }).strict(),
  z.object({ op: z.literal("remove"), listId: uuid, candidateUserId: uuid }).strict(),
]);

export type SaveTalentListResult = { ok: true; list?: TalentList } | { ok: false; error: string };

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

  let result: SaveTalentListResult;
  switch (change.op) {
    case "create": {
      const created = await createTalentList(auth, change.name);
      if (created.ok && change.candidateUserId) {
        const added = await addToTalentList(auth, created.list.id, change.candidateUserId);
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
      result = await addToTalentList(auth, change.listId, change.candidateUserId);
      break;
    case "remove":
      result = await removeFromTalentList(auth, change.listId, change.candidateUserId);
      break;
  }

  if (result.ok) revalidatePath("/company/profiles");
  return result;
}
