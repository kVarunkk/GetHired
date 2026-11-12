import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { checkImportEmailsAction } from "@/app/actions/candidates/check-import-emails";
import { confirmResumeImportAction } from "@/app/actions/candidates/confirm-resume-import";
import { discardResumeImportAction } from "@/app/actions/candidates/discard-resume-import";
import { createResumeUploadUrlsAction } from "@/app/actions/candidates/create-resume-upload-urls";
import { importRowFileUrlAction } from "@/app/actions/candidates/import-row-file-url";
import { importStatusAction } from "@/app/actions/candidates/import-status";
import { removeImportRowAction } from "@/app/actions/candidates/remove-import-row";
import { retryImportRowAction } from "@/app/actions/candidates/retry-import-row";
import { submitResumeBatchAction } from "@/app/actions/candidates/submit-resume-batch";
import { updateImportRowAction } from "@/app/actions/candidates/update-import-row";
import { IMPORT_LAWFUL_BASIS_TEXT } from "./LawfulBasisCheck";
import type { ImportBatchView, ImportRowView } from "@/helpers/candidates/import-rows";
import type { DestinationPage } from "./ImportDestination";
import type { ImportJob } from "@/helpers/candidates/import-page";
import ResumeImport from "./ResumeImport";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/check-import-emails", () => ({ checkImportEmailsAction: vi.fn() }));
vi.mock("@/app/actions/candidates/confirm-resume-import", () => ({ confirmResumeImportAction: vi.fn() }));
vi.mock("@/app/actions/candidates/discard-resume-import", () => ({ discardResumeImportAction: vi.fn() }));
vi.mock("@/app/actions/candidates/create-resume-upload-urls", () => ({ createResumeUploadUrlsAction: vi.fn() }));
vi.mock("@/app/actions/candidates/import-status", () => ({ importStatusAction: vi.fn() }));
vi.mock("@/app/actions/candidates/import-row-file-url", () => ({ importRowFileUrlAction: vi.fn() }));
// The PDF viewer needs a canvas; the dialog is checked by what it was given.
vi.mock("@/components/ResumePreviewDialog", () => ({
  default: (props: { displayUrl: string; triggerLabel?: string; onOpenChange?: (open: boolean) => void }) => (
    <button type="button" aria-label={props.triggerLabel} data-url={props.displayUrl} onClick={() => props.onOpenChange?.(true)}>
      View
    </button>
  ),
}));
vi.mock("@/app/actions/candidates/remove-import-row", () => ({ removeImportRowAction: vi.fn() }));
vi.mock("@/app/actions/candidates/retry-import-row", () => ({ retryImportRowAction: vi.fn() }));
vi.mock("@/app/actions/candidates/submit-resume-batch", () => ({ submitResumeBatchAction: vi.fn() }));
vi.mock("@/app/actions/candidates/update-import-row", () => ({ updateImportRowAction: vi.fn() }));
const uploadToSignedUrl = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
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

const JOB_ID = "b0000000-0000-4000-8000-0000000000a1";
const BATCH = "cb000000-0000-4000-8000-000000000001";
const APPLIED = "50000000-0000-4000-8000-000000000001";
const ONSITE = "50000000-0000-4000-8000-000000000002";
const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const ROW = (n: number) => `f1000000-0000-4000-8000-00000000000${n}`;

const JOB: ImportJob = { id: JOB_ID, title: "Backend Engineer", interview: { fitThreshold: 70, durationMinutes: 15 } };
const STAGES = [
  { id: APPLIED, name: "Applied" },
  { id: ONSITE, name: "Onsite" },
];
/** A job page's import (CP-REQ-010). */
const jobPage = (job: ImportJob = JOB): DestinationPage => ({
  jobs: [],
  stages: STAGES,
  lists: null,
  allowNoJob: true,
  screeningsRemaining: null,
  fixedJob: job,
});
const BATCH_VIEW: ImportBatchView = {
  id: BATCH,
  status: "ready",
  jobPostId: JOB_ID,
  talentListId: null,
  stageId: null,
  autoInvite: false,
  expiresAt: "2026-11-01T00:00:00Z",
};

const row = (n: number, over: Partial<ImportRowView> = {}): ImportRowView => ({
  id: ROW(n),
  fileName: `cv-${n}.pdf`,
  status: "parsed",
  errorCode: null,
  fields: { full_name: `Person ${n}`, email: `p${n}@mail.test` },
  edited: {},
  warnings: [],
  duplicateOf: null,
  duplicateAction: null,
  ...over,
});

const pdf = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
const COUNTS = {
  created: 2,
  updated: 0,
  skipped: 0,
  known: 0,
  added_to_job: 2,
  already_in_job: 0,
  needs_outreach: 0,
  no_email: 0,
  added_to_list: 0,
  not_found: 0,
};

const attest = () => fireEvent.click(screen.getByRole("checkbox", { name: IMPORT_LAWFUL_BASIS_TEXT }));
const confirmButton = () => screen.getByRole("button", { name: /^Import \d+ (person|people)$/ });

beforeEach(() => {
  vi.clearAllMocks();
  uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
  vi.mocked(checkImportEmailsAction).mockResolvedValue({ ok: true, existing: [], known: [] });
  vi.mocked(updateImportRowAction).mockResolvedValue({ ok: true });
  vi.mocked(removeImportRowAction).mockResolvedValue({ ok: true });
  vi.mocked(retryImportRowAction).mockResolvedValue({ ok: true });
  vi.mocked(confirmResumeImportAction).mockResolvedValue({ ok: true, counts: COUNTS, jobPostId: JOB_ID, list: null });
  vi.mocked(importStatusAction).mockResolvedValue({ ok: true, batch: BATCH_VIEW, rows: [] });
});

describe("ResumeImport: upload (BI-REQ-020/021)", () => {
  it("lists files it won't upload, with the reason", () => {
    render(<ResumeImport page={jobPage()} />);
    fireEvent.change(screen.getByLabelText("Choose resumes"), {
      target: { files: [pdf("a.pdf"), new File(["x"], "b.doc"), pdf("c.pdf", 11 * 1024 * 1024)] },
    });
    expect(screen.getByText("Use a PDF or Word (.docx) file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload and read 1 resume" })).toBeEnabled();
  });

  it("views a chosen PDF before it's uploaded, from a local link", () => {
    const createObjectURL = vi.fn(() => "blob:local-a");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    render(<ResumeImport page={jobPage()} />);
    const a = pdf("a.pdf");
    const docx = new File(["x"], "b.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByLabelText("Choose resumes"), { target: { files: [a, docx] } });
    // A browser can't show a Word file.
    expect(screen.queryByRole("button", { name: "View b.docx" })).not.toBeInTheDocument();
    const view = screen.getByRole("button", { name: "View a.pdf" });
    fireEvent.click(view);
    expect(createObjectURL).toHaveBeenCalledWith(a);
    expect(view).toHaveAttribute("data-url", "blob:local-a");
    expect(createResumeUploadUrlsAction).not.toHaveBeenCalled();
  });

  it("uploads to the signed URLs, submits the batch and shows the rows as they're read", async () => {
    vi.mocked(createResumeUploadUrlsAction).mockResolvedValue({
      ok: true,
      batchId: BATCH,
      uploads: [
        { rowId: ROW(1), fileName: "a.pdf", path: `c/${BATCH}/${ROW(1)}.pdf`, token: "t1" },
        { rowId: ROW(2), fileName: "b.pdf", path: `c/${BATCH}/${ROW(2)}.pdf`, token: "t2" },
      ],
    });
    vi.mocked(submitResumeBatchAction).mockResolvedValue({ ok: true, queued: 2 });
    vi.mocked(importStatusAction).mockResolvedValue({
      ok: true,
      batch: { ...BATCH_VIEW, status: "parsing" },
      rows: [row(1), row(2, { status: "parsing", fields: {} })],
    });

    render(<ResumeImport page={jobPage()} />);
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    fireEvent.change(screen.getByLabelText("Choose resumes"), { target: { files: [a, b] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and read 2 resumes" }));

    expect(await screen.findByRole("heading", { name: "Check what was read" })).toBeInTheDocument();
    expect(createResumeUploadUrlsAction).toHaveBeenCalledWith({
      jobPostId: JOB_ID,
      files: [
        { name: "a.pdf", size: 1000, type: "application/pdf" },
        { name: "b.pdf", size: 1000, type: "application/pdf" },
      ],
    });
    expect(uploadToSignedUrl).toHaveBeenCalledWith(`c/${BATCH}/${ROW(1)}.pdf`, "t1", a);
    expect(uploadToSignedUrl).toHaveBeenCalledWith(`c/${BATCH}/${ROW(2)}.pdf`, "t2", b);
    expect(submitResumeBatchAction).toHaveBeenCalledWith({ batchId: BATCH });
    expect(screen.getByText("Reading 1 resume. You can fix the ones that are done.")).toBeInTheDocument();
    // Confirm waits until every file is read.
    attest();
    expect(confirmButton()).toBeDisabled();
  });

  it("shows how many fit when the plan can't cover them", async () => {
    vi.mocked(createResumeUploadUrlsAction).mockResolvedValue({
      ok: true,
      batchId: BATCH,
      uploads: [{ rowId: ROW(1), fileName: "a.pdf", path: "p", token: "t" }],
    });
    vi.mocked(submitResumeBatchAction).mockResolvedValue({
      ok: false,
      fit: 0,
      total: 1,
      error: "Your plan has no resume imports left. Buy more or wait for next month's.",
    });
    render(<ResumeImport page={jobPage()} />);
    fireEvent.change(screen.getByLabelText("Choose resumes"), { target: { files: [pdf("a.pdf")] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and read 1 resume" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your plan has no resume imports left.");
    expect(screen.queryByRole("heading", { name: "Check what was read" })).not.toBeInTheDocument();
  });
});

describe("ResumeImport: review (BI-REQ-023/024)", () => {
  it("polls while files are being read", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(importStatusAction).mockResolvedValue({ ok: true, batch: BATCH_VIEW, rows: [row(1), row(2)] });
      render(
        <ResumeImport
          page={jobPage()}
          initial={{ batch: { ...BATCH_VIEW, status: "parsing" }, rows: [row(1), row(2, { status: "queued", fields: {} })] }}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(importStatusAction).toHaveBeenCalledWith({ batchId: BATCH });
      expect(screen.getByText("2 resumes read. Fix a highlighted cell, or untick a resume to leave it out.")).toBeInTheDocument();
      vi.mocked(importStatusAction).mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(importStatusAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves an edit, and blocks Confirm while someone has no email", async () => {
    render(
      <ResumeImport
        page={jobPage()}
        initial={{ batch: BATCH_VIEW, rows: [row(1), row(2, { fields: { full_name: "No Mail" } })] }}
      />,
    );
    attest();
    expect(screen.getByText("1 person needs an email to join the job.")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();

    const email = screen.getByRole("textbox", { name: "Email, cv-2.pdf" });
    fireEvent.change(email, { target: { value: "nomail@mail.test" } });
    fireEvent.blur(email);
    expect(updateImportRowAction).toHaveBeenCalledWith({ rowId: ROW(2), fields: { email: "nomail@mail.test" } });
    expect(confirmButton()).toBeEnabled();
  });

  it("shows a warning under its cell and the failed file's reason, with Retry and Remove", async () => {
    render(
      <ResumeImport
        page={jobPage()}
        initial={{
          batch: BATCH_VIEW,
          rows: [
            row(1, { warnings: [{ field: "phone", message: "Enter a valid phone number.", value: "x" }] }),
            row(2, { status: "failed", errorCode: "no_text", fields: {} }),
          ],
        }}
      />,
    );
    expect(screen.getByText("Enter a valid phone number.")).toBeInTheDocument();
    expect(screen.getByText("No text found: is it a scan?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry cv-2.pdf" }));
    expect(retryImportRowAction).toHaveBeenCalledWith({ rowId: ROW(2) });
    // A read row is left out with its box, not removed.
    expect(screen.queryByRole("button", { name: "Remove cv-1.pdf" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove cv-2.pdf" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Remove this resume?");
    expect(removeImportRowAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeImportRowAction).toHaveBeenCalledWith({ rowId: ROW(2) }));
    expect(screen.queryByText("cv-2.pdf")).not.toBeInTheDocument();
  });

  it("asks before it stops reading a file", async () => {
    render(
      <ResumeImport
        page={jobPage()}
        initial={{ batch: { ...BATCH_VIEW, status: "parsing" }, rows: [row(1), row(2, { status: "queued", fields: {} })] }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop reading cv-2.pdf" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Its resume import is handed back.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(removeImportRowAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stop reading cv-2.pdf" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Stop reading" }));
    await waitFor(() => expect(removeImportRowAction).toHaveBeenCalledWith({ rowId: ROW(2) }));
  });

  it("discards the open import and shows the upload again", async () => {
    vi.mocked(discardResumeImportAction).mockResolvedValue({ ok: true });
    render(<ResumeImport page={jobPage()} initial={{ batch: BATCH_VIEW, rows: [row(1)] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard import" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(discardResumeImportAction).toHaveBeenCalledWith({ batchId: BATCH }));
    await waitFor(() => expect(screen.queryByText("Check what was read")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("goes back to the upload through the same discard", async () => {
    vi.mocked(discardResumeImportAction).mockResolvedValue({ ok: true });
    render(<ResumeImport page={jobPage()} initial={{ batch: BATCH_VIEW, rows: [row(1)] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to upload" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(discardResumeImportAction).toHaveBeenCalledWith({ batchId: BATCH }));
    await waitFor(() => expect(screen.queryByText("Check what was read")).not.toBeInTheDocument());
  });

  it("stays on the review when the discard is refused", async () => {
    vi.mocked(discardResumeImportAction).mockResolvedValue({ ok: false, error: "This import was already confirmed." });
    render(<ResumeImport page={jobPage()} initial={{ batch: BATCH_VIEW, rows: [row(1)] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard import" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This import was already confirmed."));
    expect(screen.getByText("Check what was read")).toBeInTheDocument();
  });

  it("imports only the ticked resumes", async () => {
    render(
      <ResumeImport
        page={jobPage()}
        initial={{ batch: BATCH_VIEW, rows: [row(1), row(2, { fields: { full_name: "No Mail" } }), row(3)] }}
      />,
    );
    attest();
    // The one without an email blocks Confirm until it's left out.
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Import cv-2.pdf" }));
    expect(screen.queryByText("1 person needs an email to join the job.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 2 people" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Select all resumes" })).toHaveAttribute("data-state", "indeterminate");

    fireEvent.click(confirmButton());
    await screen.findByRole("heading", { name: "Import finished" });
    expect(confirmResumeImportAction).toHaveBeenCalledWith(expect.objectContaining({ rowIds: [ROW(1), ROW(3)] }));
  });

  it("ticks and unticks every resume from the header", () => {
    render(<ResumeImport page={jobPage()} initial={{ batch: BATCH_VIEW, rows: [row(1), row(2)] }} />);
    attest();
    const all = screen.getByRole("checkbox", { name: "Select all resumes" });
    fireEvent.click(all);
    expect(screen.getByRole("checkbox", { name: "Import cv-1.pdf" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Import cv-2.pdf" })).not.toBeChecked();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(all);
    expect(screen.getByRole("button", { name: "Import 2 people" })).toBeEnabled();
  });

  it("opens an uploaded resume through a signed link", async () => {
    vi.mocked(importRowFileUrlAction).mockResolvedValue({ ok: true, url: "https://files.test/cv-1.pdf" });
    render(<ResumeImport page={jobPage()} initial={{ batch: BATCH_VIEW, rows: [row(1)] }} />);
    const view = screen.getByRole("button", { name: "View cv-1.pdf" });
    fireEvent.click(view);
    await waitFor(() => expect(view).toHaveAttribute("data-url", "https://files.test/cv-1.pdf"));
    expect(importRowFileUrlAction).toHaveBeenCalledWith({ rowId: ROW(1) });
  });

  it("doesn't count people already on GetHired (BI-REQ-019)", async () => {
    vi.mocked(checkImportEmailsAction).mockResolvedValue({
      ok: true,
      existing: [],
      known: [{ email: "p2@mail.test", userId: "u2", fullName: "Person 2" }],
    });
    render(<ResumeImport page={jobPage()} initial={{ batch: BATCH_VIEW, rows: [row(1), row(2)] }} />);
    expect(await screen.findByText("Already on GetHired: won't be imported")).toBeInTheDocument();
    expect(checkImportEmailsAction).toHaveBeenCalledWith({ emails: ["p1@mail.test", "p2@mail.test"] });
    expect(screen.getByRole("button", { name: "Import 1 person" })).toBeInTheDocument();
  });
});

describe("ResumeImport: confirm (BI-REQ-025)", () => {
  it("sends the stage, the duplicate actions and the auto-invite switch, then shows the counts", async () => {
    render(
      <ResumeImport
        page={jobPage()}
        initial={{ batch: BATCH_VIEW, rows: [row(1), row(2, { duplicateOf: CANDIDATE })] }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Stage" }), { target: { value: ONSITE } });
    fireEvent.change(screen.getByRole("combobox", { name: "Duplicate action, cv-2.pdf" }), {
      target: { value: "fill" },
    });
    expect(updateImportRowAction).toHaveBeenCalledWith({ rowId: ROW(2), duplicateAction: "fill" });
    fireEvent.click(screen.getByRole("switch"));
    attest();
    fireEvent.click(confirmButton());

    expect(await screen.findByRole("heading", { name: "Import finished" })).toBeInTheDocument();
    expect(confirmResumeImportAction).toHaveBeenCalledWith({
      batchId: BATCH,
      talentListId: null,
      stageId: ONSITE,
      rowIds: [ROW(1), ROW(2)],
      duplicateAction: "skip",
      rowActions: [{ rowId: ROW(2), duplicateAction: "fill" }],
      autoInvite: true,
      attested: true,
    });
    expect(screen.getByText("2 candidates created")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job's applications" })).toHaveAttribute(
      "href",
      `/company/job-posts/${JOB_ID}/applications`,
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("hides the auto-invite switch for a job that doesn't invite by score", () => {
    render(
      <ResumeImport page={jobPage({ ...JOB, interview: null })} initial={{ batch: BATCH_VIEW, rows: [row(1)] }} />,
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("No one will be emailed by this import.")).toBeInTheDocument();
  });

  it("shows the server's refusal", async () => {
    vi.mocked(confirmResumeImportAction).mockResolvedValue({ ok: false, error: "Fix the highlighted rows first." });
    render(<ResumeImport page={jobPage()} initial={{ batch: BATCH_VIEW, rows: [row(1)] }} />);
    attest();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Fix the highlighted rows first."));
  });
});

describe("ResumeImport on the Candidates page (CPT-015, CP-REQ-002/010/011/023)", () => {
  const LIST = "71000000-0000-4000-8000-000000000001";
  const POOL_PAGE: DestinationPage = {
    jobs: [JOB],
    stages: STAGES,
    lists: [{ id: LIST, name: "Old ATS", slug: "old-ats" }],
    allowNoJob: true,
    screeningsRemaining: null,
    fixedJob: null,
  };
  const POOL_BATCH: ImportBatchView = { ...BATCH_VIEW, jobPostId: null };
  const choose = (label: string, option: string) =>
    fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value: option } });

  it("starts a pool batch with no job", async () => {
    vi.mocked(createResumeUploadUrlsAction).mockResolvedValue({
      ok: true,
      batchId: BATCH,
      uploads: [{ rowId: ROW(1), fileName: "a.pdf", path: "p", token: "t" }],
    });
    vi.mocked(submitResumeBatchAction).mockResolvedValue({ ok: true, queued: 1 });
    render(<ResumeImport page={POOL_PAGE} />);
    fireEvent.change(screen.getByLabelText("Choose resumes"), { target: { files: [pdf("a.pdf")] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and read 1 resume" }));
    await waitFor(() => expect(submitResumeBatchAction).toHaveBeenCalledWith({ batchId: BATCH }));
    expect(vi.mocked(createResumeUploadUrlsAction).mock.calls[0][0]).not.toHaveProperty("jobPostId");
  });

  it("doesn't need an email, and hides the stage and auto-invite, without a job", async () => {
    vi.mocked(confirmResumeImportAction).mockResolvedValue({ ok: true, counts: COUNTS, jobPostId: null, list: null });
    render(<ResumeImport page={POOL_PAGE} initial={{ batch: POOL_BATCH, rows: [row(1), row(2, { fields: { full_name: "No Mail" } })] }} />);
    expect(screen.getByText("No email: can't be added to a job yet.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Stage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    attest();
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    expect(await screen.findByRole("heading", { name: "Import finished" })).toBeInTheDocument();
    expect(confirmResumeImportAction).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: BATCH, jobPostId: null, talentListId: null, stageId: null, autoInvite: false }),
    );
    expect(screen.getByRole("link", { name: "See them in Candidates" })).toHaveAttribute(
      "href",
      `/company/candidates?batch=${BATCH}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import more" }));
    expect(screen.getByLabelText("Choose resumes")).toBeInTheDocument();
  });

  it("can be given a job after upload, which then needs everyone's email", () => {
    render(<ResumeImport page={POOL_PAGE} initial={{ batch: POOL_BATCH, rows: [row(1), row(2, { fields: { full_name: "No Mail" } })] }} />);
    choose("Add them to", "job");
    expect(screen.getByRole("combobox", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Auto-invite to AI interview" })).toBeInTheDocument();
    attest();
    expect(screen.getByText("1 person needs an email to join the job.")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("sends a list, and links to it", async () => {
    vi.mocked(confirmResumeImportAction).mockResolvedValue({
      ok: true,
      counts: { ...COUNTS, added_to_list: 1 },
      jobPostId: null,
      list: { id: LIST, name: "Old ATS", slug: "old-ats" },
    });
    render(<ResumeImport page={POOL_PAGE} initial={{ batch: POOL_BATCH, rows: [row(1)] }} />);
    choose("Add them to", "list");
    attest();
    expect(confirmButton()).toBeDisabled();
    choose("Talent list", LIST);
    fireEvent.click(confirmButton());
    expect(await screen.findByRole("link", { name: "Open Old ATS" })).toHaveAttribute("href", "/company/profiles?tab=old-ats");
    expect(confirmResumeImportAction).toHaveBeenCalledWith(expect.objectContaining({ jobPostId: null, talentListId: LIST }));
  });

  it("picks up an open batch's destination after a reload (CP-REQ-011)", () => {
    render(<ResumeImport page={POOL_PAGE} initial={{ batch: { ...POOL_BATCH, jobPostId: JOB_ID, stageId: ONSITE }, rows: [row(1)] }} />);
    expect(screen.getByRole("combobox", { name: "Add them to" })).toHaveValue("job");
    expect(screen.getByRole("combobox", { name: "Stage" })).toHaveValue(ONSITE);
  });
});
