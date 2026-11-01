import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { checkImportEmailsAction } from "@/app/actions/candidates/check-import-emails";
import { confirmSpreadsheetImportAction } from "@/app/actions/candidates/confirm-spreadsheet-import";
import { getImportMappingAction } from "@/app/actions/candidates/import-mapping";
import { startImportAction } from "@/app/actions/candidates/start-import";
import { parseSheet, SheetError } from "@/helpers/candidates/parse-sheet";
import type { ImportPage } from "@/helpers/candidates/import-page";
import SpreadsheetImport from "./SpreadsheetImport";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/check-import-emails", () => ({ checkImportEmailsAction: vi.fn() }));
vi.mock("@/app/actions/candidates/confirm-spreadsheet-import", () => ({ confirmSpreadsheetImportAction: vi.fn() }));
vi.mock("@/app/actions/candidates/import-mapping", () => ({ getImportMappingAction: vi.fn() }));
vi.mock("@/app/actions/candidates/start-import", () => ({ startImportAction: vi.fn() }));
// parse-sheet.test.ts reads real files; here the parsed sheet is the fixture.
vi.mock("@/helpers/candidates/parse-sheet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/candidates/parse-sheet")>()),
  parseSheet: vi.fn(),
}));
vi.mock("@/helpers/candidates/map-columns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/candidates/map-columns")>()),
  headerHash: vi.fn(async () => "a".repeat(64)),
}));
// Radix's checkbox and switch measure themselves; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const JOB_WITH_INTERVIEW = "b0000000-0000-4000-8000-0000000000a1";
const JOB_MANUAL = "b0000000-0000-4000-8000-0000000000a2";
const APPLIED = "50000000-0000-4000-8000-000000000001";
const ONSITE = "50000000-0000-4000-8000-000000000002";
const BATCH = "cb000000-0000-4000-8000-000000000001";
const CANDIDATE = "cc000000-0000-4000-8000-000000000001";

const PAGE: ImportPage = {
  jobs: [
    { id: JOB_WITH_INTERVIEW, title: "Backend Engineer", interview: { fitThreshold: 70, durationMinutes: 15 } },
    { id: JOB_MANUAL, title: "Designer", interview: null },
  ],
  stages: [
    { id: APPLIED, name: "Applied" },
    { id: ONSITE, name: "Onsite" },
  ],
  lists: [{ id: "71000000-0000-4000-8000-000000000001", name: "Old ATS", slug: "old-ats" }],
  allowNoJob: true,
  screeningsRemaining: 1,
  fixedJob: null,
  notFound: false,
};

const SHEET = {
  headers: ["Name", "Email", "Title", "Skills", "Stage", "Gender"],
  rows: [
    ["Asha Rao", "asha@mail.test", "Engineer", "Go", "Onsite", "F"],
    ["Ben", "ben@mail", "Designer", "Figma", "Phone screen", "M"],
    ["Cid", "cid@mail.test", "", "", "onsite", ""],
  ],
};

const file = () => new File(["x"], "people.csv", { type: "text/csv" });
const choose = (label: string, option: string) =>
  fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value: option } });

async function upload() {
  fireEvent.change(screen.getByLabelText("Choose a .csv or .xlsx file"), { target: { files: [file()] } });
  await screen.findByRole("heading", { name: "Match the columns" });
}
async function toReview() {
  await upload();
  fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
  await screen.findByRole("heading", { name: "Check the rows" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseSheet).mockResolvedValue(SHEET);
  vi.mocked(getImportMappingAction).mockResolvedValue({ ok: true, mapping: null });
  vi.mocked(checkImportEmailsAction).mockResolvedValue({
    ok: true,
    existing: [{ email: "cid@mail.test", id: CANDIDATE }],
    known: [],
  });
  vi.mocked(startImportAction).mockResolvedValue({ ok: true, batchId: BATCH });
  vi.mocked(confirmSpreadsheetImportAction).mockResolvedValue({
    ok: true,
    batchId: BATCH,
    counts: {
      created: 2,
      updated: 0,
      skipped: 1,
      known: 0,
      added_to_job: 3,
      already_in_job: 0,
      needs_outreach: 0,
      no_email: 0,
      added_to_list: 0,
      not_found: 0,
    },
    newList: null,
  });
});

describe("SpreadsheetImport: upload (BI-REQ-010)", () => {
  it("shows why a file can't be read", async () => {
    vi.mocked(parseSheet).mockRejectedValue(new SheetError("Upload a .csv or .xlsx file."));
    render(<SpreadsheetImport page={PAGE} />);
    fireEvent.change(screen.getByLabelText("Choose a .csv or .xlsx file"), { target: { files: [file()] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload a .csv or .xlsx file.");
    expect(screen.getByRole("button", { name: "Download the template" })).toBeInTheDocument();
  });

  it("offers a sheet picker for a workbook with several sheets", async () => {
    vi.mocked(parseSheet).mockResolvedValue({ ...SHEET, sheets: ["Notes", "People"], sheet: "Notes" });
    render(<SpreadsheetImport page={PAGE} />);
    await upload();
    choose("Sheet", "People");
    await waitFor(() => expect(parseSheet).toHaveBeenLastCalledWith(expect.any(File), { sheet: "People" }));
  });
});

describe("SpreadsheetImport: columns (BI-REQ-011, BI-SEC-005)", () => {
  it("guesses the columns and keeps a protected header ignored, with the reason", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await upload();
    expect(screen.getByRole("combobox", { name: "Map “Name” to" })).toHaveValue("full_name");
    expect(screen.getByRole("combobox", { name: "Map “Stage” to" })).toHaveValue("stage");
    expect(screen.getByRole("combobox", { name: "Map “Gender” to" })).toHaveValue("ignore");
    expect(screen.getByRole("combobox", { name: "Map “Gender” to" })).toBeDisabled();
    expect(screen.getByText(/Looks like gender/)).toBeInTheDocument();
  });

  it("uses the saved mapping for these headers", async () => {
    vi.mocked(getImportMappingAction).mockResolvedValue({
      ok: true,
      mapping: { columns: ["full_name", "email", "tag", "skills", "stage", "tag"] },
    });
    render(<SpreadsheetImport page={PAGE} />);
    await upload();
    expect(getImportMappingAction).toHaveBeenCalledWith({ headerHash: "a".repeat(64) });
    expect(screen.getByRole("combobox", { name: "Map “Title” to" })).toHaveValue("tag");
    // Never a protected header, whatever was saved.
    expect(screen.getByRole("combobox", { name: "Map “Gender” to" })).toHaveValue("ignore");
  });

  it("needs a name column before the preview", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await upload();
    choose("Map “Name” to", "ignore");
    expect(screen.getByText("Choose the column with each person's name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview rows" })).toBeDisabled();
  });
});

describe("SpreadsheetImport: preview and destination (BI-REQ-013–018)", () => {
  it("checks the emails and shows each row's status", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    expect(checkImportEmailsAction).toHaveBeenCalledWith({ emails: ["asha@mail.test", "ben@mail", "cid@mail.test"] });
    const counts = screen.getByRole("list", { name: "Rows by status" });
    expect(within(counts).getByText("Ready: 1")).toBeInTheDocument();
    expect(within(counts).getByText("Needs a fix: 1")).toBeInTheDocument();
    expect(within(counts).getByText("Already a candidate: 1")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("makes an error row ready once its cell is fixed", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    const email = screen.getByRole("textbox", { name: "Email, row 2" });
    fireEvent.change(email, { target: { value: "ben@mail.test" } });
    fireEvent.blur(email);
    const counts = screen.getByRole("list", { name: "Rows by status" });
    expect(within(counts).getByText("Ready: 2")).toBeInTheDocument();
    expect(within(counts).getByText("Needs a fix: 0")).toBeInTheDocument();
    // The new email is checked too.
    expect(checkImportEmailsAction).toHaveBeenLastCalledWith({ emails: ["ben@mail.test"] });
  });

  it("preselects stage values by name and leaves the rest to the import's stage", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    expect(screen.queryByText("Stages from your file")).not.toBeInTheDocument();
    choose("Add them to", "job");
    choose("Job", JOB_WITH_INTERVIEW);
    expect(screen.getByRole("combobox", { name: "Stage for “Onsite”" })).toHaveValue(ONSITE);
    expect(screen.getByRole("combobox", { name: "Stage for “Phone screen”" })).toHaveValue("destination");
  });

  it("shows the auto-invite switch, off, only for a job that invites by fit score", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    choose("Add them to", "job");
    choose("Job", JOB_WITH_INTERVIEW);
    expect(screen.getByRole("switch", { name: "Auto-invite to AI interview" })).not.toBeChecked();
    expect(screen.getByText(/score 70 or more; each invite holds 15 interview minutes/)).toBeInTheDocument();
    choose("Job", JOB_MANUAL);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("counts the screenings a job import uses, with a warning past the allowance", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    choose("Add them to", "job");
    choose("Job", JOB_MANUAL);
    // Asha (title + skills) can be scored; Cid has no detail; Ben has an error.
    expect(screen.getByText(/1 person has enough detail to be scored, using 1 screening/)).toBeInTheDocument();
    expect(screen.getByText(/1 of these has no resume/)).toBeInTheDocument();
    expect(screen.queryByText(/screenings? left this period/)).not.toBeInTheDocument();
    const email = screen.getByRole("textbox", { name: "Email, row 2" });
    fireEvent.change(email, { target: { value: "ben@mail.test" } });
    fireEvent.blur(email);
    expect(screen.getByText(/You have 1 screening left this period and this import needs 2/)).toBeInTheDocument();
    expect(screen.getByText("No one will be emailed by this import.")).toBeInTheDocument();
  });
});

describe("SpreadsheetImport on a job page (CPT-016, CP-REQ-010/023)", () => {
  const FIXED = { ...PAGE, fixedJob: PAGE.jobs[0] };

  it("hides the destination and job pickers and shows the stage map", async () => {
    render(<SpreadsheetImport page={FIXED} />);
    await toReview();
    expect(screen.getByText("Importing into")).toHaveTextContent("Backend Engineer");
    expect(screen.queryByRole("combobox", { name: "Add them to" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Job" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Stage for “Onsite”" })).toHaveValue(ONSITE);
  });

  it("imports into the job, and offers to import more", async () => {
    render(<SpreadsheetImport page={FIXED} />);
    await toReview();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 people" }));
    expect(await screen.findByRole("heading", { name: "Import finished" })).toBeInTheDocument();
    expect(confirmSpreadsheetImportAction).toHaveBeenCalledWith(
      expect.objectContaining({ jobPostId: JOB_WITH_INTERVIEW, autoInvite: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import more" }));
    expect(screen.getByLabelText("Choose a .csv or .xlsx file")).toBeInTheDocument();
  });
});

describe("SpreadsheetImport: confirm (BI-REQ-016/017)", () => {
  it("can't be confirmed until the lawful basis is ticked", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    const confirm = screen.getByRole("button", { name: "Import 2 people" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
  });

  it("starts the batch, confirms the rows into the job, and shows the counts", async () => {
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    choose("Add them to", "job");
    choose("Job", JOB_WITH_INTERVIEW);
    choose("Stage for “Phone screen”", APPLIED);
    fireEvent.click(screen.getByRole("switch", { name: "Auto-invite to AI interview" }));
    choose("Duplicate action, row 3", "fill");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Basis (optional)"), { target: { value: "consented in our old ATS" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 people" }));

    expect(await screen.findByRole("heading", { name: "Import finished" })).toBeInTheDocument();
    expect(startImportAction).toHaveBeenCalledWith({ fileName: "people.csv" });
    expect(confirmSpreadsheetImportAction).toHaveBeenCalledWith({
      batchId: BATCH,
      rows: [
        { full_name: "Asha Rao", email: "asha@mail.test", current_title: "Engineer", skills: ["Go"], stage: "Onsite" },
        { full_name: "Cid", email: "cid@mail.test", current_title: null, skills: [], stage: "onsite", duplicate_action: "fill" },
      ],
      duplicateAction: "skip",
      jobPostId: JOB_WITH_INTERVIEW,
      stageMap: { Onsite: ONSITE, "Phone screen": APPLIED },
      autoInvite: true,
      attested: true,
      lawfulBasisNote: "consented in our old ATS",
      mapping: { headerHash: "a".repeat(64), columns: ["full_name", "email", "current_title", "skills", "stage", "ignore"] },
    });
    expect(screen.getByText("2 candidates created")).toBeInTheDocument();
    expect(screen.getByText("1 existing candidate left as they were")).toBeInTheDocument();
    expect(screen.getByText("3 added to the job")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job's applications" })).toHaveAttribute(
      "href",
      `/company/job-posts/${JOB_WITH_INTERVIEW}/applications`,
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("sends a new list's name, and keeps the batch when the confirm is refused", async () => {
    vi.mocked(confirmSpreadsheetImportAction).mockResolvedValueOnce({ ok: false, error: "Nope." });
    render(<SpreadsheetImport page={PAGE} />);
    await toReview();
    choose("Add them to", "list");
    choose("Talent list", "new");
    fireEvent.click(screen.getByRole("checkbox"));
    const confirm = screen.getByRole("button", { name: "Import 2 people" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "New list name" }), { target: { value: "Old ATS 2" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope."));
    expect(confirmSpreadsheetImportAction).toHaveBeenCalledWith(expect.objectContaining({ newListName: "Old ATS 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 people" }));
    expect(await screen.findByRole("heading", { name: "Import finished" })).toBeInTheDocument();
    expect(startImportAction).toHaveBeenCalledTimes(1);
  });
});
