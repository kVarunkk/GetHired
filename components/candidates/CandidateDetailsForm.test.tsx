import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { updateCandidateAction } from "@/app/actions/candidates/update-candidate";
import { EMPTY_CANDIDATE_FORM } from "@/helpers/candidates/candidate-form";
import CandidateDetailsForm from "./CandidateDetailsForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/update-candidate", () => ({ updateCandidateAction: vi.fn() }));

const ID = "cc000000-0000-4000-8000-000000000001";
const initial = {
  ...EMPTY_CANDIDATE_FORM,
  full_name: "Meera Iyer",
  email: "meera@mail.test",
  linkedin_url: "https://linkedin.com/in/meera",
  skills: "Go, Rust",
  notes: "Met at the meetup.",
};

const field = (label: string) => screen.getByLabelText(label);
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateCandidateAction).mockResolvedValue({ ok: true });
});

describe("CandidateDetailsForm (BI-REQ-004)", () => {
  it("sends only the changed fields and refreshes", async () => {
    render(<CandidateDetailsForm candidateId={ID} initial={initial} canEdit />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(field("Phone"), { target: { value: "+91 98765 43210" } });
    fireEvent.change(field("Skills"), { target: { value: "" } });
    save();

    await waitFor(() =>
      expect(updateCandidateAction).toHaveBeenCalledWith({
        candidateId: ID,
        fields: { phone: "+91 98765 43210", skills: "" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Candidate saved.");
    expect(refresh).toHaveBeenCalled();
  });

  it("checks the fields with the import's schema before sending", async () => {
    render(<CandidateDetailsForm candidateId={ID} initial={initial} canEdit />);

    fireEvent.change(field("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(field("GitHub"), { target: { value: "javascript:alert(1)" } });
    save();

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use a link starting with http:// or https://.")).toBeInTheDocument();
    expect(field("Email")).toHaveAttribute("aria-invalid", "true");
    expect(updateCandidateAction).not.toHaveBeenCalled();
  });

  it("shows the server's refusal, with its field errors", async () => {
    vi.mocked(updateCandidateAction).mockResolvedValue({
      ok: false,
      error: "Another candidate has this email.",
      errors: { email: "Another candidate has this email." },
    });
    render(<CandidateDetailsForm candidateId={ID} initial={initial} canEdit />);

    fireEvent.change(field("Email"), { target: { value: "ravi@mail.test" } });
    save();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Another candidate has this email."));
    expect(screen.getByText("Another candidate has this email.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("discards the changes", () => {
    render(<CandidateDetailsForm candidateId={ID} initial={initial} canEdit />);

    fireEvent.change(field("Name"), { target: { value: "Meera" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(field("Name")).toHaveValue("Meera Iyer");
  });

  it("is read-only without applicants.import", () => {
    render(<CandidateDetailsForm candidateId={ID} initial={initial} canEdit={false} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByText("meera@mail.test")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://linkedin.com/in/meera" })).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("Rust")).toBeInTheDocument();
    expect(screen.getByText("Met at the meetup.")).toBeInTheDocument();
    expect(screen.getAllByText("Not specified").length).toBeGreaterThan(0);
  });
});
