import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToTalentList,
  createTalentList,
  deleteTalentList,
  listTalentLists,
  removeFromTalentList,
  renameTalentList,
} from "@/helpers/pipeline/talent-lists";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { saveTalentListAction } from "./save-talent-list";
import { listTalentListsAction } from "./list-talent-lists";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/talent-lists", () => ({
  createTalentList: vi.fn(),
  renameTalentList: vi.fn(),
  deleteTalentList: vi.fn(),
  addToTalentList: vi.fn(),
  removeFromTalentList: vi.fn(),
  listTalentLists: vi.fn(),
}));

const LIST = { id: "a1000000-0000-4000-8000-00000000000a", company_id: COMPANY_A.id, name: "Backend", slug: "backend", created_at: "" };

async function signIn(user = COMPANY_A.user, times = 1) {
  const supabase = createSupabaseMock({ user });
  for (let i = 0; i < times; i++) supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  await setRequestUser(user, supabase.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
  vi.mocked(createTalentList).mockResolvedValue({ ok: true, list: LIST });
  vi.mocked(addToTalentList).mockResolvedValue({ ok: true });
  vi.mocked(renameTalentList).mockResolvedValue({ ok: true });
  vi.mocked(deleteTalentList).mockResolvedValue({ ok: true });
  vi.mocked(removeFromTalentList).mockResolvedValue({ ok: true });
  vi.mocked(listTalentLists).mockResolvedValue([]);
});

describe("saveTalentListAction (PLT-090)", () => {
  it("creates a list and adds the candidate to it", async () => {
    expect(
      await saveTalentListAction({ op: "create", name: "Backend", candidateUserId: PUBLIC_APPLICANT.id }),
    ).toEqual({ ok: true, list: LIST });

    expect(vi.mocked(createTalentList).mock.calls[0][0].company.id).toBe(COMPANY_A.id);
    expect(vi.mocked(addToTalentList).mock.calls[0].slice(1)).toEqual([LIST.id, PUBLIC_APPLICANT.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/company/profiles");
  });

  it("routes add, remove, rename and delete to their helpers", async () => {
    await signIn(COMPANY_A.user, 4);

    await saveTalentListAction({ op: "add", listId: LIST.id, candidateUserId: PUBLIC_APPLICANT.id });
    await saveTalentListAction({ op: "remove", listId: LIST.id, candidateUserId: PUBLIC_APPLICANT.id });
    await saveTalentListAction({ op: "rename", listId: LIST.id, name: "Frontend" });
    await saveTalentListAction({ op: "delete", listId: LIST.id });

    expect(vi.mocked(addToTalentList).mock.calls[0].slice(1)).toEqual([LIST.id, PUBLIC_APPLICANT.id]);
    expect(vi.mocked(removeFromTalentList).mock.calls[0].slice(1)).toEqual([LIST.id, PUBLIC_APPLICANT.id]);
    expect(vi.mocked(renameTalentList).mock.calls[0].slice(1)).toEqual([LIST.id, "Frontend"]);
    expect(vi.mocked(deleteTalentList).mock.calls[0].slice(1)).toEqual([LIST.id]);
  });

  it.each([
    ["an unknown op", { op: "share", listId: LIST.id }],
    ["a company id", { op: "delete", listId: LIST.id, companyId: COMPANY_A.id }],
    ["a malformed candidate", { op: "add", listId: LIST.id, candidateUserId: "x" }],
  ])("rejects %s", async (_, input) => {
    expect(await saveTalentListAction(input as never)).toMatchObject({ ok: false });
    expect(addToTalentList).not.toHaveBeenCalled();
    expect(deleteTalentList).not.toHaveBeenCalled();
  });

  it("refuses a caller who isn't a company", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await saveTalentListAction({ op: "delete", listId: LIST.id })).toMatchObject({ ok: false });
    expect(deleteTalentList).not.toHaveBeenCalled();
  });
});

describe("listTalentListsAction (PLT-090)", () => {
  it("lists the session company's lists for a candidate", async () => {
    vi.mocked(listTalentLists).mockResolvedValue([{ id: LIST.id, name: "Backend", slug: "backend", memberCount: 1, hasCandidate: true }]);

    expect(await listTalentListsAction({ candidateUserId: PUBLIC_APPLICANT.id })).toEqual({
      ok: true,
      lists: [{ id: LIST.id, name: "Backend", slug: "backend", memberCount: 1, hasCandidate: true }],
    });
    expect(vi.mocked(listTalentLists).mock.calls[0][1]).toEqual({ candidateUserId: PUBLIC_APPLICANT.id });
  });
});
