import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InterviewConfigSection from "./InterviewConfigSection";
import { saveInterviewConfigAction } from "@/app/actions/interviews/save-interview-config";
import { suggestInterviewConfigAction } from "@/app/actions/interviews/suggest-interview-config";
import type { InterviewConfig } from "@/helpers/interview/screening/schemas";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/actions/interviews/save-interview-config", () => ({ saveInterviewConfigAction: vi.fn() }));
vi.mock("@/app/actions/interviews/suggest-interview-config", () => ({ suggestInterviewConfigAction: vi.fn() }));
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: vi.fn(async () => false), dialog: null }),
}));

const JOB = "b2000000-0000-4000-8000-000000000001";

const CONFIG: InterviewConfig = {
  enabled: true,
  invite_rule: "fit_threshold",
  fit_threshold: 75,
  questions: [{ text: "Why this role?" }],
  competencies: [{ name: "System design", description: "Designs services that scale." }],
  duration_minutes: 20,
  deadline_days: 7,
  language: "en",
};

const renderSection = (props: Partial<Parameters<typeof InterviewConfigSection>[0]> = {}) =>
  render(<InterviewConfigSection jobPostId={JOB} initialConfig={CONFIG} canEdit {...props} />);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ queued: 3 }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(saveInterviewConfigAction).mockImplementation(async ({ config }) => ({
    ok: true,
    config: config as InterviewConfig,
    unscreened: null,
  }));
});

describe("InterviewConfigSection (SIT-060)", () => {
  it("shows the saved config", () => {
    renderSection();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save and turn on" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Minimum fit score")).toHaveValue(75);
    expect(screen.getByLabelText("Competency 1 name")).toHaveValue("System design");
    expect(screen.getByLabelText("Question 1")).toHaveValue("Why this role?");
    expect(screen.getByLabelText("Interview length")).toHaveValue("20");
    expect(screen.getByLabelText("Deadline")).toHaveValue("7");
    expect(screen.getByText(/each new applicant is screened automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/20 interview minutes per invite/i)).toBeInTheDocument();
  });

  it("starts from the defaults without a config", () => {
    renderSection({ initialConfig: null });
    expect(screen.getByRole("button", { name: "Save and turn on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum fit score")).toHaveValue(70);
    expect(screen.getByLabelText("Interview length")).toHaveValue("15");
    expect(screen.getByLabelText("Deadline")).toHaveValue("5");
  });

  it("hides the threshold for manual invites", () => {
    renderSection();
    fireEvent.change(screen.getByLabelText("Who gets invited"), { target: { value: "manual" } });
    expect(screen.queryByLabelText("Minimum fit score")).not.toBeInTheDocument();
    expect(screen.queryByText(/screened automatically/i)).not.toBeInTheDocument();
  });

  it("stops adding at the limits", async () => {
    renderSection({
      initialConfig: {
        ...CONFIG,
        competencies: Array.from({ length: 5 }, (_, i) => ({ name: `C${i}`, description: "d" })),
        questions: Array.from({ length: 8 }, (_, i) => ({ text: `Q${i}` })),
      },
    });
    expect(screen.getByRole("button", { name: /add competency/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add question/i })).toBeDisabled();
  });

  it("adds and removes rows", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: /add question/i }));
    expect(screen.getByLabelText("Question 2")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Remove question 1" }));
    expect(screen.getByLabelText("Question 1")).toHaveValue("");
  });

  it("fills the draft from Suggest", async () => {
    vi.mocked(suggestInterviewConfigAction).mockResolvedValue({
      ok: true,
      draft: {
        competencies: [{ name: "APIs", description: "Designs clean APIs." }],
        questions: [{ text: "Tell me about an API you designed." }],
      },
      notes: ["Dropped one item that wasn't job-related."],
    });
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: /suggest/i }));

    expect(suggestInterviewConfigAction).toHaveBeenCalledWith({ jobPostId: JOB });
    expect(await screen.findByDisplayValue("APIs")).toBeInTheDocument();
    expect(screen.getByLabelText("Question 1")).toHaveValue("Tell me about an API you designed.");
    expect(screen.getByText("Dropped one item that wasn't job-related.")).toBeInTheDocument();
    expect(saveInterviewConfigAction).not.toHaveBeenCalled();
  });

  it("saves the draft through the action", async () => {
    renderSection();
    await userEvent.clear(screen.getByLabelText("Minimum fit score"));
    await userEvent.type(screen.getByLabelText("Minimum fit score"), "80");
    await userEvent.click(screen.getByRole("button", { name: /^save/i }));

    expect(saveInterviewConfigAction).toHaveBeenCalledWith({
      jobPostId: JOB,
      config: { ...CONFIG, fit_threshold: 80 },
    });
  });

  it("turns off right away, without the unsaved draft", async () => {
    renderSection();
    await userEvent.clear(screen.getByLabelText("Minimum fit score"));
    await userEvent.type(screen.getByLabelText("Minimum fit score"), "80");
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));

    expect(saveInterviewConfigAction).toHaveBeenCalledWith({ jobPostId: JOB, config: { ...CONFIG, enabled: false } });
    expect(await screen.findByRole("button", { name: "Save and turn on" })).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum fit score")).toHaveValue(80);
  });

  it("saves the draft and turns it on in one go", async () => {
    const off = { ...CONFIG, enabled: false };
    renderSection({ initialConfig: off });
    await userEvent.clear(screen.getByLabelText("Minimum fit score"));
    await userEvent.type(screen.getByLabelText("Minimum fit score"), "80");
    await userEvent.click(screen.getByRole("button", { name: "Save and turn on" }));

    expect(saveInterviewConfigAction).toHaveBeenCalledWith({
      jobPostId: JOB,
      config: { ...CONFIG, fit_threshold: 80, enabled: true },
    });
    expect(await screen.findByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });

  it("saves a draft without turning it on", async () => {
    renderSection({ initialConfig: { ...CONFIG, enabled: false } });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(saveInterviewConfigAction).toHaveBeenCalledWith({ jobPostId: JOB, config: { ...CONFIG, enabled: false } });
  });

  it("stays off when turning on fails", async () => {
    vi.mocked(saveInterviewConfigAction).mockResolvedValue({
      ok: false,
      error: "Add at least one competency.",
      field: "competencies",
    });
    renderSection({ initialConfig: null });
    await userEvent.click(screen.getByRole("button", { name: "Save and turn on" }));

    expect(await screen.findByText("Add at least one competency.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and turn on" })).toBeInTheDocument();
  });

  it("shows a fairness error on its field", async () => {
    vi.mocked(saveInterviewConfigAction).mockResolvedValue({
      ok: false,
      error: "Competencies can't be about age.",
      field: "competencies.0.name",
    });
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: /^save/i }));

    expect(await screen.findByText("Competencies can't be about age.")).toBeInTheDocument();
    expect(screen.getByLabelText("Competency 1 name")).toHaveAttribute("aria-invalid", "true");
  });

  it("offers to screen the unscreened applicants after saving, and queues them", async () => {
    vi.mocked(saveInterviewConfigAction).mockResolvedValue({ ok: true, config: CONFIG, unscreened: 3 });
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: /^save/i }));

    await userEvent.click(await screen.findByRole("button", { name: "Screen the 3 unscreened applicants" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/company/job-posts/${JOB}/screen`, { method: "POST" }),
    );
  });

  it("doesn't offer screening when the action says it doesn't apply", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: /^save/i }));
    await waitFor(() => expect(saveInterviewConfigAction).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /unscreened/i })).not.toBeInTheDocument();
  });

  it("is read-only without the permissions", () => {
    renderSection({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Competency 1 name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suggest/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add question/i })).not.toBeInTheDocument();
  });
});
