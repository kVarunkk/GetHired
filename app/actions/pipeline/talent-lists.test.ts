import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCompanyCandidateToTalentList,
  addToTalentList,
  createTalentList,
  deleteTalentList,
  listTalentLists,
  removeCompanyCandidateFromTalentList,
  removeFromTalentList,
  renameTalentList,
} from "@/helpers/pipeline/talent-lists";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
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
  addCompanyCandidateToTalentList: vi.fn(),
  removeCompanyCandidateFromTalentList: vi.fn(),
  listTalentLists: vi.fn(),
}));

const COMPANY_CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const LIST = { id: "a1000000-0000-4000-8000-00000000000a", company_id: COMPANY_A.id, name: "Backend", slug: "backend", created_at: "" };

async function signIn(user = COMPANY_A.user, times = 1) {
  const supabase = createSupabaseMock({ user });
  for (let i = 0; i < times; i++) supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
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
  vi.mocked(addCompanyCandidateToTalentList).mockResolvedValue({ ok: true });
  vi.mocked(removeCompanyCandidateFromTalentList).mockResolvedValue({ ok: true });
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

  it("adds and removes the company's own candidates (BI-REQ-006)", async () => {
    await signIn(COMPANY_A.user, 3);

    await saveTalentListAction({ op: "add", listId: LIST.id, companyCandidateId: COMPANY_CANDIDATE });
    await saveTalentListAction({ op: "remove", listId: LIST.id, companyCandidateId: COMPANY_CANDIDATE });
    await saveTalentListAction({ op: "create", name: "Bench", companyCandidateId: COMPANY_CANDIDATE });

    expect(vi.mocked(addCompanyCandidateToTalentList).mock.calls.map((c) => c.slice(1))).toEqual([
      [LIST.id, COMPANY_CANDIDATE],
      [LIST.id, COMPANY_CANDIDATE],
    ]);
    expect(vi.mocked(removeCompanyCandidateFromTalentList).mock.calls[0].slice(1)).toEqual([LIST.id, COMPANY_CANDIDATE]);
    expect(addToTalentList).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/company/candidates/${COMPANY_CANDIDATE}`);
  });

  it.each([
    ["an unknown op", { op: "share", listId: LIST.id }],
    ["both kinds of candidate", { op: "add", listId: LIST.id, candidateUserId: PUBLIC_APPLICANT.id, companyCandidateId: COMPANY_CANDIDATE }],
    ["no candidate", { op: "add", listId: LIST.id }],
    ["a company id", { op: "delete", listId: LIST.id, companyId: COMPANY_A.id }],
    ["a malformed candidate", { op: "add", listId: LIST.id, candidateUserId: "x" }],
  ])("rejects %s", async (_, input) => {
    expect(await saveTalentListAction(input as never)).toMatchObject({ ok: false });
    expect(addToTalentList).not.toHaveBeenCalled();
    expect(addCompanyCandidateToTalentList).not.toHaveBeenCalled();
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

  it("lists them for a company candidate (BI-REQ-006)", async () => {
    await listTalentListsAction({ companyCandidateId: COMPANY_CANDIDATE });
    expect(vi.mocked(listTalentLists).mock.calls[0][1]).toEqual({ companyCandidateId: COMPANY_CANDIDATE });
  });
});
