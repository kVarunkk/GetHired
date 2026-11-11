import { describe, expect, it } from "vitest";
import {
  filterPreviewRows,
  NO_PREVIEW_FILTERS,
  previewRows,
  rowsToConfirm,
  screeningWarning,
  type EmailMatches,
} from "./preview-rows";

const NONE: EmailMatches = { existing: [], known: [] };
const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const USER = "a0000000-0000-4000-8000-000000000001";

describe("previewRows (BI-REQ-013)", () => {
  it("gives each row its status, and counts them", () => {
    const preview = previewRows(
      [
        { full_name: "Asha", email: "asha@mail.test" },
        { full_name: "", email: "nobody@mail.test" },
        { full_name: "Asha again", email: "ASHA@mail.test" },
        { full_name: "Ben", email: "ben@mail.test" },
        { full_name: "Cid", email: "cid@mail.test" },
        { full_name: "Dev", email: "not-an-email" },
      ],
      {
        matches: {
          existing: [{ email: "ben@mail.test", id: CANDIDATE }],
          known: [{ email: "cid@mail.test", userId: USER, fullName: "Cid" }],
        },
        withJob: false,
      },
    );
    expect(preview.rows.map((r) => r.status)).toEqual([
      "ready",
      "error",
      "duplicate_in_file",
      "existing",
      "known",
      "error",
    ]);
    expect(preview.rows[1].errors).toEqual({ full_name: "Add a name." });
    expect(preview.rows[5].errors).toEqual({ email: "Enter a valid email address." });
    expect(preview.rows[3].existingId).toBe(CANDIDATE);
    expect(preview.rows[4].knownUserId).toBe(USER);
    expect(preview.counts).toEqual({ ready: 1, error: 2, duplicate_in_file: 1, existing: 1, known: 1 });
    expect(preview.job).toBeNull();
  });

  it("keeps the first occurrence in the file, unless that one has an error", () => {
    const preview = previewRows(
      [
        { full_name: "A".repeat(121), email: "asha@mail.test" },
        { full_name: "Asha", email: "asha@mail.test" },
        { full_name: "Asha 2", email: "asha@mail.test" },
      ],
      { matches: NONE, withJob: false },
    );
    expect(preview.rows.map((r) => r.status)).toEqual(["error", "ready", "duplicate_in_file"]);
  });

  it("re-validates a row after its cell is edited", () => {
    const rows = [{ full_name: "Asha", email: "asha@mail" }];
    expect(previewRows(rows, { matches: NONE, withJob: false }).rows[0].status).toBe("error");
    rows[0] = { ...rows[0], email: "asha@mail.test" };
    expect(previewRows(rows, { matches: NONE, withJob: false }).rows[0]).toMatchObject({
      status: "ready",
      data: { full_name: "Asha", email: "asha@mail.test" },
    });
  });

  it("only reads the stage column with a job destination", () => {
    const rows = [{ full_name: "Asha", stage: "Onsite" }];
    expect(previewRows(rows, { matches: NONE, withJob: false }).rows[0].data).toEqual({ full_name: "Asha" });
    expect(previewRows(rows, { matches: NONE, withJob: true }).rows[0].data).toEqual({ full_name: "Asha", stage: "Onsite" });
  });

  it("for a job, flags rows without an email and counts scored and unscored rows (BI-REQ-018)", () => {
    const preview = previewRows(
      [
        { full_name: "Detailed", email: "d@mail.test", current_title: "Engineer", skills: "Go, Rust" },
        { full_name: "Bare", email: "b@mail.test" },
        { full_name: "No email", current_title: "Engineer", current_company: "Acme" },
        { full_name: "Existing", email: "e@mail.test", experience_years: "0", current_company: "Acme" },
        { full_name: "Known", email: "k@mail.test" },
        { full_name: "", email: "x@mail.test" },
      ],
      {
        matches: {
          existing: [{ email: "e@mail.test", id: CANDIDATE }],
          known: [{ email: "k@mail.test", userId: USER, fullName: null }],
        },
        withJob: true,
      },
    );
    expect(preview.rows.map((r) => [r.scored, r.noEmailForJob])).toEqual([
      [true, false],
      [false, false],
      [false, true],
      [true, false],
      [false, false],
      [false, false],
    ]);
    expect(preview.job).toEqual({ scored: 2, unscored: 1, noEmail: 1, known: 1 });
  });
});

describe("screeningWarning", () => {
  it("warns only when the scored rows exceed what's left", () => {
    expect(screeningWarning(10, null)).toBeNull();
    expect(screeningWarning(10, 10)).toBeNull();
    expect(screeningWarning(1200, 40)).toBe(
      "You have 40 screenings left this period and this import needs 1,200. The rest won't be scored until you add more.",
    );
  });
});

describe("rowsToConfirm", () => {
  it("sends ready, existing and known rows, with per-row duplicate actions", () => {
    const preview = previewRows(
      [
        { full_name: "Asha", email: "asha@mail.test", phone: "" },
        { full_name: "", email: "x@mail.test" },
        { full_name: "Ben", email: "ben@mail.test" },
        { full_name: "Ben 2", email: "ben@mail.test" },
        { full_name: "Cid", email: "cid@mail.test" },
      ],
      {
        matches: {
          existing: [{ email: "ben@mail.test", id: CANDIDATE }],
          known: [{ email: "cid@mail.test", userId: USER, fullName: null }],
        },
        withJob: false,
      },
    );
    expect(rowsToConfirm(preview, { defaultAction: "skip", overrides: { 2: "overwrite" } })).toEqual([
      { full_name: "Asha", email: "asha@mail.test", phone: null },
      { full_name: "Ben", email: "ben@mail.test", duplicate_action: "overwrite" },
      { full_name: "Cid", email: "cid@mail.test" },
    ]);
    // An override equal to the import's action isn't repeated.
    expect(rowsToConfirm(preview, { defaultAction: "overwrite", overrides: { 2: "overwrite" } })[1]).toEqual({
      full_name: "Ben",
      email: "ben@mail.test",
    });
  });
});

describe("unticked rows", () => {
  const rows = [
    { full_name: "Asha", email: "asha@mail.test", current_title: "Engineer", skills: "Go" },
    { full_name: "Asha again", email: "asha@mail.test", current_title: "Designer" },
    { full_name: "", email: "x@mail.test" },
    { full_name: "Ben", email: "ben@mail.test" },
  ];

  it("selects every importable row by default", () => {
    const preview = previewRows(rows, { matches: NONE, withJob: false });
    expect(preview.rows.map((r) => r.selected)).toEqual([true, false, false, true]);
    expect(preview.selected).toBe(2);
  });

  it("leaves unticked rows out of the confirm, and lets a later repeat of their email in", () => {
    const preview = previewRows(rows, { matches: NONE, withJob: false, excluded: { 0: true } });
    expect(preview.rows.map((r) => [r.status, r.selected])).toEqual([
      ["ready", false],
      ["ready", true],
      ["error", false],
      ["ready", true],
    ]);
    expect(preview.selected).toBe(2);
    expect(rowsToConfirm(preview, { defaultAction: "skip" }).map((r) => r.full_name)).toEqual(["Asha again", "Ben"]);
  });

  it("counts only the selected rows for a job", () => {
    const preview = previewRows(rows, { matches: NONE, withJob: true, excluded: { 0: true, 1: true } });
    expect(preview.job).toEqual({ scored: 0, unscored: 1, noEmail: 0, known: 0 });
  });
});

describe("filterPreviewRows", () => {
  const rows = [
    { full_name: "Asha Rao", email: "asha@mail.test", location: "Bengaluru" },
    { full_name: "Ben", email: "ben@mail", location: "Pune" },
    { full_name: "Cid", email: "cid@mail.test", location: "bengaluru" },
  ];
  const fields = ["full_name", "email", "location"] as const;
  const preview = previewRows(rows, { matches: NONE, withJob: false, excluded: { 2: true } });
  const shown = (f: Partial<typeof NO_PREVIEW_FILTERS>) =>
    filterPreviewRows(preview.rows, rows, fields, { ...NO_PREVIEW_FILTERS, ...f }).map((r) => r.index);

  it("shows everything with no filters", () => {
    expect(shown({})).toEqual([0, 1, 2]);
  });

  it("searches every column, or one, ignoring case and outer spaces", () => {
    expect(shown({ query: " BENGALURU " })).toEqual([0, 2]);
    expect(shown({ query: "a", field: "full_name" })).toEqual([0]);
    expect(shown({ query: "ben", field: "email" })).toEqual([1]);
  });

  it("filters by status and by selection, together with the search", () => {
    expect(shown({ status: "error" })).toEqual([1]);
    expect(shown({ selection: "selected" })).toEqual([0]);
    expect(shown({ selection: "not_selected" })).toEqual([1, 2]);
    expect(shown({ selection: "not_selected", query: "bengaluru" })).toEqual([2]);
  });
});
