import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseMock,
  type RecordedCall,
  type SupabaseMock,
} from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import {
  addToTalentList,
  createTalentList,
  deleteTalentList,
  listTalentLists,
  findTalentListIdBySlug,
  PRIVATE_CANDIDATE_ERROR,
  removeFromTalentList,
  renameTalentList,
} from "./talent-lists";
import { OWNER_A } from "@/test/utils/team";

vi.mock("server-only", () => ({}));

const company = OWNER_A.myCompany;
const LIST_ID = "a1000000-0000-4000-8000-00000000000a";
const LIST = {
  id: LIST_ID,
  company_id: COMPANY_A.id,
  name: "Backend shortlist",
  slug: "backend-shortlist",
  created_at: "2026-10-15T00:00:00Z",
};

let db: SupabaseMock;
const ctx = () => ({ supabase: db.client, company });

const argsOf = (call: RecordedCall, method: string) =>
  call.chain.find((m) => m.method === method)?.args;

beforeEach(() => {
  db = createSupabaseMock();
});

describe("talent lists (PLT-090, PL-TASK-051)", () => {
  it("creates a list on the session company with a trimmed name and its slug", async () => {
    db.queue("talent_lists", { data: LIST, error: null });

    expect(await createTalentList(ctx(), "  Backend shortlist ")).toEqual({
      ok: true,
      list: LIST,
    });
    expect(argsOf(db.callsFor("talent_lists")[0], "insert")).toEqual([
      {
        company_id: COMPANY_A.id,
        name: "Backend shortlist",
        slug: "backend-shortlist",
      },
    ]);
  });

  it("refuses a name that's taken, ignoring case and punctuation", async () => {
    db.queue("talent_lists", {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });

    expect(await createTalentList(ctx(), "backend   SHORTLIST")).toEqual({
      ok: false,
      error:
        'You already have a list called "backend   SHORTLIST" (or one that differs only in punctuation or case).',
    });
  });

  it.each([
    ["All", '"All" is the name of a built-in tab. Pick another name.'],
    [" saved! ", '"saved!" is the name of a built-in tab. Pick another name.'],
    ["!!!", "List names need at least one letter or number."],
  ])("refuses %j without querying", async (name, error) => {
    expect(await createTalentList(ctx(), name)).toEqual({ ok: false, error });
    expect(await renameTalentList(ctx(), LIST_ID, name)).toEqual({
      ok: false,
      error,
    });
    expect(db.calls).toHaveLength(0);
  });

  it("finds a list's id by its slug, within the company", async () => {
    db.queue("talent_lists", { data: { id: LIST_ID }, error: null });
    db.queue("talent_lists", { data: null, error: null });

    expect(await findTalentListIdBySlug(ctx(), "backend-shortlist")).toBe(
      LIST_ID,
    );
    expect(await findTalentListIdBySlug(ctx(), "gone")).toBeNull();
    expect(db.callsFor("talent_lists")[0].chain).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["company_id", COMPANY_A.id] },
        { method: "eq", args: ["slug", "backend-shortlist"] },
      ]),
    );

    expect(await findTalentListIdBySlug(ctx(), "saved")).toBeNull();
    expect(db.callsFor("talent_lists")).toHaveLength(2);
  });

  it.each(["", "   ", "x".repeat(61)])("refuses the name %j", async (name) => {
    expect(await createTalentList(ctx(), name)).toEqual({
      ok: false,
      error: "List names are 1 to 60 characters.",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("renames and deletes only the company's lists", async () => {
    db.queue("talent_lists", { data: [{ id: LIST_ID }], error: null });
    db.queue("talent_lists", { data: [], error: null });

    expect(await renameTalentList(ctx(), LIST_ID, "Frontend")).toEqual({
      ok: true,
    });
    expect(await deleteTalentList(ctx(), LIST_ID)).toEqual({
      ok: false,
      error: "List not found.",
    });

    for (const call of db.callsFor("talent_lists")) {
      expect(call.chain).toContainEqual({
        method: "eq",
        args: ["company_id", COMPANY_A.id],
      });
      expect(call.chain).toContainEqual({
        method: "eq",
        args: ["id", LIST_ID],
      });
    }
    expect(argsOf(db.callsFor("talent_lists")[0], "update")).toEqual([
      { name: "Frontend", slug: "frontend" },
    ]);
  });

  it("adds a public candidate, ignoring duplicates", async () => {
    db.queue("talent_lists", { data: { id: LIST_ID }, error: null });
    db.queue("candidate_directory", { data: { filled: true }, error: null });
    db.queue("talent_list_members", { data: null, error: null });

    expect(await addToTalentList(ctx(), LIST_ID, PUBLIC_APPLICANT.id)).toEqual({
      ok: true,
    });

    const [insert] = db.callsFor("talent_list_members");
    expect(argsOf(insert, "upsert")).toEqual([
      { list_id: LIST_ID, candidate_user_id: PUBLIC_APPLICANT.id },
      { onConflict: "list_id,candidate_user_id", ignoreDuplicates: true },
    ]);
    expect(db.callsFor("candidate_directory")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", PUBLIC_APPLICANT.id],
    });
    // A talent-pool candidate's user_info row is never read (OR-SEC-001).
    expect(db.callsFor("user_info")).toHaveLength(0);
  });

  it("refuses a candidate the company can't view (not in the directory, RLS hides the row)", async () => {
    db.queue("talent_lists", { data: { id: LIST_ID }, error: null });
    db.queue("candidate_directory", { data: null, error: null });
    db.queue("user_info", { data: null, error: null });

    expect(await addToTalentList(ctx(), LIST_ID, PUBLIC_APPLICANT.id)).toEqual({
      ok: false,
      error: "Candidate not found.",
    });
    expect(db.callsFor("talent_list_members")).toHaveLength(0);
  });

  it.each([
    ["private", null, { user_id: PUBLIC_APPLICANT.id }],
    ["unfinished", { filled: false }, null],
  ])(
    "refuses a %s profile, such as an applicant's: lists hold the talent pool",
    async (_, listed, applicant) => {
      db.queue("talent_lists", { data: { id: LIST_ID }, error: null });
      db.queue("candidate_directory", { data: listed, error: null });
      db.queue("user_info", { data: applicant, error: null });

      expect(
        await addToTalentList(ctx(), LIST_ID, PUBLIC_APPLICANT.id),
      ).toEqual({
        ok: false,
        error: PRIVATE_CANDIDATE_ERROR,
      });
      expect(db.callsFor("talent_list_members")).toHaveLength(0);
    },
  );

  it("refuses another company's list", async () => {
    db.queue("talent_lists", { data: null, error: null });

    expect(await addToTalentList(ctx(), LIST_ID, PUBLIC_APPLICANT.id)).toEqual({
      ok: false,
      error: "List not found.",
    });
    expect(db.callsFor("talent_lists")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    expect(db.callsFor("candidate_directory")).toHaveLength(0);
  });

  it("rejects malformed ids without querying", async () => {
    expect(
      await addToTalentList(ctx(), "x", PUBLIC_APPLICANT.id),
    ).toMatchObject({ ok: false });
    expect(await addToTalentList(ctx(), LIST_ID, "x")).toMatchObject({
      ok: false,
    });
    expect(
      await removeFromTalentList(ctx(), "x", PUBLIC_APPLICANT.id),
    ).toMatchObject({ ok: false });
    expect(db.calls).toHaveLength(0);
  });

  it("removes a member from one of the company's lists", async () => {
    db.queue("talent_lists", { data: { id: LIST_ID }, error: null });
    db.queue("talent_list_members", { data: null, error: null });

    expect(
      await removeFromTalentList(ctx(), LIST_ID, PUBLIC_APPLICANT.id),
    ).toEqual({ ok: true });
    const [del] = db.callsFor("talent_list_members");
    expect(del.chain).toContainEqual({
      method: "eq",
      args: ["list_id", LIST_ID],
    });
    expect(del.chain).toContainEqual({
      method: "eq",
      args: ["candidate_user_id", PUBLIC_APPLICANT.id],
    });
  });

  it("lists the company's lists with member counts and whether a candidate is in each", async () => {
    db.queue("talent_lists", {
      data: [
        {
          ...LIST,
          talent_list_members: [
            { candidate_user_id: PUBLIC_APPLICANT.id },
            { candidate_user_id: "other" },
            // Went private (or blocked the company) after being added: still a
            // member, but the directory and the tab don't show them.
            { candidate_user_id: "gone-private" },
          ],
        },
        {
          ...LIST,
          id: "a1000000-0000-4000-8000-00000000000c",
          name: "Design",
          slug: "design",
          talent_list_members: [],
        },
      ],
      error: null,
    });
    db.queue("candidate_directory", {
      data: [{ user_id: PUBLIC_APPLICANT.id }, { user_id: "other" }],
      error: null,
    });

    expect(
      await listTalentLists(ctx(), { candidateUserId: PUBLIC_APPLICANT.id }),
    ).toEqual([
      {
        id: LIST_ID,
        name: "Backend shortlist",
        slug: "backend-shortlist",
        memberCount: 2,
        hasCandidate: true,
      },
      {
        id: "a1000000-0000-4000-8000-00000000000c",
        name: "Design",
        slug: "design",
        memberCount: 0,
        hasCandidate: false,
      },
    ]);
    expect(db.callsFor("talent_lists")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
  });
});
