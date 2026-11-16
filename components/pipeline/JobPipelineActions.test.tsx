import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { getRedirectError } from "next/dist/client/components/redirect";
import { RedirectType } from "next/dist/client/components/redirect-error";
import { forkJobPipelineAction } from "@/app/actions/pipeline/fork-job-pipeline";
import JobPipelineActions, { NO_OTHER_PIPELINE } from "./JobPipelineActions";

vi.mock("@/app/actions/pipeline/fork-job-pipeline", () => ({ forkJobPipelineAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const JOB = "a0000000-0000-4000-8000-0000000000a1";

const renderActions = (props: Partial<Parameters<typeof JobPipelineActions>[0]> = {}) =>
  render(
    <JobPipelineActions
      jobPostId={JOB}
      pipelineName="Default"
      canSwitch
      canCustomize
      hasOtherPipelines
      {...props}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe("JobPipelineActions (JPT-035)", () => {
  it("renders nothing without either permission", () => {
    const { container } = renderActions({ canSwitch: false, canCustomize: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Change pipeline, with the reason, when there's no other pipeline", () => {
    renderActions({ hasOtherPipelines: false, canCustomize: false });
    const button = screen.getByRole("button", { name: "Change pipeline" });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("title", NO_OTHER_PIPELINE);
  });

  it("keeps Change pipeline open with no other pipeline when the user can create one there", () => {
    renderActions({ hasOtherPipelines: false });
    expect(screen.getByRole("link", { name: "Change pipeline" })).toHaveAttribute(
      "href",
      `/company/job-posts/${JOB}/pipeline/switch`,
    );
  });

  it("asks before customizing, then forks (the action redirects to the copy's editor)", async () => {
    // On a redirect, Next navigates and then rejects the action's promise with the redirect.
    vi.mocked(forkJobPipelineAction).mockRejectedValue(
      getRedirectError("/company/settings/pipelines/new-copy", RedirectType.push),
    );
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Customize for this job" }));
    expect(screen.getByText(/won't be emailed/)).toBeInTheDocument();
    expect(forkJobPipelineAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Customize" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("This job now has its own pipeline."));
    expect(forkJobPipelineAction).toHaveBeenCalledWith({ jobPostId: JOB });
  });

  it("shows the refusal and stays on the page", async () => {
    vi.mocked(forkJobPipelineAction).mockResolvedValue({ ok: false, error: "A company can have at most 10 pipelines." });
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Customize for this job" }));
    await user.click(screen.getByRole("button", { name: "Customize" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A company can have at most 10 pipelines."));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
